import { EventEmitter } from 'events';

/**
 * 玩家列表管理器
 * 负责管理在线玩家列表，并提供 API 给插件使用
 */
export class PlayerListManager extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.agentPlayers = new Map(); // uuid(lowercase) -> { name, uuid, lastUpdate }
    this.fallbackSource = null;
    this.fallbackHandlers = [];
    this.lastUpdateTime = null;
    this.agentLastUpdateTime = null;
  }

  /**
   * Agent 推送的玩家列表更新
   * @param {Array<{name: string, uuid: string}>} players - 玩家列表
   */
  updatePlayers(players) {
    if (!Array.isArray(players)) {
      this.logger.warn('玩家列表更新失败: 数据格式错误');
      return;
    }

    const previousPlayers = new Map(this.agentPlayers);
    const now = Date.now();
    const added = [];
    const removed = [];

    for (const player of players) {
      if (!player || !player.name) {
        continue;
      }
      const uuidRaw = player.uuid || null;
      const uuidKey = uuidRaw ? uuidRaw.toLowerCase() : player.name.toLowerCase();

      const existing = this.agentPlayers.get(uuidKey);
      if (existing) {
        if (existing.name !== player.name) {
          this.logger.debug(`玩家名称更新: ${existing.name} -> ${player.name} (${uuidRaw || 'unknown'})`);
          this.emit('playerNameChanged', {
            uuid: uuidRaw || null,
            oldName: existing.name,
            newName: player.name
          });
        }
        existing.name = player.name;
        existing.uuid = uuidRaw;
        existing.lastUpdate = now;
      } else {
        this.agentPlayers.set(uuidKey, {
          name: player.name,
          uuid: uuidRaw,
          lastUpdate: now
        });
        added.push({ name: player.name, uuid: uuidRaw });
        this.logger.debug(`玩家上线: ${player.name} (${uuidRaw || 'unknown'})`);
        this.emit('playerJoined', { name: player.name, uuid: uuidRaw });
      }
      previousPlayers.delete(uuidKey);
    }

    for (const [uuidKey, player] of previousPlayers.entries()) {
      this.agentPlayers.delete(uuidKey);
      removed.push({ name: player.name, uuid: player.uuid });
      this.logger.debug(`玩家离线: ${player.name} (${player.uuid || 'unknown'})`);
      this.emit('playerLeft', { name: player.name, uuid: player.uuid });
    }

    this.agentLastUpdateTime = now;
    this.updateLastUpdateTime();

    if (added.length > 0 || removed.length > 0) {
      this.emit('listUpdated', {
        source: 'agent',
        players: this.getAllPlayers(),
        added,
        removed
      });
    } else {
      this.logger.debug(`玩家列表已更新 (Agent)，人数 ${this.agentPlayers.size}`);
    }
  }

  /**
   * 绑定事件驱动的玩家追踪器，补全或兜底玩家数据
   * @param {EventEmitter & { list: Function, getByUuid: Function, getByName: Function, count: Function, getLastUpdateTime: Function }} tracker
   */
  setFallbackSource(tracker) {
    if (this.fallbackSource === tracker) {
      return;
    }
    this.cleanupFallbackHandlers();
    this.fallbackSource = tracker;
    if (!tracker || typeof tracker.on !== 'function') {
      return;
    }

    const bridge = (event, handler) => {
      tracker.on(event, handler);
      this.fallbackHandlers.push({ event, handler });
    };

    bridge('playerJoined', (payload) => {
      if (!this.hasAgentSnapshot()) {
        this.emit('playerJoined', payload);
      }
      this.emit('fallbackPlayerJoined', payload);
    });

    bridge('playerLeft', (payload) => {
      if (!this.hasAgentSnapshot()) {
        this.emit('playerLeft', payload);
      }
      this.emit('fallbackPlayerLeft', payload);
    });

    bridge('listUpdated', () => {
      this.updateLastUpdateTime();
      this.emit('listUpdated', {
        source: this.hasAgentSnapshot() ? 'agent+events' : 'events',
        players: this.getAllPlayers()
      });
    });

    bridge('listCleared', () => {
      if (!this.hasAgentSnapshot()) {
        this.emit('listCleared');
      }
    });

    this.updateLastUpdateTime();
  }

  cleanupFallbackHandlers() {
    if (this.fallbackSource && this.fallbackHandlers.length > 0) {
      for (const { event, handler } of this.fallbackHandlers) {
        this.fallbackSource.off?.(event, handler);
      }
    }
    this.fallbackHandlers = [];
  }

  hasAgentSnapshot() {
    return this.agentPlayers.size > 0;
  }

  updateLastUpdateTime() {
    const now = Date.now();
    const fallbackTime = this.fallbackSource?.getLastUpdateTime?.() || null;
    const agentTime = this.agentLastUpdateTime || null;

    if (fallbackTime && agentTime) {
      this.lastUpdateTime = Math.max(fallbackTime, agentTime);
    } else {
      this.lastUpdateTime = agentTime ?? fallbackTime ?? now;
    }
  }

  /**
   * 获取所有在线玩家
   * @returns {Array<{name: string, uuid: string}>}
   */
  getAllPlayers() {
    return this.getMergedPlayers();
  }

  getMergedPlayers() {
    const merged = new Map();

    if (this.fallbackSource?.list) {
      for (const player of this.fallbackSource.list()) {
        if (!player || !player.name) continue;
        const key = player.uuid ? `uuid:${player.uuid.toLowerCase()}` : `name:${player.name.toLowerCase()}`;
        merged.set(key, {
          name: player.name,
          uuid: player.uuid || null
        });
      }
    }

    for (const player of this.agentPlayers.values()) {
      const key = player.uuid ? `uuid:${player.uuid.toLowerCase()}` : `name:${player.name.toLowerCase()}`;
      merged.set(key, {
        name: player.name,
        uuid: player.uuid || null
      });
    }

    return Array.from(merged.values());
  }

  /**
   * 根据 UUID 获取玩家信息
   * @param {string} uuid - 玩家 UUID
   * @returns {{name: string, uuid: string}|null}
   */
  getPlayerByUuid(uuid) {
    if (!uuid) {
      return null;
    }
    const normalized = uuid.toLowerCase();
    const player = this.agentPlayers.get(normalized);
    if (player) {
      return { name: player.name, uuid: player.uuid };
    }
    if (this.fallbackSource?.getByUuid) {
      const fallback = this.fallbackSource.getByUuid(uuid);
      return fallback ? { name: fallback.name, uuid: fallback.uuid || null } : null;
    }
    return null;
  }

  /**
   * 根据名称获取玩家信息
   * @param {string} name - 玩家名称
   * @returns {{name: string, uuid: string}|null}
   */
  getPlayerByName(name) {
    if (!name) {
      return null;
    }
    for (const player of this.agentPlayers.values()) {
      if (player.name === name) {
        return { name: player.name, uuid: player.uuid };
      }
    }
    if (this.fallbackSource?.getByName) {
      const fallback = this.fallbackSource.getByName(name);
      return fallback ? { name: fallback.name, uuid: fallback.uuid || null } : null;
    }
    return null;
  }

  /**
   * 检查玩家是否在线
   * @param {string} identifier - 玩家 UUID 或名称
   * @returns {boolean}
   */
  isPlayerOnline(identifier) {
    if (!identifier) {
      return false;
    }
    if (this.agentPlayers.has(identifier.toLowerCase())) {
      return true;
    }
    return this.getPlayerByName(identifier) !== null;
  }

  /**
   * 获取在线玩家数量
   * @returns {number}
   */
  getPlayerCount() {
    return this.getAllPlayers().length;
  }

  /**
   * 获取最后更新时间
   * @returns {number|null}
   */
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  /**
   * 清空玩家列表
   */
  clear() {
    const count = this.agentPlayers.size;
    this.agentPlayers.clear();
    this.agentLastUpdateTime = null;
    this.lastUpdateTime = null;
    this.logger.debug(`玩家列表已清空 (之前有 ${count} 人)`);
    this.emit('listCleared');
  }

  /**
   * 获取公共 API（供插件使用）
   * @returns {Object}
   */
  getPublicApi() {
    return {
      /**
       * 获取所有在线玩家
       * @returns {Array<{name: string, uuid: string}>}
       */
      list: () => this.getAllPlayers(),

      /**
       * 根据 UUID 获取玩家
       * @param {string} uuid - 玩家 UUID
       * @returns {{name: string, uuid: string}|null}
       */
      getByUuid: (uuid) => this.getPlayerByUuid(uuid),

      /**
       * 根据名称获取玩家
       * @param {string} name - 玩家名称
       * @returns {{name: string, uuid: string}|null}
       */
      getByName: (name) => this.getPlayerByName(name),

      /**
       * 检查玩家是否在线
       * @param {string} identifier - 玩家 UUID 或名称
       * @returns {boolean}
       */
      isOnline: (identifier) => this.isPlayerOnline(identifier),

      /**
       * 获取在线玩家数量
       * @returns {number}
       */
      count: () => this.getPlayerCount(),

      /**
       * 获取最后更新时间
       * @returns {number|null}
       */
      lastUpdate: () => this.getLastUpdateTime(),

      /**
       * 监听玩家列表事件
       * @param {string} event - 事件名称: 'listUpdated', 'playerJoined', 'playerLeft', 'playerNameChanged'
       * @param {Function} handler - 事件处理函数
       */
      on: (event, handler) => {
        return this.on(event, handler);
      },

      /**
       * 取消监听事件
       * @param {string} event - 事件名称
       * @param {Function} handler - 事件处理函数
       */
      off: (event, handler) => {
        return this.off(event, handler);
      }
    };
  }
}

