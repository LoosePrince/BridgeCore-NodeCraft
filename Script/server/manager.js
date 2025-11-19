import { spawn } from 'child_process';
import { join } from 'path';

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

    // 处理标准输出
        this.serverProcess.stdout.on('data', (data) => {
          const lines = data.toString().split('\n').filter(line => line.trim());
          lines.forEach(line => {
        const handled = this.outputProcessor?.handleLine?.(line, 'stdout');
        if (!handled) {
            this.logger.serverOutput(line);
        }
          });
        });

    // 处理标准错误输出
        this.serverProcess.stderr.on('data', (data) => {
          const lines = data.toString().split('\n').filter(line => line.trim());
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
        this._isShuttingDown = false;
        return;
      }

      this.logger.warn(`服务器进程退出 (代码: ${code}, 信号: ${signal})`);

      // 自动重启逻辑
      if (this.config.autoRestart.enabled) {
        const maxRestarts = this.config.autoRestart.maxRestarts;
        if (maxRestarts === 0 || this.restartCount < maxRestarts) {
          this.restartCount++;
          const delay = this.config.autoRestart.delay;
              this.logger.info(`${delay} 秒后自动重启服务器 (第 ${this.restartCount} 次)...`);
          
          setTimeout(async () => {
            await this.start();
          }, delay * 1000);
        } else {
              this.logger.error(`已达到最大重启次数 (${maxRestarts})，停止自动重启`);
        }
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


