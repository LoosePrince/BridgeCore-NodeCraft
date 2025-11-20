import { CommandRegistry } from './registry.js';
import { buildTextComponent } from '../utils/text-component.js';

/**
 * 注册所有 BCNC 系统命令
 * @param {CommandRegistry} registry - 命令注册表
 * @param {Object} context - 上下文对象（包含 serverManager, logger, config 等）
 */
export function registerBCNCCommands(registry, context) {
  const { serverManager, logger, config, reloadConfig, pluginManagerRef, agentManager, permissionManager, messenger } = context;
  const getPluginManager = () => {
    if (!pluginManagerRef || !pluginManagerRef.current) {
      logger.warn('插件管理器尚未初始化');
      return null;
    }
    return pluginManagerRef.current;
  };
  const getPluginIds = () => {
    const pluginManager = getPluginManager();
    if (!pluginManager) {
      return [];
    }
    return pluginManager.listLoadedPlugins().map(meta => meta.id);
  };

  const getPluginEntries = () => {
    const pluginManager = getPluginManager();
    if (!pluginManager) {
      return [];
    }
    return pluginManager.getAllEntries();
  };

  const notify = async (execContext, message, { color = 'green', level = 'info' } = {}) => {
    if (execContext?.source === 'player' && messenger) {
      await messenger.reply(execContext, { text: message, color });
      return;
    }
    const logLevel = level in logger ? level : 'info';
    logger[logLevel](message);
  };

  const ensurePermissionSystem = () => {
    if (!permissionManager) {
      logger.warn('权限系统未初始化');
      return false;
    }
    return true;
  };

  const DEFAULT_DENY_MESSAGE = '你没有权限执行此命令';
  const originalRegister = registry.register.bind(registry);
  const registerWithDefaults = (path, definition = {}) => {
    const finalDef = { ...definition };
    if (!Object.prototype.hasOwnProperty.call(finalDef, 'denyMessage')) {
      finalDef.denyMessage = DEFAULT_DENY_MESSAGE;
    }
    originalRegister(path, finalDef);
  };
  const register = (path, definition = {}) => registerWithDefaults(path, definition);
  const executeRegistration = () => {
  // ========== 服务器控制命令 ==========
  
  // !stop / !exit / !quit - 停止服务器
  register('stop', {
    handler: async (args) => {
      serverManager.stop();
      setTimeout(() => {
        process.exit(0);
      }, 2000);
      return false; // 退出
    },
    description: '停止服务器并退出程序',
    aliases: ['exit', 'quit']
  });

  // !restart - 重启服务器
  register('restart', {
    handler: async (args) => {
      logger.info('重启服务器...');
      serverManager.stop();
      setTimeout(async () => {
        serverManager.isShuttingDown = false;
        await serverManager.start();
      }, 3000);
      return true;
    },
    description: '重启 Minecraft 服务器'
  });

  // !status - 查看服务器状态
  register('status', {
    handler: async (args) => {
      if (serverManager.isRunning()) {
        logger.info('服务器状态: 运行中');
      } else {
        logger.info('服务器状态: 未运行');
      }
      return true;
    },
    description: '查看服务器运行状态'
  });

  // ========== 帮助命令 ==========
  
  // !help - 显示帮助
  register('help', {
      handler: async (args, context) => {
      if (args.length > 0) {
        const commandPath = args.join(' ');
        const command = registry.find(commandPath);
        if (command) {
            await showCommandHelp(command, registry, context);
        } else {
          logger.warn(`未找到命令: ${registry.prefix}${commandPath}`);
        }
      } else {
          await showAllCommandsHelp(registry, context);
      }
      return true;
    },
    description: '显示帮助信息',
    args: [
      { 
        name: 'command', 
        description: '要查看的命令名称（可选）', 
        required: false, 
        type: 'string',
        options: () => {
          // 返回所有可用命令的完整路径
          return registry.getAllCommands().map(cmd => cmd.path.join(' '));
        }
      }
    ]
  });

  // ========== 服务器管理命令 ==========
  
  // !server - 服务器管理命令组
  register('server', {
    handler: async (args, context) => {
      await showCommandHelp(registry.find('server'), registry, context);
      return true;
    },
    description: '服务器管理命令组'
  });
  
  // !server start - 启动服务器
  register(['server', 'start'], {
    handler: async (args) => {
      if (serverManager.isRunning()) {
        logger.warn('服务器已在运行中');
      } else {
        await serverManager.start();
      }
      return true;
    },
    description: '启动 Minecraft 服务器'
  });

  // !server stop - 停止服务器（不退出程序）
  register(['server', 'stop'], {
    handler: async (args) => {
      if (!serverManager.isRunning()) {
        logger.warn('服务器未运行');
      } else {
        serverManager.stop();
      }
      return true;
    },
    description: '停止 Minecraft 服务器（不退出程序）'
  });

  // !server restart - 重启服务器
  register(['server', 'restart'], {
    handler: async (args) => {
      logger.info('重启服务器...');
      serverManager.stop();
      setTimeout(async () => {
        serverManager.isShuttingDown = false;
        await serverManager.start();
      }, 3000);
      return true;
    },
    description: '重启 Minecraft 服务器'
  });

  // !server status - 查看服务器状态
  register(['server', 'status'], {
    handler: async (args) => {
      if (serverManager.isRunning()) {
        logger.info('服务器状态: 运行中');
      } else {
        logger.info('服务器状态: 未运行');
      }
      return true;
    },
    description: '查看服务器运行状态'
  });

  // ========== 配置命令 ==========
  
  // !config - 配置管理命令组
  register('config', {
    handler: async (args, context) => {
      await showCommandHelp(registry.find('config'), registry, context);
      return true;
    },
    description: '配置管理命令组'
  });
  
  // !config reload - 重新加载配置
  register(['config', 'reload'], {
    handler: async () => {
      if (!reloadConfig) {
        logger.error('当前环境不支持重新加载配置');
        return true;
      }

      const result = await reloadConfig();
      if (!result.success) {
        logger.error(`重新加载配置失败: ${result.error.message}`);
        return true;
      }

      logger.info('配置文件已重新加载');
      if (result.prefixChanged) {
        logger.warn('命令前缀已更改，如需完全生效请重新启动程序');
      }
      return true;
    },
    description: '重新加载配置文件'
  });

  // ========== 权限命令 ==========

  registry.register('perm', {
    handler: async (args, execContext) => {
      await showCommandHelp(registry.find('perm'), registry, execContext);
      return true;
    },
    description: '权限管理命令组'
  });

  registry.register(['perm', 'list'], {
    handler: async (args, execContext) => {
      if (!ensurePermissionSystem()) {
        return true;
      }
      const players = permissionManager.listPlayers();
      const defaultLevel = permissionManager.getDefaultLevel();
      if (!players.length) {
        await notify(execContext, `暂无玩家自定义权限，默认等级为 ${defaultLevel}`, { color: 'yellow' });
        return true;
      }
      if (execContext.source === 'player') {
        const lines = players.map((entry) => `- ${entry.name}: ${entry.level} 级`).join('\n');
        await notify(execContext, `默认等级: ${defaultLevel}\n${lines}`, { color: 'gold' });
      } else {
        logger.info(`默认权限等级: ${defaultLevel}`);
        players.forEach((entry) => logger.info(`- ${entry.name}: ${entry.level} 级`));
      }
      return true;
    },
    description: '列出所有玩家的权限设置'
  });

  registry.register(['perm', 'set'], {
    handler: async (args, execContext) => {
      if (!ensurePermissionSystem()) {
        return true;
      }
      if (args.length < 2) {
        await notify(execContext, '用法: !perm set <玩家> <级别>', { color: 'yellow' });
        return true;
      }
      const [playerName, levelStr] = args;
      const level = Number(levelStr);
      if (!Number.isInteger(level) || level < 1 || level > 4) {
        await notify(execContext, '权限级别必须是 1~4 的整数', { color: 'yellow' });
        return true;
      }
      try {
        const record = permissionManager.setPlayerLevel(playerName, level);
        await notify(execContext, `玩家 ${record.name} 的权限已设置为 ${record.level} 级`, { color: 'green' });
      } catch (error) {
        await notify(execContext, `设置权限失败: ${error.message}`, { color: 'red', level: 'error' });
      }
      return true;
    },
    description: '设置玩家的权限级别',
    args: [
      {
        name: 'player',
        description: '玩家名称',
        required: true,
        type: 'string'
      },
      {
        name: 'level',
        description: '权限级别 (1-4)',
        required: true,
        type: 'string',
        options: ['1', '2', '3', '4']
      }
    ]
  });

  registry.register(['perm', 'remove'], {
    handler: async (args, execContext) => {
      if (!ensurePermissionSystem()) {
        return true;
      }
      if (args.length < 1) {
        await notify(execContext, '用法: !perm remove <玩家>', { color: 'yellow' });
        return true;
      }
      const [playerName] = args;
      const removed = permissionManager.removePlayer(playerName);
      if (removed) {
        await notify(execContext, `已移除玩家 ${playerName} 的自定义权限`, { color: 'green' });
      } else {
        await notify(execContext, `未找到玩家 ${playerName} 的自定义权限`, { color: 'yellow' });
      }
      return true;
    },
    description: '移除玩家的自定义权限',
    args: [
      {
        name: 'player',
        description: '玩家名称',
        required: true,
        type: 'string'
      }
    ]
  });

  registry.register(['perm', 'default'], {
    handler: async (args, execContext) => {
      if (!ensurePermissionSystem()) {
        return true;
      }
      if (args.length < 1) {
        await notify(execContext, '用法: !perm default <级别>', { color: 'yellow' });
        return true;
      }
      const level = Number(args[0]);
      if (!Number.isInteger(level) || level < 1 || level > 4) {
        await notify(execContext, '权限级别必须是 1~4 的整数', { color: 'yellow' });
        return true;
      }
      const newLevel = permissionManager.setDefaultLevel(level);
      await notify(execContext, `默认权限等级已更新为 ${newLevel}`, { color: 'green' });
      return true;
    },
    description: '设置默认玩家权限等级',
    args: [
      {
        name: 'level',
        description: '权限级别 (1-4)',
        required: true,
        type: 'string',
        options: ['1', '2', '3', '4']
      }
    ]
  });

  registry.register(['perm', 'show'], {
    handler: async (args, execContext) => {
      if (!ensurePermissionSystem()) {
        return true;
      }
      if (args.length < 1) {
        await notify(execContext, '用法: !perm show <玩家>', { color: 'yellow' });
        return true;
      }
      const [playerName] = args;
      const level = permissionManager.getPlayerLevel(playerName);
      await notify(execContext, `玩家 ${playerName} 的权限等级为 ${level}`, { color: 'green' });
      return true;
    },
    description: '查看玩家的权限等级',
    args: [
      {
        name: 'player',
        description: '玩家名称',
        required: true,
        type: 'string'
      }
    ]
  });

  registry.register(['perm', 'reload'], {
    handler: async (args, execContext) => {
      if (!ensurePermissionSystem()) {
        return true;
      }
      permissionManager.reload();
      await notify(execContext, '权限配置已重新加载', { color: 'green' });
      return true;
    },
    description: '重新加载权限配置文件'
  });

  // ========== 日志命令 ==========
  
  // !log - 日志管理命令组
  register('log', {
    handler: async (args, context) => {
      await showCommandHelp(registry.find('log'), registry, context);
      return true;
    },
    description: '日志管理命令组'
  });
  
  // !log level - 设置日志级别
  register(['log', 'level'], {
    handler: async (args) => {
      if (args.length > 0) {
        const level = args[0].toLowerCase();
        const validLevels = ['debug', 'info', 'warn', 'error'];
        if (validLevels.includes(level)) {
          config.logging.level = level;
          logger.setLevel(level);
          logger.info(`日志级别已设置为: ${level}`);
          agentManager?.syncAgentLogLevel?.(level);
        } else {
          logger.error(`无效的日志级别: ${level}，有效值: ${validLevels.join(', ')}`);
        }
      } else {
        logger.info(`当前日志级别: ${config.logging.level}`);
      }
      return true;
    },
    description: '设置或查看日志级别',
    args: [
      { 
        name: 'level', 
        description: '日志级别 (debug/info/warn/error)', 
        required: false, 
        type: 'string',
        options: ['debug', 'info', 'warn', 'error']
      }
    ]
  });

  // ========== Agent 注入命令 ==========

  // !agent - Agent 管理命令组
  register('agent', {
    handler: async (args, context) => {
      await showCommandHelp(registry.find('agent'), registry, context);
      return true;
    },
    description: 'Java Agent 注入管理命令组'
  });

  // !agent inject - 注入 Agent
  register(['agent', 'inject'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      try {
        const pid = args.length > 0 ? args[0] : 'auto';
        logger.debug(`正在注入 Agent 到进程 ${pid}...`);
        await agentManager.inject(pid);
      } catch (error) {
        logger.error(`注入失败: ${error.message}`);
      }
      return true;
    },
    description: '注入 Agent 到 Minecraft 服务器进程',
    args: [
      { 
        name: 'pid', 
        description: '进程 ID（可选，默认为 auto 自动查找）', 
        required: false, 
        type: 'string'
      }
    ]
  });

  // !agent compile - 编译 Agent
  register(['agent', 'compile'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      try {
        logger.info('开始编译 Agent...');
        await agentManager.compile();
        logger.info('Agent 编译成功！');
      } catch (error) {
        logger.error(`编译失败: ${error.message}`);
      }
      return true;
    },
    description: '手动编译 Agent JAR 文件'
  });

  // !agent status - 查看 Agent 状态
  register(['agent', 'status'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      const status = agentManager.getStatus();
      logger.info('=== Agent 状态 ===');
      logger.info(`已注入: ${status.injected ? '是' : '否'}`);
      logger.info(`已连接: ${status.connected ? '是' : '否'}`);
      logger.info(`通信端口: ${status.port}`);
      logger.info(`Agent JAR: ${status.paths.agentJar}`);
      logger.info(`Attacher JAR: ${status.paths.attacherJar}`);
      return true;
    },
    description: '查看 Agent 注入状态'
  });

  // !agent ping - Ping Agent
  register(['agent', 'ping'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      if (!agentManager.getStatus().connected) {
        logger.warn('Agent 未连接');
        return true;
      }
      
      logger.info('发送 Ping 到 Agent...');
      agentManager.ping();
      return true;
    },
    description: 'Ping Agent 测试连接'
  });

  // !agent info - 获取 JVM 信息
  register(['agent', 'info'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      if (!agentManager.getStatus().connected) {
        logger.warn('Agent 未连接');
        return true;
      }
      
      logger.info('请求 JVM 信息...');
      agentManager.getJVMInfo();
      return true;
    },
    description: '获取服务器 JVM 信息'
  });

  // !agent classes - 获取已加载类数量
  register(['agent', 'classes'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      if (!agentManager.getStatus().connected) {
        logger.warn('Agent 未连接');
        return true;
      }
      
      logger.info('请求类信息...');
      agentManager.getClassesCount();
      return true;
    },
    description: '获取已加载的 Java 类数量'
  });

  // !agent register - 注册命令到游戏
  register(['agent', 'register'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      if (!agentManager.getStatus().connected) {
        logger.warn('Agent 未连接');
        return true;
      }
      
      if (args.length === 0) {
        logger.warn('用法: !agent register <命令名>');
        return true;
      }
      
      const commandName = args[0];
      logger.info(`正在注册命令 /${commandName} 到游戏...`);
      agentManager.registerGameCommand(commandName);
      return true;
    },
    description: '注册 BCNC 命令到游戏中（实验性）',
    args: [
      {
        name: 'command',
        description: '要注册的命令名',
        required: true,
        type: 'string'
      }
    ]
  });

  // !agent shutdown - 关闭 Agent
  registry.register(['agent', 'shutdown'], {
    handler: async (args) => {
      if (!agentManager) {
        logger.error('Agent 管理器未初始化');
        return true;
      }
      
      if (!agentManager.getStatus().connected) {
        logger.warn('Agent 未连接');
        return true;
      }
      
      logger.info('正在关闭 Agent...');
      await agentManager.shutdown();
      logger.info('Agent 已关闭');
      return true;
    },
    description: '关闭 Agent 连接'
  });

  // ========== 插件管理命令 ==========

  // !plugins - 插件管理命令组
  registry.register('plugins', {
    handler: async (args, context) => {
      await showCommandHelp(registry.find('plugins'), registry, context);
      return true;
    },
    description: '插件管理命令组'
  });

  registry.register(['plugins', 'list'], {
    handler: async () => {
      const pluginManager = getPluginManager();
      if (!pluginManager) {
        return true;
      }
      const plugins = pluginManager.listLoadedPlugins();
      if (plugins.length === 0) {
        logger.info('当前没有加载任何插件');
        return true;
      }

      logger.info(`已加载插件 (${plugins.length}):`);
      plugins.forEach((meta, index) => {
        logger.info(
          `  ${index + 1}. ${meta.name} (${meta.id}) version ${meta.version} [${meta.versionCode}] by ${meta.author.name}`
        );
      });
      return true;
    },
    description: '列出所有已加载的插件'
  });

  registry.register(['plugins', 'info'], {
    handler: async (args) => {
      if (args.length === 0) {
        logger.warn('用法: !plugins info <插件ID>');
        return true;
      }
      const pluginManager = getPluginManager();
      if (!pluginManager) {
        return true;
      }
      const meta = pluginManager.getPluginMeta(args[0]);
      if (!meta) {
        logger.warn(`插件 ${args[0]} 未加载`);
        return true;
      }

      logger.info(`插件 ID: ${meta.id}`);
      logger.info(`名称: ${meta.name}`);
      logger.info(`版本: ${meta.version} (code ${meta.versionCode})`);
      logger.info(`作者: ${meta.author.name} (${meta.author.link})`);
      logger.info(`链接: ${meta.link}`);
      logger.info(`描述: ${meta.description}`);
      return true;
    },
    description: '查看指定插件的元信息',
    args: [
      { 
        name: 'id', 
        description: '插件 ID', 
        required: true, 
        type: 'string',
        options: () => getPluginIds()
      }
    ]
  });

  registry.register(['plugins', 'unload'], {
    handler: async (args) => {
      if (args.length === 0) {
        logger.warn('用法: !plugins unload <插件ID>');
        return true;
      }
      const pluginManager = getPluginManager();
      if (!pluginManager) {
        return true;
      }
      try {
        await pluginManager.unloadPlugin(args[0]);
      } catch (error) {
        logger.error(`卸载插件失败: ${error.message}`);
      }
      return true;
    },
    description: '卸载已加载的插件',
    args: [
      { 
        name: 'id', 
        description: '插件 ID', 
        required: true, 
        type: 'string',
        options: () => getPluginIds()
      }
    ]
  });

  registry.register(['plugins', 'reload'], {
    handler: async (args) => {
      if (args.length === 0) {
        logger.warn('用法: !plugins reload <插件ID>');
        return true;
      }
      const pluginManager = getPluginManager();
      if (!pluginManager) {
        return true;
      }
      try {
        await pluginManager.reloadPlugin(args[0]);
      } catch (error) {
        logger.error(`重载插件失败: ${error.message}`);
      }
      return true;
    },
    description: '重载插件',
    args: [
      { 
        name: 'id', 
        description: '插件 ID', 
        required: true, 
        type: 'string',
        options: () => getPluginIds()
      }
    ]
  });

  registry.register(['plugins', 'load'], {
    handler: async (args) => {
      if (args.length === 0) {
        logger.warn('用法: !plugins load <插件文件或目录>');
        return true;
      }
      const pluginManager = getPluginManager();
      if (!pluginManager) {
        return true;
      }
      try {
        await pluginManager.loadPluginEntry(args[0]);
      } catch (error) {
        logger.error(`加载插件失败: ${error.message}`);
      }
      return true;
    },
    description: '加载指定插件条目（文件/文件夹/压缩包）',
    args: [
      { 
        name: 'entry', 
        description: '插件条目名称', 
        required: true, 
        type: 'string',
        options: () => getPluginEntries()
      }
    ]
  });

  registry.register(['plugins', 'delete'], {
    handler: async (args) => {
      if (args.length === 0) {
        logger.warn('用法: !plugins delete <插件文件或目录>');
        return true;
      }
      const pluginManager = getPluginManager();
      if (!pluginManager) {
        return true;
      }
      try {
        await pluginManager.deletePluginEntry(args[0]);
        logger.info(`插件条目 ${args[0]} 已删除`);
      } catch (error) {
        logger.error(`删除插件失败: ${error.message}`);
      }
      return true;
    },
    description: '删除插件文件（自动卸载后删除）',
    args: [
      { 
        name: 'entry', 
        description: '插件文件/目录/压缩包名称', 
        required: true, 
        type: 'string',
        options: () => getPluginEntries()
      }
    ]
  });
  };

  const runWithDefaults = () => {
    const previousRegisterMethod = registry.register;
    registry.register = registerWithDefaults;
    try {
      executeRegistration();
    } finally {
      registry.register = previousRegisterMethod;
    }
  };

  const hasPermissionStack = typeof registry.withPermissionLevel === 'function';
  const hasDenyMessageStack = typeof registry.withDenyMessage === 'function';

  if (hasPermissionStack && hasDenyMessageStack) {
    registry.withPermissionLevel(4, () =>
      registry.withDenyMessage(DEFAULT_DENY_MESSAGE, runWithDefaults)
    );
  } else if (hasPermissionStack) {
    registry.withPermissionLevel(4, runWithDefaults);
  } else if (hasDenyMessageStack) {
    registry.withDenyMessage(DEFAULT_DENY_MESSAGE, runWithDefaults);
  } else {
    runWithDefaults();
  }
}

/**
 * 显示命令帮助
 */
async function showCommandHelp(command, registry, context) {
  const lines = [];
  lines.push('');
  lines.push(`命令: ${registry.prefix}${command.fullPath}`);
  lines.push(`描述: ${command.description}`);

  if (command.aliases.length > 0) {
    lines.push(`别名: ${command.aliases.map(a => registry.prefix + a).join(', ')}`);
  }

  const extra = [];
  if (command.args.length > 0) {
    extra.push('\n参数:');
    command.args.forEach(arg => {
      const required = arg.required ? '(必需)' : '(可选)';
      const options = arg.options
        ? ` (选项: ${Array.isArray(arg.options) ? arg.options.join(', ') : '动态'})`
        : '';
      extra.push(`  ${arg.name} ${required} - ${arg.description || ''}${options}`);
    });
  }

  const message = buildTextComponent([
    { text: '\n命令: ', color: 'gold' },
    { text: registry.prefix + command.fullPath, color: 'yellow' },
    { text: '\n描述: ', color: 'gold' },
    { text: command.description || '无', color: 'white' },
    ...(extra.length > 0
      ? [
          { text: '\n\n', color: 'white' },
          { text: extra.join('\n'), color: 'white' }
        ]
      : [])
  ]);

  await context.reply(message);
}

/**
 * 显示所有命令帮助
 */
async function showAllCommandsHelp(registry, context) {
  const allCommands = registry.getAllCommands().filter(cmd => cmd.path.length === 1);

  const entries = allCommands.map(cmd => ({
    key: cmd.name.toLowerCase(),
    name: registry.prefix + cmd.name,
    description: cmd.description || '',
    aliases: cmd.aliases || [],
    hasChildren: registry.hasChildren(cmd.path)
  }));

  const entryMap = new Map(entries.map(entry => [entry.key, entry]));
  Object.keys(registry.commandTree).forEach(key => {
    if (!entryMap.has(key.toLowerCase())) {
      // 尝试从命令树节点中获取描述
      const node = registry.commandTree[key];
      let description = '包含子命令';
      if (node && node.commands && node.commands.length > 0) {
        // 使用第一个命令的描述
        description = node.commands[0].description || description;
      }
      entries.push({
        key: key.toLowerCase(),
        name: registry.prefix + key,
        description: description,
        aliases: [],
        hasChildren: true
      });
    }
  });

  const component = buildTextComponent([
    { text: '可用命令:\n', color: 'gold', bold: true },
    ...entries.flatMap(entry => {
      const parts = [
        { text: `  ${entry.name}`, color: 'yellow' },
        entry.hasChildren ? { text: ' ▸', color: 'gray' } : null,
        { text: ` - ${entry.description}\n`, color: 'white' }
      ];
      if (entry.aliases.length > 0) {
        parts.splice(1, 0, { text: ` (别名: ${entry.aliases.map(a => registry.prefix + a).join(', ')})`, color: 'gray' });
      }
      return parts.filter(Boolean);
    }),
    { text: `\n使用 ${registry.prefix}help <命令> 查看详细帮助`, color: 'gray' }
  ]);

  await context.reply(component);
}

