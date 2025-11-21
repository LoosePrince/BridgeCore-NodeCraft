import { EventEmitter } from 'events';
import { existsSync, readFileSync, watch } from 'fs';

function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

function normalizeUuid(uuid) {
  return (uuid || '').replace(/-/g, '').toLowerCase();
}

/**
 * 通过服务器日志事件维护的玩家在线列表
 * 作为 Java Agent 数据的补充/兜底
 */
export class PlayerPresenceTracker extends EventEmitter {
  constructor({ eventBus, logger, userCachePath = null }) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;
    this.playersByName = new Map(); // key: lower-case name
    this.playersByUuid = new Map(); // key: normalized uuid (no dash, lower-case)
    this.lastUpdateTime = null;
    this.userCachePath = null;
    this.userCache = new Map(); // name(lower) -> { name, uuid }
    this.userCacheWatcher = null;
    this.userCacheReloadTimer = null;
    this.boundHandlers = [];

    if (eventBus) {
      this.bindEventBus(eventBus);
    }
    if (userCachePath) {
      this.setUserCachePath(userCachePath);
    }
  }

  bindEventBus(eventBus) {
    this.boundHandlers.push(
      eventBus.on('player:join', (payload) => this.handlePlayerJoin(payload)),
      eventBus.on('player:leave', (payload) => this.handlePlayerLeave(payload)),
      eventBus.on('server:closing', () => this.clear()),
      eventBus.on('server:closed', () => this.clear())
    );
  }

  setUserCachePath(filePath) {
    if (this.userCacheWatcher) {
      this.userCacheWatcher.close();
      this.userCacheWatcher = null;
    }
    this.userCachePath = filePath;
    if (!filePath) {
      this.userCache.clear();
      return;
    }
    this.loadUserCache(true);
    this.watchUserCache();
  }

  loadUserCache(silent = false) {
    if (!this.userCachePath || !existsSync(this.userCachePath)) {
      if (!silent) {
        this.logger?.debug?.(`[Presence] usercache.json 不存在: ${this.userCachePath}`);
      }
      this.userCache.clear();
      return;
    }
    try {
      const raw = readFileSync(this.userCachePath, 'utf-8');
      const data = JSON.parse(raw);
      this.userCache.clear();
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry?.name && entry?.uuid) {
            this.userCache.set(normalizeName(entry.name), {
              name: entry.name,
              uuid: entry.uuid
            });
          }
        }
      }
      this.logger?.debug?.(`[Presence] usercache.json 已加载，记录 ${this.userCache.size}`);
      this.hydrateOnlinePlayersFromCache();
    } catch (error) {
      this.logger?.warn?.(`[Presence] 读取 usercache.json 失败: ${error.message}`);
    }
  }

  watchUserCache() {
    if (!this.userCachePath) {
      return;
    }
    try {
      this.userCacheWatcher = watch(this.userCachePath, { persistent: false }, () => {
        this.scheduleUserCacheReload();
      });
    } catch (error) {
      this.logger?.warn?.(`[Presence] 无法监听 usercache.json: ${error.message}`);
    }
  }

  scheduleUserCacheReload() {
    clearTimeout(this.userCacheReloadTimer);
    this.userCacheReloadTimer = setTimeout(() => this.loadUserCache(), 200);
  }

  handlePlayerJoin(payload = {}) {
    const name = payload.player?.trim();
    if (!name) {
      return;
    }
    const key = normalizeName(name);
    const now = Date.now();

    let record = this.playersByName.get(key);
    if (!record) {
      record = {
        name,
        uuid: null,
        firstSeen: now,
        lastSeen: now
      };
      this.playersByName.set(key, record);
    } else {
      record.name = name;
      record.lastSeen = now;
    }

    this.tryAssignUuid(record);

    this.lastUpdateTime = now;
    this.emit('playerJoined', { name: record.name, uuid: record.uuid });
    this.emitListUpdated('join');
  }

  handlePlayerLeave(payload = {}) {
    const name = payload.player?.trim();
    if (!name) {
      return;
    }
    const key = normalizeName(name);
    const record = this.playersByName.get(key);
    if (record) {
      if (record.uuid) {
        this.playersByUuid.delete(normalizeUuid(record.uuid));
      }
      this.playersByName.delete(key);
      this.lastUpdateTime = Date.now();
      this.emit('playerLeft', { name: record.name, uuid: record.uuid });
      this.emitListUpdated('leave');
    }
  }

  hydrateOnlinePlayersFromCache() {
    for (const record of this.playersByName.values()) {
      if (!record.uuid) {
        this.tryAssignUuid(record);
      }
    }
  }

  tryAssignUuid(record) {
    if (!record || record.uuid) {
      return;
    }
    const cached = this.userCache.get(normalizeName(record.name));
    if (cached?.uuid) {
      this.setPlayerUuid(record, cached.uuid);
      this.emit('playerInfo', { name: record.name, uuid: record.uuid });
    }
  }

  setPlayerUuid(record, uuidRaw) {
    if (!record || !uuidRaw) {
      return;
    }
    const normalized = normalizeUuid(uuidRaw);
    if (!normalized) {
      return;
    }
    if (record.uuid) {
      const prevKey = normalizeUuid(record.uuid);
      if (prevKey === normalized) {
        return;
      }
      this.playersByUuid.delete(prevKey);
    }
    record.uuid = uuidRaw;
    this.playersByUuid.set(normalized, record);
  }

  emitListUpdated(reason) {
    this.emit('listUpdated', {
      source: 'events',
      reason,
      players: this.list()
    });
  }

  list() {
    return Array.from(this.playersByName.values()).map((player) => ({
      name: player.name,
      uuid: player.uuid
    }));
  }

  getByName(name) {
    if (!name) return null;
    return this.playersByName.get(normalizeName(name)) || null;
  }

  getByUuid(uuid) {
    if (!uuid) return null;
    return this.playersByUuid.get(normalizeUuid(uuid)) || null;
  }

  isOnline(identifier) {
    if (!identifier) return false;
    const uuidCandidate = this.getByUuid(identifier);
    if (uuidCandidate) {
      return true;
    }
    return !!this.getByName(identifier);
  }

  count() {
    return this.playersByName.size;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  clear() {
    if (this.playersByName.size === 0) {
      return;
    }
    this.playersByName.clear();
    this.playersByUuid.clear();
    this.lastUpdateTime = Date.now();
    this.emit('listCleared');
    this.emitListUpdated('clear');
  }
}


