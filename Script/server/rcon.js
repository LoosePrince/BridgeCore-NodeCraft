import { EventEmitter } from 'events';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { Rcon } from 'rcon-client';

/**
 * 读取 server.properties
 * @param {string} content
 * @returns {Record<string,string>}
 */
function parseProperties(content) {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=');
      if (idx === -1) {
        return acc;
      }
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

/**
 * RCON 管理器
 */
export class RconManager extends EventEmitter {
  constructor({ config, logger, projectRoot }) {
    super();
    this.config = config;
    this.logger = logger;
    this.projectRoot = projectRoot;
    this.settings = null;
    this.client = null;
    this.connected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.autoConnectEnabled = false;
    this._onEnd = () => this.handleConnectionClosed('end');
    this._onClose = () => this.handleConnectionClosed('close');
    this._onError = (error) => this.handleClientError(error);
  }

  isEnabled() {
    const enabled = this.config?.rcon?.enabled;
    return typeof enabled === 'boolean' ? enabled : true;
  }

  isConnected() {
    return this.connected;
  }

  /**
   * 初始化（解析配置信息）
   */
  async init({ autoConnect = true } = {}) {
    if (!this.isEnabled()) {
      return;
    }
    this.settings = await this.resolveSettings();
    if (!this.settings) {
      this.logger.warn('无法初始化 RCON，配置不完整');
      return;
    }
    const { host, port } = this.settings;
    this.logger.debug(`RCON 配置已加载: ${host}:${port}`);
    if (autoConnect) {
      await this.startAutoConnect();
    }
  }

  /**
   * 开始自动连接
   */
  async startAutoConnect() {
    if (!this.isEnabled()) {
      return;
    }
    if (!this.settings) {
      await this.init({ autoConnect: false });
      if (!this.settings) {
        return;
      }
    }
    if (this.autoConnectEnabled) {
      return;
    }

    this.autoConnectEnabled = true;
    await this.connect();
  }

  /**
   * 解析 server.properties 或 config.yml 中的 RCON 设置
   */
  async resolveSettings() {
    const serverCfg = this.config.server || {};
    const serverDir = join(this.projectRoot, serverCfg.directory || '.');
    const propertiesPath = join(serverDir, 'server.properties');

    let props = {};
    if (existsSync(propertiesPath)) {
      try {
        const content = readFileSync(propertiesPath, 'utf8');
        props = parseProperties(content);
      } catch (error) {
        this.logger.warn(`读取 server.properties 失败: ${error.message}`);
      }
    } else {
      this.logger.warn('未找到 server.properties，无法自动检测 RCON 设置');
      return null;
    }

    const enableRcon = props['enable-rcon'];
    if (enableRcon !== 'true') {
      this.logger.warn('server.properties 中 RCON 未启用 (enable-rcon=true)，将不会连接 RCON');
      return null;
    }

    const host = props['server-ip'] && props['server-ip'] !== '' ? props['server-ip'] : '127.0.0.1';
    const port = props['rcon.port'] ? Number(props['rcon.port']) : 25575;
    const password = props['rcon.password'];
    const timeout = 5000;
    const autoReconnect = true;
    const reconnectInterval = 5000;

    if (!password) {
      this.logger.error('未找到 RCON 密码，请在 server.properties 中设置 rcon.password');
      return null;
    }

    return {
      host,
      port,
      password,
      timeout,
      autoReconnect,
      reconnectInterval
    };
  }

  async connect() {
    if (!this.isEnabled() || !this.settings) {
      return;
    }

    if (this.connected || this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    try {
      const { host, port, password, timeout } = this.settings;
      this.logger.debug(`正在连接 RCON ${host}:${port}`);
      this.client = await Rcon.connect({ host, port, password, timeout });
      this.connected = true;
      this.logger.info('RCON 已连接');
      this.emit('connected');

      this.client.on('end', this._onEnd);
      this.client.on('close', this._onClose);
      this.client.on('error', this._onError);
    } catch (error) {
      this.logger.debug(`RCON 连接失败: ${error.message}`);
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  handleClientError(error) {
    this.logger.error(`RCON 错误: ${error.message}`);
    this.emit('error', error);
  }

  handleConnectionClosed(reason) {
    if (this.client) {
      if (typeof this.client.off === 'function') {
        this.client.off('end', this._onEnd);
        this.client.off('close', this._onClose);
        this.client.off('error', this._onError);
      } else if (typeof this.client.removeListener === 'function') {
        this.client.removeListener('end', this._onEnd);
        this.client.removeListener('close', this._onClose);
        this.client.removeListener('error', this._onError);
      } else if (typeof this.client.removeAllListeners === 'function') {
        this.client.removeAllListeners();
      }
      this.client = null;
    }
    if (this.connected) {
      this.logger.warn(`RCON 连接已断开 (${reason})`);
      this.emit('disconnected', reason);
    }
    this.connected = false;
    if (this.autoConnectEnabled) {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (!this.settings || !this.settings.autoReconnect) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }
    const delay = Math.max(1000, this.settings.reconnectInterval);
    this.logger.debug(`将在 ${(delay / 1000).toFixed(1)} 秒后重试 RCON 连接`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async ensureConnected() {
    if (this.connected && this.client) {
      return true;
    }
    await this.connect();
    return this.connected;
  }

  async send(command) {
    if (!this.isEnabled()) {
      throw new Error('RCON 未启用');
    }
    const ok = await this.ensureConnected();
    if (!ok) {
      throw new Error('RCON 未连接');
    }
    return this.client.send(command);
  }

  async disconnect() {
    this.autoConnectEnabled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        // 忽略
      }
      this.client = null;
    }
    this.connected = false;
  }

  getPublicApi() {
    const disabledApi = {
      isEnabled: () => false,
      isConnected: () => false,
      getSettings: () => null,
      send: async () => {
        throw new Error('RCON 未启用');
      },
      connect: async () => {
        throw new Error('RCON 未启用');
      },
      disconnect: async () => {},
      ensureConnected: async () => false
    };

    if (!this.isEnabled()) {
      return disabledApi;
    }

    return {
      isEnabled: () => this.isEnabled(),
      isConnected: () => this.isConnected(),
      getSettings: () => (this.settings ? { ...this.settings } : null),
      send: (cmd) => this.send(cmd),
      connect: () => this.connect(),
      ensureConnected: () => this.ensureConnected(),
      disconnect: () => this.disconnect()
    };
  }
}

