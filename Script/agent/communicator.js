import { createServer } from 'net';
import { EventEmitter } from 'events';

/**
 * Agent 通信管理器
 * 负责与注入的 Java Agent 进行 Socket 通信
 */
export class AgentCommunicator extends EventEmitter {
  constructor(logger, port = 25575) {
    super();
    this.logger = logger;
    this.port = port;
    this.server = null;
    this.agentSocket = null;
    this.isReady = false;
    this.pendingLogLevel = null;
  }

  /**
   * 启动通信服务器
   * @returns {Promise<void>}
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${this.port} 已被占用`));
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        this.logger.info(`Agent 通信服务器已启动，监听端口 ${this.port}`);
        // 添加小延迟确保服务器完全准备好
        setTimeout(resolve, 100);
      });
    });
  }

  /**
   * 处理 Agent 连接
   */
  handleConnection(socket) {
    this.logger.info('Agent 已连接');
    this.agentSocket = socket;

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      
      // 处理可能包含多条消息的数据
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留不完整的行

      lines.forEach(line => {
        if (line.trim()) {
          this.handleMessage(line.trim());
        }
      });
    });

    socket.on('close', () => {
      this.logger.warn('Agent 连接已关闭');
      this.agentSocket = null;
      this.isReady = false;
      this.emit('disconnected');
    });

    socket.on('error', (err) => {
      this.logger.error(`Agent 连接错误: ${err.message}`);
    });
  }

  /**
   * 处理从 Agent 接收的消息
   */
  handleMessage(message) {
    try {
      const data = JSON.parse(message);
      if (data.type !== 'CHAT_COMMAND') {
        this.logger.debug(`收到 Agent 消息: ${data.type}`);
      }

      switch (data.type) {
        case 'AGENT_READY':
          this.isReady = true;
          this.emit('ready', data.data);
          if (this.pendingLogLevel) {
            this.setLogLevel(this.pendingLogLevel);
          }
          break;

        case 'SERVER_INFO':
          this.emit('serverInfo', data.data);
          this.logger.debug(`服务器信息: ${data.data}`);
          break;

        case 'PONG':
          this.emit('pong', data.data);
          break;

        case 'CLASSES_COUNT':
          this.emit('classesCount', data.data);
          break;

        case 'JVM_INFO':
          this.emit('jvmInfo', data.data);
          break;

        case 'EXECUTE_RESULT':
          this.emit('executeResult', data.data);
          break;

        case 'COMMAND_REGISTERED':
          this.emit('commandRegistered', data.data);
          this.logger.info(`命令注册成功: ${data.data}`);
          break;

        case 'COMMAND_REGISTER_FAILED':
          this.emit('commandRegisterFailed', data.data);
          this.logger.warn(`命令注册失败: ${data.data}`);
          break;

        case 'SERVER_STATUS':
          this.emit('serverStatus', data.data);
          this.logger.info(`服务器状态: ${data.data}`);
          break;

        case 'COMMAND_INFO':
          this.emit('commandInfo', data.data);
          this.logger.info(`命令信息: ${data.data}`);
          break;

        case 'ERROR':
          this.emit('error', data.data);
          this.logger.error(`Agent 错误: ${data.data}`);
          break;

        case 'UNKNOWN_COMMAND':
          this.logger.warn(`Agent: ${data.data}`);
          break;

        case 'CHAT_INTERCEPTED':
          // 拦截事件：格式为 "ruleId|message|playerName"
          const interceptParts = data.data.split('|');
          const ruleId = interceptParts[0] || '';
          const message = interceptParts[1] || '';
          const playerName = interceptParts[2] || 'Unknown';
          this.emit('chatIntercepted', { ruleId, message, playerName });
          break;

        case 'RULE_REGISTERED':
          this.emit('ruleRegistered', data.data);
          break;

        case 'RULE_REGISTER_FAILED':
          this.emit('ruleRegisterFailed', data.data);
          break;

        case 'RULE_UNREGISTERED':
          this.emit('ruleUnregistered', data.data);
          break;

        case 'RULE_NOT_FOUND':
          this.emit('ruleNotFound', data.data);
          break;

        case 'RULES_LIST':
          this.emit('rulesList', data.data);
          break;

        case 'RULES_CLEARED':
          this.emit('rulesCleared', data.data);
          break;

        case 'LOG_LEVEL_UPDATED':
          this.logger.debug(`Agent 日志级别已更新为: ${data.data}`);
          this.emit('logLevelUpdated', data.data);
          break;

        default:
          this.logger.warn(`未知的 Agent 消息类型: ${data.type}`);
      }

    } catch (err) {
      this.logger.error(`解析 Agent 消息失败: ${err.message}`);
      this.logger.debug(`原始消息: ${message}`);
    }
  }

  /**
   * 发送消息到 Agent
   */
  sendMessage(type, data = '') {
    if (!this.agentSocket) {
      this.logger.warn('Agent 未连接，无法发送消息');
      return false;
    }

    const message = JSON.stringify({ type, data });
    this.agentSocket.write(message + '\n');
    this.logger.debug(`发送消息到 Agent: ${type}`);
    return true;
  }

  setLogLevel(level) {
    if (!level) {
      return false;
    }
    this.pendingLogLevel = level;
    if (!this.isConnected()) {
      this.logger.debug('Agent 未连接，延迟同步日志级别');
      return false;
    }
    const normalized = String(level).toUpperCase();
    this.logger.debug(`同步 Agent 日志级别: ${normalized}`);
    return this.sendMessage('SET_LOG_LEVEL', normalized);
  }

  /**
   * Ping Agent
   */
  ping() {
    return this.sendMessage('PING');
  }

  /**
   * 获取已加载的类数量
   */
  getClassesCount() {
    return this.sendMessage('GET_CLASSES');
  }

  /**
   * 获取 JVM 信息
   */
  getJVMInfo() {
    return this.sendMessage('GET_JVM_INFO');
  }

  /**
   * 执行代码（预留）
   */
  execute(code) {
    return this.sendMessage('EXECUTE', code);
  }

  /**
   * 注册命令到游戏
   */
  registerCommand(commandName) {
    return this.sendMessage('REGISTER_COMMAND', commandName);
  }

  /**
   * 关闭 Agent
   */
  shutdown() {
    if (this.agentSocket) {
      this.sendMessage('SHUTDOWN');
    }
  }

  /**
   * 停止通信服务器
   */
  stop() {
    return new Promise((resolve) => {
      if (this.agentSocket) {
        this.agentSocket.destroy();
        this.agentSocket = null;
      }

      if (this.server) {
        this.server.close(() => {
          this.logger.info('Agent 通信服务器已关闭');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 检查是否已连接
   */
  isConnected() {
    return this.agentSocket !== null && this.isReady;
  }

  /**
   * 检查通信服务器是否在监听
   */
  isListening() {
    return !!(this.server && this.server.listening);
  }
}

