import { AgentInjector } from './injector.js';
import { AgentCommunicator } from './communicator.js';
import { AgentInterceptor } from './interceptor.js';
import { MappingService } from './mapping-service.js';
import { resolveAttachableJavaPid } from '../utils/process-utils.js';

/**
 * Agent 管理器
 * 统一管理 Agent 的注入和通信
 */
export class AgentManager {
  constructor(logger, config, serverManager) {
    this.logger = logger;
    this.config = config;
    this.injector = new AgentInjector(logger, config);
    this.communicator = null;
    this.interceptor = null;
    this.communicationPort = config?.agent?.port || 25575;
    this.isInjected = false;
    this.serverManager = serverManager;
    this.listenersReady = false;
    this.pendingLogLevel = this.logger?.getLevel?.() || null;
    this.onAgentReady = null; // 回调函数，在 Agent ready 时调用
    this.mappingService = new MappingService(logger);
  }

  /**
   * 注入 Agent
   * @param {string|number} pid - 进程ID，或 'auto' 自动查找
   */
  async inject(pid = 'auto') {
    try {
      const targetPid = this.resolveTargetPid(pid);
      if (!targetPid) {
        throw new Error('无法确定服务器 PID，请手动指定进程或确保服务器由 BCNC 启动');
      }

      await this.ensureCommunicator();

      // 初始化拦截器
      if (!this.interceptor) {
        this.interceptor = new AgentInterceptor(this.communicator, this.logger);
      }

      // 设置事件监听
      if (!this.listenersReady) {
        this.setupEventListeners();
        this.listenersReady = true;
      }

      // 注入 Agent
      await this.injector.inject(String(targetPid), this.communicationPort);
      
      this.isInjected = true;
      return true;
    } catch (error) {
      this.logger.error(`Agent 注入失败: ${error.message}`);
      
      // 清理
      if (this.communicator) {
        await this.communicator.stop();
        this.communicator = null;
      }
      this.interceptor = null;
      this.listenersReady = false;
      
      throw error;
    }
  }

  async ensureCommunicator() {
    if (this.communicator && this.communicator.isListening()) {
      this.logger.debug(`通信服务器已在端口 ${this.communicationPort} 监听，复用现有实例`);
      return;
    }

    if (this.communicator) {
      await this.communicator.stop();
      this.communicator = null;
      this.interceptor = null;
      this.listenersReady = false;
    }

    this.communicator = new AgentCommunicator(this.logger, this.communicationPort);
    await this.communicator.start();
    if (this.logger?.getLevel) {
      this.pendingLogLevel = this.logger.getLevel();
      this.communicator.pendingLogLevel = this.pendingLogLevel;
    }
  }

  /**
   * 设置事件监听
   */
  setupEventListeners() {
    if (!this.communicator) {
      return;
    }

    this.communicator.on('ready', (data) => {
      this.logger.info(`Agent 就绪: ${data}`);
      this.syncAgentLogLevel();
      // 调用回调函数（如果已设置）
      if (this.onAgentReady) {
        this.onAgentReady();
      }
    });

    this.communicator.on('serverInfo', (data) => {
      this.logger.info(`服务器信息: ${data}`);
    });

    this.communicator.on('disconnected', () => {
      this.logger.warn('Agent 已断开连接');
      this.isInjected = false;
    });

    this.communicator.on('jvmInfo', (data) => {
      this.logger.info(`JVM 信息: ${data}`);
    });

    this.communicator.on('classesCount', (data) => {
      this.logger.info(`${data}`);
    });

    this.communicator.on('mappingRequest', (payload) => {
      this.handleMappingRequest(payload);
    });

  }

  /**
   * 获取拦截器实例
   * 供外部使用，用于注册自定义拦截规则
   */
  getInterceptor() {
    return this.interceptor;
  }

  syncAgentLogLevel(level) {
    const targetLevel = level || this.logger?.getLevel?.();
    if (!targetLevel) {
      return false;
    }
    this.pendingLogLevel = targetLevel;
    if (this.communicator?.setLogLevel) {
      return this.communicator.setLogLevel(targetLevel);
    }
    return false;
  }

  /**
   * 编译 Agent
   */
  async compile() {
    return await this.injector.compile();
  }

  /**
   * 发送 Ping
   */
  ping() {
    if (!this.communicator) {
      this.logger.warn('通信器未初始化');
      return false;
    }
    return this.communicator.ping();
  }

  /**
   * 获取 JVM 信息
   */
  getJVMInfo() {
    if (!this.communicator) {
      this.logger.warn('通信器未初始化');
      return false;
    }
    return this.communicator.getJVMInfo();
  }

  /**
   * 获取已加载的类数量
   */
  getClassesCount() {
    if (!this.communicator) {
      this.logger.warn('通信器未初始化');
      return false;
    }
    return this.communicator.getClassesCount();
  }

  /**
   * 注册命令到游戏
   */
  registerGameCommand(commandName) {
    if (!this.communicator) {
      this.logger.warn('通信器未初始化');
      return false;
    }
    return this.communicator.registerCommand(commandName);
  }

  /**
   * 关闭 Agent
   */
  async shutdown() {
    if (this.communicator) {
      this.communicator.shutdown();
      await this.communicator.stop();
      this.communicator = null;
    }
    this.interceptor = null;
    this.isInjected = false;
    this.listenersReady = false;
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      injected: this.isInjected,
      connected: this.communicator ? this.communicator.isConnected() : false,
      port: this.communicationPort,
      serverPid: this.serverManager?.getProcessId?.() ?? null,
      paths: this.injector.getAgentPaths()
    };
  }

  async handleMappingRequest(payload) {
    if (!payload) {
      this.communicator?.sendMessage?.('MAPPING_FAILED', '映射请求为空');
      return;
    }

    let request;
    try {
      request = JSON.parse(payload);
    } catch (err) {
      const message = `解析映射请求失败: ${err.message}`;
      this.logger?.error?.(message);
      this.communicator?.sendMessage?.('MAPPING_FAILED', message);
      return;
    }

    const version = request?.version;
    const outputPath = request?.path;

    try {
      const result = await this.mappingService.ensureMapping(version, outputPath);
      const response = JSON.stringify({
        version,
        path: outputPath,
        status: result.status
      });
      this.communicator?.sendMessage?.('MAPPING_READY', response);
    } catch (err) {
      const message = err?.message || '未知错误';
      this.logger?.error?.(`映射表下载失败: ${message}`);
      this.communicator?.sendMessage?.('MAPPING_FAILED', message);
    }
  }

  resolveTargetPid(pid) {
    if (pid && pid !== 'auto') {
      return pid;
    }
    const serverPid = this.serverManager?.getProcessId?.() ?? null;
    if (!serverPid) {
      return null;
    }
    const resolvedPid = resolveAttachableJavaPid(serverPid);
    if (resolvedPid && resolvedPid !== serverPid) {
      this.logger?.debug?.(`检测到 Java 子进程 PID: ${resolvedPid} (父进程 ${serverPid})`);
      return resolvedPid;
    }
    return resolvedPid || serverPid;
  }
}

