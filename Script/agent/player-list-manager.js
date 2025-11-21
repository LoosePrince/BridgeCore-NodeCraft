import { EventEmitter } from 'events';

/**
 * 玩家列表管理器
 * 负责管理在线玩家列表，并提供 API 给插件使用
 */
export class PlayerListManager extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.players = new Map(); // UUID -> { name, uuid, lastUpdate }
    this.updateInterval = null;
    this.lastUpdateTime = null;
  }

  /**
   * 更新玩家列表
   * @param {Array<{name: string, uuid: string}>} players - 玩家列表
   */
  updatePlayers(players) {
    if (!Array.isArray(players)) {
      this.logger.warn('玩家列表更新失败: 数据格式错误');
      return;
    }

    const previousCount = this.players.size;
    const currentPlayers = new Set();
    const now = Date.now();

    // 更新现有玩家并添加新玩家
    for (const player of players) {
      if (!player || !player.uuid || !player.name) {
        continue;
      }

      const uuid = player.uuid;
      currentPlayers.add(uuid);

      const existing = this.players.get(uuid);
      if (existing) {
        // 更新现有玩家信息
        if (existing.name !== player.name) {
          this.logger.debug(`玩家名称更新: ${existing.name} -> ${player.name} (${uuid})`);
          this.emit('playerNameChanged', { 
            uuid, 
            oldName: existing.name, 
            newName: player.name 
          });
        }
        existing.name = player.name;
        existing.lastUpdate = now;
      } else {
        // 添加新玩家
        this.players.set(uuid, {
          name: player.name,
          uuid: uuid,
          lastUpdate: now
        });
        this.logger.debug(`玩家上线: ${player.name} (${uuid})`);
        this.emit('playerJoined', { name: player.name, uuid });
      }
    }

    // 检测离线玩家
    const offlinePlayers = [];
    for (const [uuid, player] of this.players.entries()) {
      if (!currentPlayers.has(uuid)) {
        offlinePlayers.push(player);
        this.players.delete(uuid);
        this.logger.debug(`玩家离线: ${player.name} (${uuid})`);
        this.emit('playerLeft', { name: player.name, uuid });
      }
    }

    this.lastUpdateTime = now;

    // 如果玩家数量发生变化，触发更新事件
    if (this.players.size !== previousCount || offlinePlayers.length > 0) {
      this.emit('listUpdated', {
        players: this.getAllPlayers(),
        added: players.filter(p => !this.players.has(p.uuid)),
        removed: offlinePlayers
      });
    }

    this.logger.debug(`玩家列表已更新: ${this.players.size} 人在线`);
  }

  /**
   * 获取所有在线玩家
   * @returns {Array<{name: string, uuid: string}>}
   */
  getAllPlayers() {
    return Array.from(this.players.values()).map(p => ({
      name: p.name,
      uuid: p.uuid
    }));
  }

  /**
   * 根据 UUID 获取玩家信息
   * @param {string} uuid - 玩家 UUID
   * @returns {{name: string, uuid: string}|null}
   */
  getPlayerByUuid(uuid) {
    const player = this.players.get(uuid);
    return player ? { name: player.name, uuid: player.uuid } : null;
  }

  /**
   * 根据名称获取玩家信息
   * @param {string} name - 玩家名称
   * @returns {{name: string, uuid: string}|null}
   */
  getPlayerByName(name) {
    for (const player of this.players.values()) {
      if (player.name === name) {
        return { name: player.name, uuid: player.uuid };
      }
    }
    return null;
  }

  /**
   * 检查玩家是否在线
   * @param {string} identifier - 玩家 UUID 或名称
   * @returns {boolean}
   */
  isPlayerOnline(identifier) {
    if (this.players.has(identifier)) {
      return true;
    }
    return this.getPlayerByName(identifier) !== null;
  }

  /**
   * 获取在线玩家数量
   * @returns {number}
   */
  getPlayerCount() {
    return this.players.size;
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
    const count = this.players.size;
    this.players.clear();
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

