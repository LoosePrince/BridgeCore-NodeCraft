import { dirname, join, resolve as resolvePath } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import chalk from 'chalk';
import { loadConfig } from './config/loader.js';
import { initializeProject } from './utils/initializer.js';
import { Logger } from './utils/logger.js';
import { ServerManager } from './server/manager.js';
import { ServerEventBus } from './server/events.js';
import { ServerOutputProcessor } from './server/output-processor.js';
import { RconManager } from './server/rcon.js';
import { InteractiveCLI } from './commands/interactive.js';
import { CommandHandler } from './commands/handler.js';
import { Messenger } from './commands/messenger.js';
import { PluginManager } from './plugins/manager.js';
import { AgentManager } from './agent/manager.js';
import { AgentDataStore } from './agent/data-store.js';
import { PermissionManager } from './permissions/manager.js';
import { PlayerPresenceTracker } from './server/player-presence-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 项目根目录是 Script 的父目录
const projectRoot = dirname(__dirname);

/**
 * 主函数
 */
async function main() {
  // 初始化项目结构
  const configCreated = initializeProject(projectRoot);
  
  // 如果创建了新的 config.yml，提示用户配置后重新启动
  if (configCreated) {
    console.log('');
    console.log(chalk.yellow('═══════════════════════════════════════════════════════════'));
    console.log(chalk.yellow('  检测到首次运行，已创建 config.yml 配置文件'));
    console.log(chalk.yellow('═══════════════════════════════════════════════════════════'));
    console.log('');
    console.log(chalk.cyan('请完成以下配置后重新启动：'));
    console.log(chalk.white('  1. 编辑 config.yml 文件'));
    console.log(chalk.white('  2. 配置 server.startCommand（服务器启动命令）'));
    console.log(chalk.white('  3. 配置 server.directory（服务器目录路径）'));
    console.log(chalk.white('  4. 根据需要调整其他配置项'));
    console.log('');
    console.log(chalk.gray('配置文件位置:'), chalk.white(join(projectRoot, 'config.yml')));
    console.log('');
    console.log(chalk.yellow('配置完成后，请重新运行启动命令。'));
    console.log('');
    process.exit(0);
  }
  
  // 加载配置
  const config = loadConfig(projectRoot);
  const packageInfo = loadPackageInfo();
  const pluginManagerRef = { current: null };
  
  // 创建日志器
  const logger = new Logger(config, projectRoot);
  const permissionManager = new PermissionManager({ projectRoot, logger });
  
  // 创建服务器管理器
  const eventBus = new ServerEventBus();
  const handlerName = config.server?.handler || 'vanilla';
  const outputProcessor = new ServerOutputProcessor({ eventBus, logger, handlerName });
  const serverDirectory = config.server?.directory
    ? resolvePath(projectRoot, config.server.directory)
    : projectRoot;
  const userCachePath = join(serverDirectory, 'usercache.json');
  const playerPresenceTracker = new PlayerPresenceTracker({ eventBus, logger, userCachePath });
  const serverManager = new ServerManager(config, logger, projectRoot, {
    eventBus,
    outputProcessor
  });
  const rconManager = new RconManager({ config, logger, projectRoot });
  await rconManager.init({ autoConnect: false });
  const messenger = new Messenger({ logger, serverManager });
  
  // 创建 Agent 数据存储 & 管理器
  const agentDataStore = new AgentDataStore(logger);
  const agentManager = new AgentManager(logger, config, serverManager, agentDataStore);
  agentManager.setPresenceTracker(playerPresenceTracker);
  
  // 创建命令处理器
  const commandHandler = new CommandHandler(config, serverManager, logger, {
    projectRoot,
    pluginManagerRef,
    messenger,
    agentManager,
    permissionManager
  });
  
  // 插件管理
  const pluginManager = new PluginManager({
    projectRoot,
    logger,
    config,
    serverManager,
    commandHandler,
    rconManager,
    messenger,
    eventBus,
    outputProcessor,
    permissionManager,
    agentDataStore,
    agentManager
  });
  pluginManagerRef.current = pluginManager;
  
  // 创建交互式命令行
  const cli = new InteractiveCLI(config, serverManager, logger, projectRoot, commandHandler);
  
  // 初始化交互式命令行（打印欢迎信息）
  cli.init();

  const pluginScan = pluginManager.scanPlugins();

  // 欢迎信息之后输出运行信息
  printRuntimeInfo({
    logger,
    version: packageInfo.version,
    serverCommand: buildServerCommand(config, projectRoot),
    pluginCount: pluginScan.count,
    pluginDir: pluginManager.pluginsDir
  });

  // 设置游戏内命令监听
  setupInGameCommandListener({
    eventBus,
    commandHandler,
    messenger,
    prefix: config.commands.prefix
  });

  // 设置服务器启动完成后的自动注入
  setupAutoInject({
    eventBus,
    agentManager,
    config,
    logger,
    commandHandler,
    messenger
  });

  // 监听 Agent 连接，自动注册默认规则（无论是自动注入还是手动注入）
  agentManager.onAgentReady = () => {
    // 延迟一小段时间确保拦截器已初始化
    setTimeout(() => {
      setupDefaultInterceptRules({ agentManager, config, logger, commandHandler, messenger });
    }, 100);
  };

  // 加载插件（在 Java 检查之前）
  await pluginManager.loadPlugins(pluginScan.entries);

  // 启动服务器
  await serverManager.start();
  // RCON 由插件按需使用，不在核心流程中自动连接
  
  // 处理进程信号
  process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\n收到中断信号，正在关闭服务器...'));
    
    // 关闭 Agent
    if (agentManager && agentManager.getStatus().connected) {
      await agentManager.shutdown();
    }
    
    serverManager.stop();
    rconManager.disconnect();
    cli.close();
    logger.close();
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  });

  process.on('SIGTERM', async () => {
    console.log(chalk.yellow('\n\n收到终止信号，正在关闭服务器...'));
    
    // 关闭 Agent
    if (agentManager && agentManager.getStatus().connected) {
      await agentManager.shutdown();
    }
    
    serverManager.stop();
    rconManager.disconnect();
    cli.close();
    logger.close();
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  });
}

// 运行主函数
main().catch(error => {
  console.error(chalk.red('❌ 启动失败:'), error);
  process.exit(1);
});

function loadPackageInfo() {
  try {
    const pkgPath = new URL('./package.json', import.meta.url);
    return JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return { version: 'unknown' };
  }
}

function buildServerCommand(config, projectRoot) {
  const serverConfig = config.server || {};
  if (serverConfig.startCommand) {
    return serverConfig.startCommand;
  }

  const serverDir = join(projectRoot, serverConfig.directory || '');
  const jarPath = join(serverDir, serverConfig.jarFile || '');
  const args = [
    ...(serverConfig.jvmArgs || []),
    '-jar',
    jarPath,
    ...(serverConfig.serverArgs || [])
  ];
  return `"${serverConfig.javaPath || 'java'}" ${args.join(' ')}`.trim();
}

function printRuntimeInfo({ logger, version, serverCommand, pluginCount, pluginDir }) {
  logger.info(`BCNC 版本: v${version}`);
  logger.info(`服务器启动命令: ${serverCommand}`);
  logger.info(`插件数量: ${pluginCount}`);
  logger.debug(`插件目录: ${pluginDir}`);
}

function setupInGameCommandListener({ eventBus, commandHandler, prefix }) {
  if (!eventBus) {
    return;
  }
  eventBus.on('server:chat', async ({ player, message }) => {
    if (!player || !message || !message.startsWith(prefix)) {
      return;
    }
    try {
      await commandHandler.handle(message, { source: 'player', player });
    } catch (error) {
      console.error('处理游戏内命令失败:', error);
    }
  });
}

function setupAutoInject({ eventBus, agentManager, config, logger, commandHandler, messenger }) {
  if (!eventBus || !agentManager) {
    return;
  }

  // 监听服务器启动完成事件
  eventBus.on('server:ready', async ({ duration }) => {
    // 检查是否启用自动注入
    const autoInject = config?.agent?.autoInject ?? false;
    
    if (!autoInject) {
      logger.debug('自动注入已禁用');
      return;
    }

    logger.info(`服务器启动完成 (耗时 ${duration}s)，准备自动注入 Agent...`);
    
    // 等待一小段时间确保服务器完全就绪
    setTimeout(async () => {
      try {
        logger.info('正在自动注入 Agent...');
        await agentManager.inject('auto');
        
        // 等待 Agent 连接后再注册规则
        agentManager.communicator.once('ready', () => {
          setupDefaultInterceptRules({ agentManager, config, logger, commandHandler, messenger });
        });
      } catch (error) {
        logger.error(`Agent 自动注入失败: ${error.message}`);
      }
    }, 1000);
  });
}

function setupDefaultInterceptRules({ agentManager, config, logger, commandHandler, messenger }) {
  const interceptor = agentManager.getInterceptor();
  if (!interceptor) {
    logger.warn('拦截器未初始化');
    return;
  }

  const commandPrefix = config?.commands?.prefix || '!';

  // 注册命令前缀拦截
  interceptor.onCommand(commandPrefix, (command, playerName) => {
    logger.info(`玩家 ${playerName} 执行命令: ${commandPrefix}${command}`);
    
    // 执行命令
    if (commandHandler) {
      commandHandler.handle(commandPrefix + command, {
        source: 'player',
        player: playerName
      }).catch(error => {
        logger.error(`执行命令失败: ${error.message}`);
        if (messenger) {
          messenger.tell(playerName, `§c命令执行失败: ${error.message}`);
        }
      });
    }
  });

  logger.debug(`已注册默认拦截规则: 命令前缀 "${commandPrefix}"`);
}

