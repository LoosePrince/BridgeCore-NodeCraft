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
    this.completions = [];
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
    
    // Backspace 或 Delete
    if (keyCode === 127 || keyCode === 8) {
      this.handleBackspace();
      return;
    }
    
    // 普通可打印字符
    if (keyCode >= 32 && keyCode < 127) {
      this.handleChar(String.fromCharCode(keyCode));
    }
  }

  /**
   * 处理 ESC 序列（方向键等）
   */
  processEscapeSequence(seq) {
    // 方向键左: \u001b[D 或 \u001bOD（上一个候选项）
    if (seq === '\u001b[D' || seq === '\u001bOD') {
      this.handleArrowLeft();
      return;
    }
    // 方向键右: \u001b[C 或 \u001bOC（下一个候选项）
    if (seq === '\u001b[C' || seq === '\u001bOC') {
      this.handleArrowRight();
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
   * 处理字符输入
   */
  handleChar(char) {
    // 如果用户开始输入，退出历史记录浏览模式
    if (this.historyIndex !== -1) {
      this.historyIndex = -1;
      this.tempInput = '';
    }
    this.currentInput += char;
    // 更新补全（会检查是否完全匹配，如果完全匹配则不显示补全）
    this.updateCompletions();
    this.renderPrompt();
  }

  /**
   * 处理退格
   */
  handleBackspace() {
    // 如果用户开始输入，退出历史记录浏览模式
    if (this.historyIndex !== -1) {
      this.historyIndex = -1;
      this.tempInput = '';
    }
    if (this.currentInput.length > 0) {
      this.currentInput = this.currentInput.slice(0, -1);
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理 Tab
   */
  handleTab() {
    if (this.completions.length > 0) {
      this.currentInput = this.completions[this.selectedIndex];
      // 补全后清除补全状态，继续输入时会重新触发
      this.completions = [];
      this.selectedIndex = 0;
      this.showingCompletions = false;
      // 先清除补全显示
      this.clearCompletions();
      // 更新补全（检查是否完全匹配）
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理方向键左（上一个候选项）
   */
  handleArrowLeft() {
    if (this.completions.length > 0) {
      this.selectedIndex = (this.selectedIndex - 1 + this.completions.length) % this.completions.length;
      this.renderCompletions();
    }
  }

  /**
   * 处理方向键右（下一个候选项）
   */
  handleArrowRight() {
    if (this.completions.length > 0) {
      this.selectedIndex = (this.selectedIndex + 1) % this.completions.length;
      this.renderCompletions();
    }
  }

  /**
   * 处理方向键上（历史记录上一个或补全行切换）
   */
  handleArrowUp() {
    // 如果正在显示补全，切换补全显示的行范围
    if (this.showingCompletions && this.completions.length > 0) {
      // 计算总行数
      const terminalWidth = process.stdout.columns || 80;
      const getDisplayWidth = (text) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
      const candidatesWithWidth = this.completions.map(comp => {
        const width = getDisplayWidth(comp);
        return { width };
      });
      
      let itemsPerLine = 0;
      let currentLineWidth = 0;
      for (const candidate of candidatesWithWidth) {
        const itemWidth = candidate.width + 1;
        if (currentLineWidth + itemWidth > terminalWidth && currentLineWidth > 0) {
          break;
        }
        currentLineWidth += itemWidth;
        itemsPerLine++;
      }
      if (itemsPerLine === 0) itemsPerLine = 1;
      
      const totalRows = Math.ceil(this.completions.length / itemsPerLine);
      const maxStartRow = Math.max(0, totalRows - this.completionRowsPerPage);
      
      // 向上切换行（显示更早的行）
      if (this.completionStartRow > 0) {
        this.completionStartRow--;
        this.renderCompletions();
      }
      return;
    }
    
    // 如果当前不在历史模式且输入不为空，则不处理
    if (this.historyIndex === -1 && this.currentInput.trim().length > 0) {
      return;
    }
    
    // 如果历史记录为空，不处理
    if (this.history.length === 0) {
      return;
    }
    
    // 如果第一次按上键，保存当前输入（虽然应该是空的）
    if (this.historyIndex === -1) {
      this.tempInput = this.currentInput;
      this.historyIndex = this.history.length; // 设置为末尾+1，这样第一次--会指向最后一个
    }
    
    // 向上移动历史索引
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.currentInput = this.history[this.historyIndex];
      this.updateCompletions();
      this.renderPrompt();
    }
  }

  /**
   * 处理方向键下（历史记录下一个或补全行切换）
   */
  handleArrowDown() {
    // 如果正在显示补全，切换补全显示的行范围
    if (this.showingCompletions && this.completions.length > 0) {
      // 计算总行数
      const terminalWidth = process.stdout.columns || 80;
      const getDisplayWidth = (text) => text.replace(/\u001b\[[0-9;]*m/g, '').length;
      const candidatesWithWidth = this.completions.map(comp => {
        const width = getDisplayWidth(comp);
        return { width };
      });
      
      let itemsPerLine = 0;
      let currentLineWidth = 0;
      for (const candidate of candidatesWithWidth) {
        const itemWidth = candidate.width + 1;
        if (currentLineWidth + itemWidth > terminalWidth && currentLineWidth > 0) {
          break;
        }
        currentLineWidth += itemWidth;
        itemsPerLine++;
      }
      if (itemsPerLine === 0) itemsPerLine = 1;
      
      const totalRows = Math.ceil(this.completions.length / itemsPerLine);
      const maxStartRow = Math.max(0, totalRows - this.completionRowsPerPage);
      
      // 向下切换行（显示更晚的行）
      if (this.completionStartRow < maxStartRow) {
        this.completionStartRow++;
        this.renderCompletions();
      }
      return;
    }
    
    // 如果当前不在历史模式且输入不为空，则不处理
    if (this.historyIndex === -1 && this.currentInput.trim().length > 0) {
      return;
    }
    
    // 如果不在历史记录浏览模式，不处理
    if (this.historyIndex === -1) {
      return;
    }
    
    // 向下移动历史索引
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.currentInput = this.history[this.historyIndex];
      this.updateCompletions();
      this.renderPrompt();
    } else {
      // 到达历史记录末尾，恢复临时输入（通常是空）
      this.historyIndex = -1;
      this.currentInput = this.tempInput;
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
    this.currentInput = '';
    this.completions = [];
    this.selectedIndex = 0;
    this.showingCompletions = false;
    this.hasCompletionsDisplayed = false;
    this.historyIndex = -1; // 退出历史记录浏览模式
    this.tempInput = '';
    
    // 清除补全显示
    this.clearCompletions();
    
    // 换行
    process.stdout.write('\n');
    
    // 处理命令
    if (input) {
      // 保存到历史记录（不保存重复的连续命令）
      if (this.history.length === 0 || this.history[this.history.length - 1] !== input) {
        this.history.push(input);
        // 限制历史记录数量（最多保存 100 条）
        if (this.history.length > 100) {
          this.history.shift();
        }
      }
      
      const shouldContinue = await this.commandHandler.handle(input);
      if (!shouldContinue) {
        this.close();
        return;
      }
    }
    
    this.renderPrompt();
  }

  /**
   * 更新补全列表
   */
  updateCompletions() {
    const previousShowing = this.showingCompletions;
    const previousHasDisplayed = this.hasCompletionsDisplayed;
    
    this.completions = this.completer.complete(this.currentInput);
    this.selectedIndex = 0;
    this.showingCompletions = this.completions.length > 0;
    
    // 如果补全列表发生变化，重置显示行到第一行
    if (this.showingCompletions) {
      this.completionStartRow = 0;
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
      
      // 先确保光标在输入行末尾（这样清除后光标位置才准确）
      const inputEndPos = this.currentInput.length + 2; // +2 for '> '
      readline.cursorTo(process.stdout, inputEndPos);
      
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
      
      // 确保光标在输入行末尾
      readline.cursorTo(process.stdout, inputEndPos);
      
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

    // 清除之前的补全显示
    this.clearCompletions();

    // 确保光标在输入行末尾（先移动到行首，然后移动到末尾）
    readline.cursorTo(process.stdout, 0);
    const inputEndPos = this.currentInput.length + 2; // +2 for '> '
    readline.cursorTo(process.stdout, inputEndPos);

    // 使用换行符移动到下一行显示补全
    process.stdout.write('\n');
    
    // 提取当前输入的前缀和命令部分
    const prefix = this.commandHandler.prefix;
    let displayCompletions = this.completions;
    
    // 对于顶级命令补全，显示完整命令（如 !s -> !server, !status, !stop）
    // 对于子命令补全，只显示子命令部分（如 !server  -> start, stop）
    // 对于参数补全，只显示参数部分（如 !plugins load  -> 1.js 或 !plugins load 1 -> 1.js）
    if (this.currentInput.startsWith(prefix)) {
      const commandInput = this.currentInput.substring(prefix.length);
      const commandInputTrimmed = commandInput.trim();
      const hasTrailingSpace = this.currentInput.endsWith(' ');
      
      // 如果补全项以输入开头且有剩余部分，说明是子命令补全或参数补全，只显示剩余部分
      // 这样无论有没有末尾空格都能正确处理
      if (commandInputTrimmed) {
        displayCompletions = this.completions.map(comp => {
          const compWithoutPrefix = comp.startsWith(prefix) ? comp.substring(prefix.length) : comp;
          
          // 检查补全项是否以输入开头
          if (compWithoutPrefix.startsWith(commandInputTrimmed)) {
            const remaining = compWithoutPrefix.substring(commandInputTrimmed.length).trim();
            if (remaining) {
              // 有剩余部分，说明是子命令或参数补全
              // 如果补全项比输入长且没有末尾空格，可能是参数补全，提取最后一个词（参数值）
              if (compWithoutPrefix.length > commandInputTrimmed.length && !hasTrailingSpace) {
                // 参数补全：提取补全项的最后一个词
                const compWords = compWithoutPrefix.split(/\s+/);
                const inputWords = commandInputTrimmed.split(/\s+/);
                // 如果补全项的词数大于等于输入，且最后一个词不同，说明是参数补全
                if (compWords.length >= inputWords.length && 
                    compWords[compWords.length - 1] !== inputWords[inputWords.length - 1]) {
                  // 返回最后一个词（参数值）
                  return compWords[compWords.length - 1];
                }
              }
              // 否则（子命令补全），只显示剩余部分
              return remaining.startsWith(' ') ? remaining.substring(1) : remaining;
            }
          }
          
          return comp;
        });
      }
      // 否则（顶级命令补全），显示完整命令
    }
    
    // 获取终端宽度（默认80）
    const terminalWidth = process.stdout.columns || 80;
    
    // 计算每个候选的宽度（包括空格分隔符）
    const getDisplayWidth = (text) => {
      // 移除 ANSI 转义码来计算实际显示宽度
      return text.replace(/\u001b\[[0-9;]*m/g, '').length;
    };
    
    // 计算每行可以显示多少个候选
    const candidatesWithWidth = displayCompletions.map((comp, index) => {
      const isSelected = index === this.selectedIndex;
      const displayText = isSelected ? chalk.bold(chalk.yellow(comp)) : comp;
      const width = getDisplayWidth(displayText);
      return { text: displayText, width, index };
    });
    
    // 计算每行可以显示多少个候选（考虑空格）
    let itemsPerLine = 0;
    let currentLineWidth = 0;
    for (const candidate of candidatesWithWidth) {
      const itemWidth = candidate.width + 1; // +1 for space
      if (currentLineWidth + itemWidth > terminalWidth && currentLineWidth > 0) {
        break;
      }
      currentLineWidth += itemWidth;
      itemsPerLine++;
    }
    
    if (itemsPerLine === 0) {
      itemsPerLine = 1; // 至少显示一个
    }
    
    // 计算总行数
    const totalRows = Math.ceil(displayCompletions.length / itemsPerLine);
    
    // 确保 completionStartRow 在有效范围内
    const maxStartRow = Math.max(0, totalRows - this.completionRowsPerPage);
    this.completionStartRow = Math.max(0, Math.min(this.completionStartRow, maxStartRow));
    
    // 计算要显示的行范围
    const startRow = this.completionStartRow;
    const endRow = Math.min(startRow + this.completionRowsPerPage, totalRows);
    
    // 渲染指定范围的行
    for (let row = startRow; row < endRow; row++) {
      const startIndex = row * itemsPerLine;
      const endIndex = Math.min(startIndex + itemsPerLine, displayCompletions.length);
      const rowCandidates = candidatesWithWidth.slice(startIndex, endIndex);
      
      // 构建这一行的文本
      const rowText = rowCandidates.map(c => c.text).join(' ');
      process.stdout.write(rowText);
      
      // 如果不是最后一行，换行
      if (row < endRow - 1) {
        process.stdout.write('\n');
      }
    }
    
    // 计算实际显示的行数
    const displayedRows = endRow - startRow;
    this.lastDisplayedRows = displayedRows; // 保存实际显示的行数，供清除时使用
    
    this.hasCompletionsDisplayed = true; // 标记已显示补全
    
    // 计算需要向上移动多少行（返回到输入行）
    // 注意：我们在渲染补全前已经换行了一次，所以需要向上移动 displayedRows 行回到输入行
    
    // 先移动到行首（确保在正确的列位置）
    readline.cursorTo(process.stdout, 0);
    
    // 向上移动 displayedRows 行回到输入行
    for (let i = 0; i < displayedRows; i++) {
      process.stdout.write('\u001b[A'); // ESC[A 向上移动一行
    }
    
    // 移动到输入行末尾
    readline.cursorTo(process.stdout, inputEndPos);
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
    process.stdout.write(chalk.cyan('> ') + this.currentInput);
    
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
