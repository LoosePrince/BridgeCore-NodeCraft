import { spawn } from 'child_process';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import iconv from 'iconv-lite';

/**
 * 服务器管理器类
 */
export class ServerManager {
  constructor(config, logger, projectRoot, options = {}) {
    this.config = config;
    this.logger = logger;
    this.projectRoot = projectRoot;
    this.serverProcess = null;
    this.restartCount = 0;
    this._isShuttingDown = false;
    this.forceKillTimer = null;
    this.eventBus = options.eventBus || null;
    this.outputProcessor = options.outputProcessor || null;
    this.eulaHandled = false; // 标记是否已处理 EULA
    
    // 监听服务器日志行，检测 EULA 提示
    if (this.eventBus) {
      this.eventBus.on('server:line', (context) => {
        this.handleEulaPrompt(context.line);
      });
    }
  }

  /**
   * 获取关闭状态
   */
  get isShuttingDown() {
    return this._isShuttingDown;
  }

  /**
   * 设置关闭状态
   */
  set isShuttingDown(value) {
    this._isShuttingDown = value;
  }

  /**
   * 启动服务器
   */
  async start() {
    if (this.serverProcess) {
      this.logger.warn('服务器已在运行中');
      return;
    }

    // 重置 EULA 处理标志（每次启动时重置）
    this.eulaHandled = false;

    const serverConfig = this.config.server;
    const serverDir = join(this.projectRoot, serverConfig.directory);
    const commandString = serverConfig.startCommand || serverConfig.start_command;
    if (!commandString || typeof commandString !== 'string') {
      this.logger.error('startCommand 未配置，请在 config.yml 中设置 server.startCommand');
      process.exit(1);
    }
    const { command, args } = parseCommandString(commandString);
    if (!command) {
      this.logger.error('无法解析 startCommand，请确认配置');
      process.exit(1);
    }

    this.logger.info(`正在启动服务器...`);
    this.logger.debug(`工作目录: ${serverDir}`);
    this.logger.debug(`启动命令: ${command} ${args.join(' ')}`);

    // 启动服务器进程
    this.serverProcess = spawn(command, args, {
      cwd: serverDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    });

    // 获取编码配置，默认为 utf-8
    const encoding = this.config.server?.encoding || 'utf-8';
    const isGBK = encoding.toLowerCase() === 'gbk';

    // 处理标准输出
    if (!isGBK && this.serverProcess.stdout.setEncoding) {
      // UTF-8 可以使用 setEncoding
      this.serverProcess.stdout.setEncoding('utf8');
    }
    this.serverProcess.stdout.on('data', (data) => {
      // 使用配置的编码解析
      let text;
      if (isGBK) {
        // GBK 使用 iconv-lite 转换
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        text = iconv.decode(buffer, 'gbk');
      } else {
        text = typeof data === 'string' ? data : data.toString('utf8');
      }
      const lines = text.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        const handled = this.outputProcessor?.handleLine?.(line, 'stdout');
        if (!handled) {
          this.logger.serverOutput(line);
        }
      });
    });

    // 处理标准错误输出
    if (!isGBK && this.serverProcess.stderr.setEncoding) {
      // UTF-8 可以使用 setEncoding
      this.serverProcess.stderr.setEncoding('utf8');
    }
    this.serverProcess.stderr.on('data', (data) => {
      // 使用配置的编码解析
      let text;
      if (isGBK) {
        // GBK 使用 iconv-lite 转换
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        text = iconv.decode(buffer, 'gbk');
      } else {
        text = typeof data === 'string' ? data : data.toString('utf8');
      }
      const lines = text.split('\n').filter(line => line.trim());
      lines.forEach(line => {
        const handled = this.outputProcessor?.handleLine?.(line, 'stderr');
        if (!handled) {
          this.logger.serverOutput(line);
        }
      });
    });

    // 处理进程退出
    this.serverProcess.on('exit', (code, signal) => {
      this.serverProcess = null;
      
      if (this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = null;
      }
      
      if (this._isShuttingDown) {
        this.logger.info('服务器已关闭');
        // 触发服务器关闭事件
        this.eventBus?.emit('server:closed', {
          code,
          signal,
          timestamp: Date.now()
        });
        this._isShuttingDown = false;
        this.eulaHandled = false; // 重置 EULA 处理标志
        return;
      }

      this.logger.warn(`服务器进程退出 (代码: ${code}, 信号: ${signal})`);

      // 如果是因为 EULA 问题退出，自动重启
      const shouldAutoRestart = this.eulaHandled || this.config.autoRestart.enabled;
      
      if (shouldAutoRestart) {
        // 如果是因为 EULA 问题，立即重启（不等待）
        const delay = this.eulaHandled ? 1 : this.config.autoRestart.delay;
        const maxRestarts = this.config.autoRestart.maxRestarts;
        
        if (this.eulaHandled) {
          this.logger.info('EULA 已同意，正在自动重启服务器...');
          this.eulaHandled = false; // 重置标志
        } else if (this.config.autoRestart.enabled) {
        if (maxRestarts === 0 || this.restartCount < maxRestarts) {
          this.restartCount++;
              this.logger.info(`${delay} 秒后自动重启服务器 (第 ${this.restartCount} 次)...`);
          } else {
            this.logger.error(`已达到最大重启次数 (${maxRestarts})，停止自动重启`);
            this.eulaHandled = false; // 重置标志
            return;
          }
        }
          
          setTimeout(async () => {
            await this.start();
          }, delay * 1000);
        } else {
        this.eulaHandled = false; // 重置标志
      }
    });

    // 处理进程错误
    this.serverProcess.on('error', (error) => {
      this.logger.error(`启动服务器时发生错误: ${error.message}`);
      if (error.code === 'ENOENT') {
        this.logger.error(`请检查 Java 路径是否正确: ${serverConfig.javaPath}`);
      }
    });

  }

  /**
   * 停止服务器
   */
  stop() {
    if (!this.serverProcess) {
      this.logger.warn('服务器未运行');
      return;
    }

    this._isShuttingDown = true;
    this.logger.info('正在关闭服务器...');
    
    // 触发服务器关闭开始事件
    this.eventBus?.emit('server:closing', {
      timestamp: Date.now()
    });
    
    // 发送停止命令
    this.sendCommand('stop');
    
    // 如果 10 秒后进程还在运行，强制终止
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
    }
    this.forceKillTimer = setTimeout(() => {
      if (this.serverProcess) {
            this.logger.warn('强制终止服务器进程');
        this.serverProcess.kill('SIGKILL');
      }
      this.forceKillTimer = null;
    }, 10000);
  }

  /**
   * 发送命令到服务器
   * @param {string} command - 要发送的命令
   */
  sendCommand(command) {
    if (!this.serverProcess) {
      this.logger.warn('服务器未运行，无法发送命令');
      return;
    }

    this.logger.debug(`发送命令: ${command}`);
    this.serverProcess.stdin.write(command + '\n');
  }

  /**
   * 获取服务器进程状态
   * @returns {boolean} 服务器是否运行中
   */
  isRunning() {
    return this.serverProcess !== null;
  }

  /**
   * 获取当前服务器进程 PID
   */
  getProcessId() {
    return this.serverProcess?.pid ?? null;
  }

  /**
   * 处理 EULA 提示
   * @param {string} line - 日志行
   */
  handleEulaPrompt(line) {
    // 检查是否包含 EULA 提示消息
    if (this.eulaHandled) {
      return;
    }

    const eulaPatterns = [
      /You need to agree to the EULA in order to run the server/i,
      /需要同意 EULA 才能运行服务器/i,
      /eula\.txt/i
    ];

    const hasEulaPrompt = eulaPatterns.some(pattern => pattern.test(line));
    
    if (!hasEulaPrompt) {
      return;
    }

    this.eulaHandled = true;
    
    // 获取服务器目录
    const serverConfig = this.config.server;
    const serverDir = join(this.projectRoot, serverConfig.directory);
    const eulaPath = join(serverDir, 'eula.txt');

    try {
      // 检查 eula.txt 是否存在
      if (!existsSync(eulaPath)) {
        this.logger.warn('未找到 eula.txt 文件，将创建新文件');
        writeFileSync(eulaPath, 'eula=true\n', 'utf8');
        this.logger.info('已自动创建并同意 EULA');
      } else {
        // 读取现有文件
        let content = readFileSync(eulaPath, 'utf8');
        
        // 检查是否已经是 true
        if (/eula\s*=\s*true/i.test(content)) {
          this.logger.info('EULA 已同意，无需修改');
          return;
        }

        // 替换 eula=false 为 eula=true
        content = content.replace(/eula\s*=\s*false/gi, 'eula=true');
        
        // 如果没有找到 eula=false，直接添加 eula=true
        if (!/eula\s*=/i.test(content)) {
          content = content.trim() + '\neula=true\n';
        }

        writeFileSync(eulaPath, content, 'utf8');
        this.logger.info('已自动同意 EULA，服务器将在下次启动时继续运行');
      }

      this.logger.info('提示：EULA 已自动同意，如需重新设置请编辑 eula.txt 文件');
    } catch (error) {
      this.logger.error(`处理 EULA 时出错: ${error.message}`);
    }
  }
}

function parseCommandString(commandString) {
  const regex = /"([^"]+)"|'([^']+)'|[^\s]+/g;
  const parts = [];
  let match;
  while ((match = regex.exec(commandString)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[0]);
  }
  const [command, ...args] = parts;
  return {
    command,
    args
  };
}


