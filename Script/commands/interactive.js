import readline from 'readline';
import chalk from 'chalk';
import { CommandCompleter } from './completer.js';

/**
 * 交互式命令行界面（支持实时补全预览）
 */
export class InteractiveCLI {
  constructor(config, serverManager, logger, projectRoot, commandHandler = null) {
    this.config = config;
    this.serverManager = serverManager;
    this.logger = logger;
    this.rl = null;
    this.commandHandler = commandHandler || new CommandHandler(config, serverManager, logger, {
      projectRoot
    });
    this.completer = new CommandCompleter(this.commandHandler.getRegistry());
    
    // 补全相关状态
    this.currentInput = '';
    this.cursorPosition = 0; // 光标在输入中的位置
    this.completions = []; // 候选列表（只包含显示部分）
    this.fullCompletions = []; // 完整补全列表（用于Tab补全）
    this.completionInfo = null; // 补全信息 {candidates, shouldShow, type}
    this.selectedIndex = 0;
    this.showingCompletions = false;
    this.hasCompletionsDisplayed = false; // 标记是否显示了补全行
    this.escapeBuffer = []; // ESC 序列缓冲区
    this.escapeTimer = null;
    this.completionStartRow = 0; // 当前显示的补全起始行（用于多行显示）
    this.completionRowsPerPage = 2; // 每页显示的行数
    this.lastDisplayedRows = 0; // 上次实际显示的行数
    
    // 历史记录相关状态
    this.history = []; // 历史命令记录
    this.historyIndex = -1; // 当前历史记录索引（-1 表示不在历史记录中）
    this.tempInput = ''; // 临时保存用户输入（当浏览历史记录时）
  }

  /**
   * 初始化交互式命令行
   */
  init() {
    if (!this.config.commands.interactive) {
      return;
    }

    // 设置原始模式以捕获所有键盘输入
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    // 监听输入
    process.stdin.on('data', (data) => {
      this.handleInput(data);
    });

    // 监听标准输入结束
    process.stdin.on('end', () => {
      this.close();
    });

    // 显示欢迎信息
    this.showWelcome();
    this.renderPrompt();
  }

  /**
   * 处理输入
   */
  handleInput(data) {
    const keyCode = data[0];
    const key = data.toString();
    
    // Ctrl+C
    if (keyCode === 3) {
      process.exit(0);
    }
    
    // ESC 字符，可能是方向键序列的开始
    if (keyCode === 27) {
      this.escapeBuffer = [data];
      // 清除之前的定时器
      if (this.escapeTimer) {
        clearTimeout(this.escapeTimer);
      }
      // 等待更多数据
      this.escapeTimer = setTimeout(() => {
        this.processEscapeSequence(Buffer.concat(this.escapeBuffer).toString());
        this.escapeBuffer = [];
        this.escapeTimer = null;
      }, 50);
      return;
    }
    
    // 如果正在处理 ESC 序列，累积数据
    if (this.escapeBuffer.length > 0) {
      this.escapeBuffer.push(data);
      return;
    }
    
    // 处理多字符输入（如粘贴）
    if (data.length > 1) {
      this.handleMultipleChars(data);
      return;
    }
    
    // Enter
    if (keyCode === 13 || keyCode === 10) {
      this.handleEnter();
      return;
    }
    
    // Tab
    if (keyCode === 9) {
      this.handleTab();
      return;
    }
    
    // Backspace
    if (keyCode === 127 || keyCode === 8) {
      this.handleBackspace();
      return;
    }
    
    // Delete (某些终端可能使用不同的编码)
    if (keyCode === 127 && data.length > 1) {
      this.handleDelete();
      return;
    }
    
    // 普通可打印字符
    if (keyCode >= 32 && keyCode < 127) {
      this.handleChar(String.fromCharCode(keyCode));
    }
  }
  
  /**
   * 处理多字符输入（如粘贴）
   */
  handleMultipleChars(data) {
    const text = data.toString();
    let pendingInput = '';
    
    // 逐字符处理
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      
      // 处理换行和回车
      if (charCode === 13 || charCode === 10) {
        // 如果有待处理的输入，先添加到当前输入
        if (pendingInput.length > 0) {
          this.currentInput += pendingInput;
          pendingInput = '';
          this.exitHistoryMode();
          this.updateCompletions();
        }
        
        // 执行命令（如果有输入）
        if (this.currentInput.trim().length > 0) {
          this.handleEnter();
        }
        continue;
      }
      
      // 跳过其他控制字符
      if (charCode < 32) {
        continue;
      }
      
      // 收集可打印字符
      if (charCode >= 32 && charCode < 127) {
        pendingInput += text[i];
      }
    }
    
    // 处理剩余的字符
    if (pendingInput.length > 0) {
      // 在光标位置插入字符
      if (this.cursorPosition < this.currentInput.length) {
        this.currentInput = 
          this.currentInput.slice(0, this.cursorPosition) + 
          pendingInput + 
          this.currentInput.slice(this.cursorPosition);
      } else {
        this.currentInput += pendingInput;
      }
      this.cursorPosition += pendingInput.length;
      this.exitHistoryMode();
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理 ESC 序列（方向键等）
   */
  processEscapeSequence(seq) {
    // 方向键左: \u001b[D 或 \u001bOD
    if (seq === '\u001b[D' || seq === '\u001bOD') {
      if (this.showingCompletions && this.completions.length > 0) {
        // 有候选显示时，切换候选
      this.handleArrowLeft();
      } else {
        // 无候选显示时，移动光标
        this.moveCursorLeft();
      }
      return;
    }
    // 方向键右: \u001b[C 或 \u001bOC
    if (seq === '\u001b[C' || seq === '\u001bOC') {
      if (this.showingCompletions && this.completions.length > 0) {
        // 有候选显示时，切换候选
      this.handleArrowRight();
      } else {
        // 无候选显示时，移动光标
        this.moveCursorRight();
      }
      return;
    }
    // 方向键上: \u001b[A 或 \u001bOA
    if (seq === '\u001b[A' || seq === '\u001bOA') {
      this.handleArrowUp();
      return;
    }
    // 方向键下: \u001b[B 或 \u001bOB
    if (seq === '\u001b[B' || seq === '\u001bOB') {
      this.handleArrowDown();
      return;
    }
  }
  
  /**
   * 光标向左移动
   */
  moveCursorLeft() {
    if (this.cursorPosition > 0) {
      this.cursorPosition--;
      this.renderPrompt();
    }
  }
  
  /**
   * 光标向右移动
   */
  moveCursorRight() {
    if (this.cursorPosition < this.currentInput.length) {
      this.cursorPosition++;
      this.renderPrompt();
    }
  }

  /**
   * 处理字符输入
   */
  handleChar(char) {
    this.exitHistoryMode();
    
    // 在光标位置插入字符
    if (this.cursorPosition < this.currentInput.length) {
      this.currentInput = 
        this.currentInput.slice(0, this.cursorPosition) + 
        char + 
        this.currentInput.slice(this.cursorPosition);
    } else {
    this.currentInput += char;
    }
    
    this.cursorPosition++;
    this.updateCompletions();
    this.renderPrompt();
  }

  /**
   * 处理退格
   */
  handleBackspace() {
    this.exitHistoryMode();
    
    if (this.cursorPosition > 0) {
      // 删除光标前的字符
      this.currentInput = 
        this.currentInput.slice(0, this.cursorPosition - 1) + 
        this.currentInput.slice(this.cursorPosition);
      this.cursorPosition--;
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理 Delete 键
   */
  handleDelete() {
    this.exitHistoryMode();
    
    if (this.cursorPosition < this.currentInput.length) {
      // 删除光标后的字符
      this.currentInput = 
        this.currentInput.slice(0, this.cursorPosition) + 
        this.currentInput.slice(this.cursorPosition + 1);
      this.updateCompletions();
      this.renderPrompt();
    }
  }
  
  /**
   * 退出历史记录浏览模式
   */
  exitHistoryMode() {
    if (this.historyIndex !== -1) {
      this.historyIndex = -1;
      this.tempInput = '';
    }
  }

  /**
   * 处理 Tab - 补全当前选中候选
   */
  handleTab() {
    if (this.completions.length === 0 || !this.completionInfo) {
      return;
    }
    
    const selectedCandidate = this.completions[this.selectedIndex];
    const prefix = this.commandHandler.prefix;
    const commandInput = this.currentInput.substring(prefix.length);
    const trimmedInput = commandInput.trim();
    const hasTrailingSpace = commandInput.endsWith(' ');
    
    // 根据补全类型进行补全
    const completionType = this.completionInfo.type;
    this.currentInput = this.buildCompletionInput(
      selectedCandidate,
      prefix,
      trimmedInput,
      hasTrailingSpace,
      completionType
    );
    
    // 补全后，光标移到末尾
    this.cursorPosition = this.currentInput.length;
    
    // 重置补全状态
    this.resetCompletionState();
    this.clearCompletions();
    this.updateCompletions();
    this.renderPrompt();
  }
  
  /**
   * 构建补全后的输入
   */
  buildCompletionInput(selectedCandidate, prefix, trimmedInput, hasTrailingSpace, type) {
    if (type === 'command') {
      return prefix + selectedCandidate;
    }
    
    // 子命令或参数补全
    if (hasTrailingSpace) {
      return this.currentInput.trim() + ' ' + selectedCandidate;
    }
    
    const inputParts = trimmedInput.split(/\s+/);
    inputParts[inputParts.length - 1] = selectedCandidate;
    return prefix + inputParts.join(' ');
  }
  
  /**
   * 重置补全状态
   */
  resetCompletionState() {
    this.completions = [];
    this.fullCompletions = [];
    this.completionInfo = null;
    this.selectedIndex = 0;
    this.showingCompletions = false;
  }

  /**
   * 处理方向键左（上一个候选项）
   */
  handleArrowLeft() {
    if (this.completions.length > 0) {
      this.selectedIndex = (this.selectedIndex - 1 + this.completions.length) % this.completions.length;
      // 确保选中的候选在视图中可见
      this.ensureSelectedVisible();
      this.renderCompletions();
    }
  }

  /**
   * 处理方向键右（下一个候选项）
   */
  handleArrowRight() {
    if (this.completions.length > 0) {
      this.selectedIndex = (this.selectedIndex + 1) % this.completions.length;
      // 确保选中的候选在视图中可见
      this.ensureSelectedVisible();
      this.renderCompletions();
    }
  }

  /**
   * 确保选中的候选在视图中可见
   */
  ensureSelectedVisible() {
    if (!this.showingCompletions || this.completions.length === 0) {
      return;
    }
    
    const { itemsPerLine, totalRows, maxStartRow } = this.calculateCompletionLayout(this.completions);
    const selectedRow = Math.floor(this.selectedIndex / itemsPerLine);
    const currentEndRow = Math.min(this.completionStartRow + this.completionRowsPerPage, totalRows);
    
    // 调整显示范围使选中候选可见
    if (selectedRow < this.completionStartRow) {
      this.completionStartRow = selectedRow;
    } else if (selectedRow >= currentEndRow) {
      this.completionStartRow = Math.max(0, Math.min(
        selectedRow - this.completionRowsPerPage + 1,
        maxStartRow
      ));
    }
  }
  
  /**
   * 计算补全布局信息
   */
  calculateCompletionLayout(candidates) {
      const terminalWidth = process.stdout.columns || 80;
      const getDisplayWidth = (text) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
      
      let itemsPerLine = 0;
      let currentLineWidth = 0;
    for (const candidate of candidates) {
      const itemWidth = getDisplayWidth(candidate) + 1;
        if (currentLineWidth + itemWidth > terminalWidth && currentLineWidth > 0) {
          break;
        }
        currentLineWidth += itemWidth;
        itemsPerLine++;
      }
      
    itemsPerLine = Math.max(1, itemsPerLine);
    const totalRows = Math.ceil(candidates.length / itemsPerLine);
      const maxStartRow = Math.max(0, totalRows - this.completionRowsPerPage);
      
    return { itemsPerLine, totalRows, maxStartRow };
  }

  /**
   * 处理方向键上（历史记录上一个或补全视图向上滚动）
   */
  handleArrowUp() {
    if (this.showingCompletions && this.completions.length > 0) {
      const { maxStartRow } = this.calculateCompletionLayout(this.completions);
      if (this.completionStartRow > 0) {
        this.completionStartRow--;
        this.renderCompletions();
      }
      return;
    }
    
    if (this.historyIndex === -1 && this.currentInput.trim().length > 0) {
      return;
    }
    
    if (this.history.length === 0) {
      return;
    }
    
    if (this.historyIndex === -1) {
      this.tempInput = this.currentInput;
      this.historyIndex = this.history.length;
    }
    
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.currentInput = this.history[this.historyIndex];
      this.cursorPosition = this.currentInput.length; // 光标移到末尾
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理方向键下（历史记录下一个或补全视图向下滚动）
   */
  handleArrowDown() {
    if (this.showingCompletions && this.completions.length > 0) {
      const { maxStartRow } = this.calculateCompletionLayout(this.completions);
      if (this.completionStartRow < maxStartRow) {
        this.completionStartRow++;
        this.renderCompletions();
      }
      return;
    }
    
    if (this.historyIndex === -1) {
      if (this.currentInput.trim().length > 0) {
        return;
      }
      return;
    }
    
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.currentInput = this.history[this.historyIndex];
      this.cursorPosition = this.currentInput.length; // 光标移到末尾
      this.updateCompletions();
      this.renderPrompt();
    } else {
      this.historyIndex = -1;
      this.currentInput = this.tempInput;
      this.cursorPosition = this.currentInput.length; // 光标移到末尾
      this.tempInput = '';
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理回车
   */
  async handleEnter() {
    const input = this.currentInput.trim();
    
    // 重置所有状态
    this.currentInput = '';
    this.cursorPosition = 0;
    this.resetCompletionState();
    this.hasCompletionsDisplayed = false;
    this.historyIndex = -1;
    this.tempInput = '';
    
    this.clearCompletions();
    process.stdout.write('\n');
    
    if (input) {
      this.addToHistory(input);
      const shouldContinue = await this.commandHandler.handle(input);
      if (!shouldContinue) {
        this.close();
        return;
      }
    }
    
    this.renderPrompt();
  }
  
  /**
   * 添加到历史记录
   */
  addToHistory(input) {
    if (this.history.length === 0 || this.history[this.history.length - 1] !== input) {
      this.history.push(input);
      if (this.history.length > 100) {
        this.history.shift();
      }
    }
  }

  /**
   * 更新补全列表
   */
  updateCompletions() {
    const previousShowing = this.showingCompletions;
    const previousHasDisplayed = this.hasCompletionsDisplayed;
    
    // 获取补全信息
    this.completionInfo = this.completer.complete(this.currentInput);
    this.completions = this.completionInfo.candidates || [];
    this.showingCompletions = this.completionInfo.shouldShow && this.completions.length > 0;
    
    // 如果补全列表发生变化，重置选中索引和显示行
    if (this.showingCompletions) {
      // 确保选中索引在有效范围内
      if (this.selectedIndex >= this.completions.length) {
        this.selectedIndex = 0;
      }
      this.completionStartRow = 0;
    } else {
      this.selectedIndex = 0;
    }
    
    // 如果之前显示了补全但现在没有了，需要清除显示
    if ((previousShowing || previousHasDisplayed) && !this.showingCompletions) {
      this.clearCompletions();
    }
  }

  /**
   * 清除补全显示（支持多行）
   */
  clearCompletions() {
    if (this.hasCompletionsDisplayed) {
      // 清除实际显示的行数（使用上次记录的行数，如果没有记录则清除所有可能显示的行）
      const rowsToClear = this.lastDisplayedRows > 0 
        ? this.lastDisplayedRows 
        : this.completionRowsPerPage;
      
      // 先确保光标在正确位置（这样清除后光标位置才准确）
      const PROMPT_LENGTH = 2; // '> ' 的长度
      const targetPosition = PROMPT_LENGTH + this.cursorPosition;
      readline.cursorTo(process.stdout, targetPosition);
      
      // 向下移动到补全行并清除所有行
      for (let i = 0; i < rowsToClear; i++) {
        // 使用 ANSI 转义序列向下移动一行到补全行
        process.stdout.write('\u001b[B'); // ESC[B 向下移动一行
        // 移动到行首，然后清除整行（从行首到行尾）
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 2); // 2 = 清除整行
      }
      
      // 返回到输入行（向上移动实际清除的行数）
      for (let i = 0; i < rowsToClear; i++) {
        process.stdout.write('\u001b[A'); // ESC[A 向上移动一行
      }
      
      // 确保光标在正确位置
      readline.cursorTo(process.stdout, targetPosition);
      
      this.hasCompletionsDisplayed = false;
      this.lastDisplayedRows = 0; // 重置
    }
  }

  /**
   * 渲染补全选项（支持多行显示）
   */
  renderCompletions() {
    if (!this.showingCompletions || this.completions.length === 0) {
      return;
    }

    this.clearCompletions();

    const PROMPT_LENGTH = 2; // '> ' 的长度
    const currentCursorPos = PROMPT_LENGTH + this.cursorPosition;
    readline.cursorTo(process.stdout, 0);
    readline.cursorTo(process.stdout, currentCursorPos);
    process.stdout.write('\n');
    
    const { itemsPerLine, totalRows, maxStartRow } = this.calculateCompletionLayout(this.completions);
    this.completionStartRow = Math.max(0, Math.min(this.completionStartRow, maxStartRow));
    
    const startRow = this.completionStartRow;
    const endRow = Math.min(startRow + this.completionRowsPerPage, totalRows);
    
    // 准备候选显示文本
    const candidatesWithText = this.completions.map((comp, index) => {
      const isSelected = index === this.selectedIndex;
      return {
        text: isSelected ? chalk.white(comp) : chalk.gray(comp),
        index
      };
    });
    
    // 渲染指定范围的行
    for (let row = startRow; row < endRow; row++) {
      const startIndex = row * itemsPerLine;
      const endIndex = Math.min(startIndex + itemsPerLine, this.completions.length);
      const rowCandidates = candidatesWithText.slice(startIndex, endIndex);
      const rowText = rowCandidates.map(c => c.text).join(' ');
      process.stdout.write(rowText);
      if (row < endRow - 1) {
        process.stdout.write('\n');
      }
    }
    
    const displayedRows = endRow - startRow;
    this.lastDisplayedRows = displayedRows;
    this.hasCompletionsDisplayed = true;
    
    // 返回到输入行
    readline.cursorTo(process.stdout, 0);
    for (let i = 0; i < displayedRows; i++) {
      process.stdout.write('\u001b[A');
    }
    // 移动光标到正确位置
    const targetPosition = PROMPT_LENGTH + this.cursorPosition;
    readline.cursorTo(process.stdout, targetPosition);
  }

  /**
   * 渲染提示符和输入
   */
  renderPrompt() {
    // 先清除之前的补全显示（如果存在）
    this.clearCompletions();
    
    // 清除当前行（输入行）
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 1);
    
    // 显示提示符和当前输入
    const promptText = chalk.cyan('> ') + this.currentInput;
    process.stdout.write(promptText);
    
    // 移动光标到正确位置
    const PROMPT_LENGTH = 2; // '> ' 的长度
    const targetPosition = PROMPT_LENGTH + this.cursorPosition;
    readline.cursorTo(process.stdout, targetPosition);
    
    // 如果有补全，显示在下方
    if (this.showingCompletions && this.completions.length > 0) {
      this.renderCompletions();
    } else {
      // 如果没有补全，确保标记已清除
      this.hasCompletionsDisplayed = false;
    }
  }

  /**
   * 显示欢迎信息
   */
  showWelcome() {
    console.log(chalk.green('\n╔═══════════════════════════════════════╗'));
    console.log(chalk.green('║    BridgeCore-NodeCraft 已启动        ║'));
    console.log(chalk.green('╚═══════════════════════════════════════╝\n'));
  }

  /**
   * 关闭交互式命令行
   */
  close() {
    // 清除补全显示
    this.clearCompletions();
    
    // 清除 ESC 定时器
    if (this.escapeTimer) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = null;
    }
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    this.logger.info('交互式命令行已关闭');
  }
}
