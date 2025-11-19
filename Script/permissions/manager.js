import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

const DEFAULT_CONFIG = {
  defaultLevel: 1,
  levels: {
    '4': [],
    '3': [],
    '2': [],
    '1': []
  }
};

const MIN_LEVEL = 1;
const MAX_LEVEL = 4;

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export class PermissionManager {
  constructor({ projectRoot, logger }) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.configDir = join(projectRoot, 'config');
    this.filePath = join(this.configDir, 'permissions.yml');
    this.data = cloneDefaultConfig();
    this.ensureConfigFile();
    this.load();
  }

  ensureConfigFile() {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    if (!existsSync(this.filePath)) {
      const content = yaml.dump(DEFAULT_CONFIG, { lineWidth: 120 });
      writeFileSync(this.filePath, content, 'utf8');
    }
  }

  load() {
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = yaml.load(raw) || {};
      this.data = this.normalizeConfig(parsed);
    } catch (error) {
      this.logger?.warn?.(`加载权限配置失败，使用默认配置: ${error.message}`);
      this.data = cloneDefaultConfig();
      this.save();
    }
  }

  save() {
    try {
      const serialized = this.serializeConfig();
      const content = yaml.dump(serialized, { lineWidth: 120 });
      writeFileSync(this.filePath, content, 'utf8');
    } catch (error) {
      this.logger?.error?.(`保存权限配置失败: ${error.message}`);
    }
  }

  normalizeConfig(config) {
    const normalized = {
      defaultLevel: this.normalizeLevel(config?.defaultLevel, DEFAULT_CONFIG.defaultLevel),
      players: {}
    };

    const levelMap = config || {};
    for (let lvl = MAX_LEVEL; lvl >= MIN_LEVEL; lvl--) {
      const key = String(lvl);
      const entries = levelMap[key];
      if (!entries || !Array.isArray(entries)) {
        continue;
      }
      entries
        .filter((name) => typeof name === 'string' && name.trim().length > 0)
        .forEach((name) => {
          const normalizedName = name.trim();
          normalized.players[normalizedName.toLowerCase()] = {
            level: lvl,
            name: normalizedName
          };
        });
    }
    return normalized;
  }

  serializeConfig() {
    const serialized = {
      defaultLevel: this.data.defaultLevel
    };
    for (let lvl = MAX_LEVEL; lvl >= MIN_LEVEL; lvl--) {
      const list = Object.values(this.data.players || {})
        .filter((entry) => entry.level === lvl)
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      serialized[String(lvl)] = list;
    }
    return serialized;
  }

  normalizeLevel(level, fallback = MIN_LEVEL) {
    const value = parseInt(level, 10);
    if (Number.isNaN(value)) {
      return fallback;
    }
    return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, value));
  }

  getDefaultLevel() {
    return this.data?.defaultLevel ?? MIN_LEVEL;
  }

  setDefaultLevel(level) {
    this.data.defaultLevel = this.normalizeLevel(level, this.getDefaultLevel());
    this.save();
    return this.data.defaultLevel;
  }

  normalizePlayerKey(player) {
    return typeof player === 'string' && player.trim() ? player.trim().toLowerCase() : null;
  }

  getPlayerLevel(player) {
    const key = this.normalizePlayerKey(player);
    if (!key) {
      return this.getDefaultLevel();
    }
    return this.data.players?.[key]?.level ?? this.getDefaultLevel();
  }

  setPlayerLevel(player, level) {
    const key = this.normalizePlayerKey(player);
    if (!key) {
      throw new Error('玩家名称不能为空');
    }
    const normalizedLevel = this.normalizeLevel(level, this.getDefaultLevel());
    if (!this.data.players) {
      this.data.players = {};
    }
    this.data.players[key] = {
      level: normalizedLevel,
      name: player
    };
    this.save();
    return { name: player, level: normalizedLevel };
  }

  removePlayer(player) {
    const key = this.normalizePlayerKey(player);
    if (!key || !this.data.players?.[key]) {
      return false;
    }
    delete this.data.players[key];
    this.save();
    return true;
  }

  listPlayers() {
    return Object.values(this.data.players || {}).map((entry) => ({
      name: entry.name,
      level: entry.level
    }));
  }

  getLevelForContext(context = {}) {
    if (context.source === 'player') {
      return this.getPlayerLevel(context.player);
    }
    // CLI、内置系统默认最高权限
    return MAX_LEVEL;
  }

  hasPermission(context, requiredLevel) {
    const currentLevel = this.getLevelForContext(context);
    return currentLevel >= this.normalizeLevel(requiredLevel, MIN_LEVEL);
  }

  getConfigPath() {
    return this.filePath;
  }

  getPublicApi() {
    return {
      getLevel: (player) => this.getPlayerLevel(player),
      getDefaultLevel: () => this.getDefaultLevel(),
      hasPermission: (player, required) => this.getPlayerLevel(player) >= this.normalizeLevel(required, MIN_LEVEL),
      setLevel: (player, level) => this.setPlayerLevel(player, level),
      setDefaultLevel: (level) => this.setDefaultLevel(level),
      list: () => this.listPlayers()
    };
  }

  reload() {
    this.load();
    return this.data;
  }
}


