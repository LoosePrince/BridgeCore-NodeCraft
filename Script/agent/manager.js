import { AgentInjector } from './injector.js';
import { AgentCommunicator } from './communicator.js';
import { AgentInterceptor } from './interceptor.js';
import { MappingService } from './mapping-service.js';
import { PlayerListManager } from './player-list-manager.js';
import { resolveAttachableJavaPid } from '../utils/process-utils.js';

/**
 * Agent 管理器
 * 统一管理 Agent 的注入和通信
 */
export class AgentManager {
  constructor(logger, config, serverManager, dataStore = null) {
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
    this.playerListManager = new PlayerListManager(logger);
    this.dataStore = dataStore;
    this.updateDataStoreStatus();
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
      this.updateDataStoreStatus();
      return true;
    } catch (error) {
      this.logger.error(`Agent 注入失败: ${error.message}`);
      this.isInjected = false;
      this.updateDataStoreStatus();
      
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
      this.communicator.getJVMInfo();
      this.updateDataStoreStatus();
      // 调用回调函数（如果已设置）
      if (this.onAgentReady) {
        this.onAgentReady();
      }
    });

    this.communicator.on('serverInfo', (data) => {
      this.logger.debug(`服务器信息: ${data}`);
      this.handleServerInfoPayload(data);
    });

    this.communicator.on('disconnected', () => {
      this.logger.warn('Agent 已断开连接');
      this.isInjected = false;
      this.updateDataStoreStatus();
    });

    this.communicator.on('jvmInfo', (data) => {
      this.logger.debug(`JVM 信息: ${data}`);
      this.handleJvmInfoPayload(data);
    });

    this.communicator.on('classesCount', (data) => {
      this.logger.info(`${data}`);
    });

    this.communicator.on('mappingRequest', (payload) => {
      this.handleMappingRequest(payload);
    });

    this.communicator.on('mappingReady', (payload) => {
      this.handleMappingReadyNotification(payload);
    });

    this.communicator.on('mappingFailed', (payload) => {
      this.handleMappingFailedNotification(payload);
    });

    this.communicator.on('serverMetadata', (payload) => {
      this.handleServerMetadata(payload);
    });

    this.communicator.on('playerListUpdated', (players) => {
      this.handlePlayerListUpdated(players);
    });

  }

  /**
   * 获取拦截器实例
   * 供外部使用，用于注册自定义拦截规则
   */
  getInterceptor() {
    return this.interceptor;
  }

  /**
   * 获取玩家列表管理器实例
   * 供外部使用，用于访问玩家列表 API
   */
  getPlayerListManager() {
    return this.playerListManager;
  }

  /**
   * 注册基于事件的玩家在线追踪器，作为 Agent 数据的补充
   * @param {object} tracker
   */
  setPresenceTracker(tracker) {
    if (!this.playerListManager) {
      return;
    }
    this.playerListManager.setFallbackSource(tracker);
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
    this.updateDataStoreStatus();
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
    if (version) {
      this.dataStore?.setServerMetadata({ version });
    }
    this.dataStore?.setMappingState({
      status: 'downloading',
      version,
      path: outputPath,
      source: 'agent-request',
      error: null
    });

    try {
      const result = await this.mappingService.ensureMapping(version, outputPath);
      const response = JSON.stringify({
        version,
        path: outputPath,
        status: result.status
      });
      this.dataStore?.setMappingState({
        status: 'ready',
        version,
        path: outputPath,
        source: result.status,
        error: null
      });
      this.communicator?.sendMessage?.('MAPPING_READY', response);
    } catch (err) {
      const message = err?.message || '未知错误';
      this.logger?.error?.(`映射表下载失败: ${message}`);
      this.dataStore?.setMappingState({
        status: 'failed',
        version,
        path: outputPath,
        source: 'download',
        error: message
      });
      this.communicator?.sendMessage?.('MAPPING_FAILED', message);
    }
  }

  handleServerMetadata(payload) {
    if (!payload || !this.dataStore) {
      return;
    }
    try {
      const meta = JSON.parse(payload);
      this.dataStore.setServerMetadata(meta);
    } catch (error) {
      this.logger?.debug?.(`解析 SERVER_METADATA 失败: ${error.message}`);
    }
  }

  handleServerInfoPayload(text) {
    if (!text || !this.dataStore) {
      return;
    }
    const info = parseServerInfo(text);
    if (info) {
      this.dataStore.setRuntimeInfo(info);
    }
  }

  handleJvmInfoPayload(text) {
    if (!text || !this.dataStore) {
      return;
    }
    const info = parseJvmInfo(text);
    if (info) {
      this.dataStore.setJvmInfo(info);
    }
  }

  updateDataStoreStatus() {
    if (!this.dataStore) {
      return;
    }
    this.dataStore.updateStatus({
      connected: this.communicator?.isConnected?.() ?? false,
      injected: this.isInjected
    });
  }

  handleMappingReadyNotification(payload) {
    if (!this.dataStore) {
      return;
    }
    const info = parseMappingPayload(payload);
    this.dataStore.setMappingState({
      status: info?.status ?? 'ready',
      version: info?.version ?? null,
      path: info?.path ?? null,
      source: info?.source ?? 'agent',
      error: null
    });
  }

  handleMappingFailedNotification(payload) {
    if (!this.dataStore) {
      return;
    }
    const info = parseMappingPayload(payload);
    this.dataStore.setMappingState({
      status: 'failed',
      version: info?.version ?? null,
      path: info?.path ?? null,
      source: info?.source ?? 'agent',
      error: info?.error ?? payload ?? '未知错误'
    });
  }

  handlePlayerListUpdated(players) {
    if (!Array.isArray(players)) {
      this.logger?.warn?.('玩家列表更新失败: 数据格式错误');
      return;
    }
    this.playerListManager.updatePlayers(players);
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

function parseServerInfo(text) {
  const loadedMatch = /Loaded Classes:\s*(\d+)/i.exec(text);
  const retransformMatch = /Retransform Capable:\s*(true|false)/i.exec(text);
  const redefineMatch = /Redefine Capable:\s*(true|false)/i.exec(text);
  if (!loadedMatch && !retransformMatch && !redefineMatch) {
    return null;
  }
  return {
    loadedClasses: loadedMatch ? Number(loadedMatch[1]) : null,
    canRetransform: retransformMatch ? retransformMatch[1].toLowerCase() === 'true' : null,
    canRedefine: redefineMatch ? redefineMatch[1].toLowerCase() === 'true' : null
  };
}

function parseJvmInfo(text) {
  const javaMatch = /Java:\s*([^,]+)/i.exec(text);
  const memoryMatch = /Memory:\s*([\d.]+)\s*MB\s*\/\s*([\d.]+)\s*MB/i.exec(text);
  const procMatch = /Processors:\s*(\d+)/i.exec(text);
  if (!javaMatch && !memoryMatch && !procMatch) {
    return null;
  }
  return {
    java: javaMatch ? javaMatch[1].trim() : null,
    memory: memoryMatch
      ? { usedMB: Number(memoryMatch[1]), maxMB: Number(memoryMatch[2]) }
      : { usedMB: null, maxMB: null },
    processors: procMatch ? Number(procMatch[1]) : null
  };
}

function parseMappingPayload(payload) {
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

