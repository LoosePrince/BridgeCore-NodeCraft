import { CommandRegistry } from './registry.js';
import { registerBCNCCommands } from './definitions.js';
import { loadConfig } from '../config/loader.js';

/**
 * 命令处理器
 */
export class CommandHandler {
  constructor(config, serverManager, logger, options = {}) {
    this.config = config;
    this.serverManager = serverManager;
    this.logger = logger;
    this.projectRoot = options.projectRoot;
    this.pluginManagerRef = options.pluginManagerRef || { current: null };
    this.messenger = options.messenger;
    this.agentManager = options.agentManager;
    this.permissionManager = options.permissionManager;
    this.prefix = config.commands.prefix;
    
    // 创建命令注册表
    this.registry = new CommandRegistry(this.prefix, {
      placeholderResolvers: {
        // 玩家相关
        players: () => {
          const api = this.agentManager?.getPlayerListManager?.()?.getPublicApi?.();
          if (!api || typeof api.list !== 'function') {
            return [];
          }
          try {
            return api
              .list()
              .map((player) => player?.name)
              .filter((name) => typeof name === 'string' && name.trim().length > 0);
          } catch {
            return [];
          }
        },
        'player-uuid': () => {
          const api = this.agentManager?.getPlayerListManager?.()?.getPublicApi?.();
          if (!api || typeof api.list !== 'function') {
            return [];
          }
          try {
            return api
              .list()
              .map((player) => player?.uuid)
              .filter((uuid) => typeof uuid === 'string' && uuid.trim().length > 0);
          } catch {
            return [];
          }
        },
        'offline-players': () => {
          try {
            // 从 PlayerPresenceTracker 获取 usercache.json 中的玩家
            const playerListManager = this.agentManager?.getPlayerListManager?.();
            const presenceTracker = playerListManager?.fallbackSource;
            if (!presenceTracker || !presenceTracker.userCache) {
              return [];
            }
            const onlineNames = new Set();
            const api = this.agentManager?.getPlayerListManager?.()?.getPublicApi?.();
            if (api && typeof api.list === 'function') {
              api.list().forEach(player => {
                if (player?.name) {
                  onlineNames.add(player.name.toLowerCase());
                }
              });
            }
            // 返回不在线的玩家
            return Array.from(presenceTracker.userCache.values())
              .map(entry => entry.name)
              .filter((name) => {
                if (!name || typeof name !== 'string') return false;
                return !onlineNames.has(name.toLowerCase());
              });
          } catch {
            return [];
          }
        },
        // 插件管理类
        plugins: () => {
          const pluginManager = this.pluginManagerRef?.current;
          if (!pluginManager) {
            return [];
          }
          try {
            return pluginManager
              .listLoadedPlugins()
              .map((meta) => meta?.id)
              .filter((id) => typeof id === 'string' && id.trim().length > 0);
          } catch {
            return [];
          }
        },
        'plugin-entries': () => {
          const pluginManager = this.pluginManagerRef?.current;
          if (!pluginManager) {
            return [];
          }
          try {
            return pluginManager.getAllEntries() || [];
          } catch {
            return [];
          }
        },
        // 权限管理类
        'permission-levels': () => {
          return ['1', '2', '3', '4'];
        },
        'players-with-permission': (context) => {
          if (!this.permissionManager) {
            return [];
          }
          try {
            // 如果上下文中有前一个参数（权限级别），则筛选该级别的玩家
            // 否则返回所有有自定义权限的玩家
            const parts = context?.parts || [];
            const command = context?.command;
            if (command && command.path && parts.length > command.path.length) {
              // 尝试从已输入的参数中获取权限级别
              const levelArg = parts[command.path.length];
              const level = parseInt(levelArg, 10);
              if (level >= 1 && level <= 4) {
                const players = this.permissionManager.listPlayers();
                return players
                  .filter((p) => p.level === level)
                  .map((p) => p.name)
                  .filter((name) => typeof name === 'string' && name.trim().length > 0);
              }
            }
            // 返回所有有自定义权限的玩家
            const players = this.permissionManager.listPlayers();
            return players
              .map((p) => p.name)
              .filter((name) => typeof name === 'string' && name.trim().length > 0);
          } catch {
            return [];
          }
        },
        // 命令系统类
        commands: () => {
          try {
            return this.registry
              .getAllCommands()
              .filter((cmd) => cmd.path.length === 1)
              .map((cmd) => cmd.path[0])
              .filter((name) => typeof name === 'string' && name.trim().length > 0);
          } catch {
            return [];
          }
        },
        subcommands: (context) => {
          try {
            const command = context?.command;
            if (!command || !command.path) {
              return [];
            }
            // 获取当前命令路径的所有子命令
            const allCommands = this.registry.getAllCommands();
            const parentPath = command.path.map((p) => p.toLowerCase());
            return allCommands
              .filter((cmd) => {
                if (cmd.path.length !== parentPath.length + 1) {
                  return false;
                }
                for (let i = 0; i < parentPath.length; i++) {
                  if (cmd.path[i].toLowerCase() !== parentPath[i]) {
                    return false;
                  }
                }
                return true;
              })
              .map((cmd) => cmd.path[cmd.path.length - 1])
              .filter((name) => typeof name === 'string' && name.trim().length > 0);
          } catch {
            return [];
          }
        }
      }
    });
    
    // 注册所有 BCNC 系统命令
    const registerCommands = () => registerBCNCCommands(this.registry, {
      serverManager: this.serverManager,
      logger: this.logger,
      config: this.config,
      reloadConfig: this.reloadConfigFromDisk.bind(this),
      pluginManagerRef: this.pluginManagerRef,
      agentManager: this.agentManager,
      permissionManager: this.permissionManager,
      messenger: this.messenger
    });

    if (typeof this.registry.withPermissionLevel === 'function') {
      this.registry.withPermissionLevel(4, registerCommands);
    } else {
      registerCommands();
    }
  }

  /**
   * 处理输入命令
   * @param {string} input - 用户输入
   * @returns {boolean} 是否继续处理（false 表示退出）
   */
  async handle(input, options = {}) {
    const execContext = this.createExecutionContext(options);
    const command = input.trim();
    
    if (!command) {
      return true;
    }

    // 处理系统命令
    if (command.startsWith(this.prefix)) {
      const sysCommand = command.substring(this.prefix.length);
      return await this.handleSystemCommand(sysCommand, execContext);
    }
    
    // 发送到服务器
    if (execContext.source === 'player') {
      await this.messenger?.reply(execContext, { text: '不支持在游戏内执行此命令', color: 'yellow' });
      return true;
    }
    this.serverManager.sendCommand(command);
    return true;
  }

  /**
   * 处理系统命令
   * @param {string} commandInput - 系统命令（不包含前缀）
   * @returns {Promise<boolean>} 是否继续
   */
  async handleSystemCommand(commandInput, execContext) {
    // 解析命令
    const parsed = this.registry.parse(commandInput);
    
    if (!parsed.command) {
      this.logger.warn(`未知系统命令: ${this.prefix}${commandInput}，输入 ${this.prefix}help 查看帮助`);
      return true;
    }

    if (!(await this.checkPermission(parsed.command, execContext))) {
      return true;
    }

    try {
      const result = await parsed.command.handler(parsed.args, execContext);
      if (
        execContext.source === 'player' &&
        this.messenger &&
        !execContext.hasReplied()
      ) {
        await this.messenger.reply(execContext, { text: '命令已执行', color: 'green' });
      }
      return result !== false;
    } catch (error) {
      this.logger.error(`执行命令时发生错误: ${error.message}`);
      await this.messenger?.reply(execContext, { text: `执行命令时发生错误: ${error.message}`, color: 'red' }, { level: 'error' });
      return true;
    }
  }

  /**
   * 获取命令注册表（用于补全等）
   * @returns {CommandRegistry} 命令注册表
   */
  getRegistry() {
    return this.registry;
  }

  getMessenger() {
    return this.messenger;
  }

  /**
   * 从磁盘重新加载配置
   * @returns {Promise<{success: boolean, prefixChanged?: boolean, error?: Error}>}
   */
  async reloadConfigFromDisk() {
    if (!this.projectRoot) {
      const error = new Error('未提供项目根目录，无法重新加载配置');
      return { success: false, error };
    }

    try {
      const newConfig = loadConfig(this.projectRoot);
      const oldPrefix = this.config.commands.prefix;
      this.applyConfig(newConfig);
      this.logger.updateConfig(this.config.logging);
      return {
        success: true,
        prefixChanged: oldPrefix !== this.config.commands.prefix
      };
    } catch (error) {
      return { success: false, error };
    }
  }

  /**
   * 应用新配置到当前运行时
   * @param {Object} newConfig - 新配置对象
   */
  applyConfig(newConfig) {
    Object.keys(newConfig).forEach(key => {
      this.config[key] = newConfig[key];
    });

    // 更新命令前缀
    this.prefix = this.config.commands.prefix;
    this.registry.prefix = this.prefix;
  }

  createExecutionContext(options = {}) {
    const source = options.source || 'cli';
    const player = options.player || null;
    let replyCount = 0;
    const reply = async (message, replyOptions = {}) => {
      replyCount++;
      await this.messenger?.reply({ source, player }, message, replyOptions);
    };
    const context = {
      source,
      player,
      reply,
      messenger: this.messenger,
      logger: this.logger,
      serverManager: this.serverManager,
      prefix: this.prefix,
      hasReplied: () => replyCount > 0,
      permissions: this.permissionManager,
      permissionLevel: this.permissionManager?.getLevelForContext({ source, player }) ?? 4
    };
    return context;
  }

  async checkPermission(command, execContext) {
    if (!this.permissionManager) {
      return true;
    }
    const requiredLevel = command.permissionLevel ?? 1;
    const allowed = this.permissionManager.hasPermission(execContext, requiredLevel);
    if (allowed) {
      return true;
    }
    const denyMessage = command.denyMessage;
    if (denyMessage) {
      if (execContext.source === 'player') {
        await this.messenger?.reply(execContext, { text: denyMessage, color: 'red' });
      } else {
        this.logger?.warn?.(`[权限] ${denyMessage} (需要 ${requiredLevel} 级)`);
      }
    }
    return false;
  }
}

