import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import { pathToFileURL } from 'url';
import AdmZip from 'adm-zip';
import { ConfigHelper } from './config-helper.js';

const SUPPORTED_SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs']);

/**
 * 插件管理器
 */
export class PluginManager {
  constructor({ projectRoot, logger, config, serverManager, commandHandler, rconManager, messenger, eventBus, outputProcessor, permissionManager, agentDataStore = null, agentManager = null }) {
    this.projectRoot = projectRoot;
    this.logger = logger;
    this.config = config;
    this.serverManager = serverManager;
    this.commandHandler = commandHandler;
    this.rconManager = rconManager;
    this.messenger = messenger;
    this.eventBus = eventBus;
    this.outputProcessor = outputProcessor;
    this.permissionManager = permissionManager;
    this.agentDataStore = agentDataStore;
    this.agentManager = agentManager;
    this.pluginsDir = join(projectRoot, 'plugins');
    this.cacheDir = join(projectRoot, '.bcnc-cache', 'plugins');
    this.loadedPlugins = new Map();
    this.pluginIds = new Set();
  }

  ensureDirectories() {
    [this.pluginsDir, this.cacheDir].forEach((dir) => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  readPluginEntries(logErrors = true) {
    this.ensureDirectories();
    try {
      return readdirSync(this.pluginsDir);
    } catch (error) {
      if (logErrors) {
        this.logger.error(`读取插件目录失败: ${error.message}`);
      }
      return [];
    }
  }

  /**
   * 扫描插件但不加载，用于显示信息
   */
  scanPlugins() {
    const entries = this.readPluginEntries(false);
    return {
      entries,
      count: entries.length
    };
  }

  /**
   * 加载所有插件
   */
  async loadPlugins(entries = null) {
    this.logger.info('正在扫描插件目录...');

    const pluginEntries = Array.isArray(entries) ? entries : this.readPluginEntries(true);

    for (const entry of pluginEntries) {
      await this.loadSingleEntry(entry).catch((error) => {
        this.logger.error(`插件 ${entry} 加载失败: ${error.message}`);
      });
    }

    this.logger.info(`插件加载完成，共 ${this.loadedPlugins.size} 个`);
  }

  async loadSingleEntry(entry) {
    const entryPath = join(this.pluginsDir, entry);
    let stats;
    try {
      stats = statSync(entryPath);
    } catch {
      throw new Error('无法访问插件文件');
    }

    if (stats.isDirectory()) {
      const indexPath = join(entryPath, 'index.js');
      if (!existsSync(indexPath)) {
        throw new Error('文件夹插件缺少 index.js');
      }
      await this.loadFromFile(indexPath, {
        type: 'directory',
        rootDir: entryPath,
        entryName: entry
      });
      return;
    }

    if (!stats.isFile()) {
      throw new Error('不支持的插件类型');
    }

    const ext = extname(entry).toLowerCase();
    if (SUPPORTED_SCRIPT_EXT.has(ext)) {
      await this.loadFromFile(entryPath, {
        type: 'single-file',
        rootDir: dirname(entryPath),
        entryName: entry
      });
      return;
    }

    if (ext === '.bcnc' || ext === '.zip') {
      const extractedDir = this.extractArchive(entryPath);
      const indexPath = join(extractedDir, 'index.js');
      if (!existsSync(indexPath)) {
        throw new Error('压缩插件缺少 index.js');
      }
      await this.loadFromFile(indexPath, {
        type: 'archive',
        rootDir: extractedDir,
        entryName: entry
      });
      return;
    }

    throw new Error(`不支持的插件文件类型: ${ext}`);
  }

  extractArchive(archivePath) {
    const name = basename(archivePath, extname(archivePath));
    const targetDir = join(this.cacheDir, name);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
    mkdirSync(targetDir, { recursive: true });
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(targetDir, true);
    return targetDir;
  }

  async loadFromFile(entryFile, metaInfo) {
    const moduleUrl = pathToFileURL(entryFile).href + `?t=${Date.now()}`;
    let imported;
    try {
      imported = await import(moduleUrl);
    } catch (error) {
      throw new Error(`导入失败: ${error.message}`);
    }

    const plugin = imported?.default ?? imported?.plugin ?? imported;
    if (!plugin || typeof plugin !== 'object') {
      throw new Error('插件模块必须导出对象');
    }

    const meta = plugin.meta ?? plugin.metadata;
    this.validateMeta(meta);

    const setup =
      plugin.setup ||
      plugin.activate ||
      plugin.init ||
      plugin.register ||
      plugin.load;

    if (typeof setup !== 'function') {
      throw new Error('插件缺少 setup/activate 方法');
    }

    if (this.loadedPlugins.has(meta.id)) {
      throw new Error(`插件 ${meta.id} 已加载`);
    }

    const pluginState = {
      id: meta.id,
      meta,
      source: entryFile,
      rootDir: metaInfo.rootDir,
      type: metaInfo.type,
      entryName: metaInfo.entryName,
      commands: [],
      eventSubscriptions: [],
      lineProcessors: [],
      teardown:
        plugin.teardown ||
        plugin.dispose ||
        plugin.unload ||
        plugin.deactivate ||
        null,
      plugin,
      context: null,
      agentSubscriptions: []
    };

    const context = this.createPluginContext(meta, metaInfo.rootDir, pluginState);
    pluginState.context = context;
    await Promise.resolve(setup(context));

    this.loadedPlugins.set(meta.id, pluginState);
    this.pluginIds.add(meta.id);
    this.logger.info(`插件 ${meta.name} (${meta.versionCode}@${meta.version || 'unknown'}) 已加载`);
  }

  validateMeta(meta) {
    if (!meta || typeof meta !== 'object') {
      throw new Error('插件缺少 meta 元信息');
    }

    const requiredFields = ['id', 'name', 'description', 'link', 'author', 'versionCode', 'version'];
    for (const field of requiredFields) {
      if (!meta[field]) {
        throw new Error(`插件 meta 缺少字段: ${field}`);
      }
    }

    if (!meta.author || !meta.author.name || !meta.author.link) {
      throw new Error('插件作者信息不完整');
    }

    if (typeof meta.versionCode === 'undefined') {
      throw new Error('插件缺少 versionCode');
    }

    if (typeof meta.version === 'undefined') {
      throw new Error('插件缺少 version');
    }

    if (this.pluginIds.has(meta.id)) {
      throw new Error(`插件 ID 重复: ${meta.id}`);
    }
  }

  createPluginContext(meta, pluginDir, pluginState) {
    const registry = this.commandHandler.getRegistry();
    const pluginsApi = {
      list: () => this.listLoadedPlugins(),
      info: (id) => this.getPluginMeta(id),
      load: (entry) => this.loadPluginEntry(entry),
      unload: (id) => this.unloadPlugin(id),
      reload: (id) => this.reloadPlugin(id),
      delete: (entry) => this.deletePluginEntry(entry)
    };
    const rconApi = this.rconManager ? this.rconManager.getPublicApi() : null;
    const eventsApi = this.eventBus
      ? {
          on: (event, handler) => {
            this.eventBus.on(event, handler);
            pluginState.eventSubscriptions.push({ event, handler });
            return handler;
          },
          once: (event, handler) => {
            const onceHandler = (...args) => {
              handler(...args);
              this.eventBus.off(event, onceHandler);
              pluginState.eventSubscriptions = pluginState.eventSubscriptions.filter(
                (sub) => sub.handler !== onceHandler
              );
            };
            this.eventBus.on(event, onceHandler);
            pluginState.eventSubscriptions.push({ event, handler: onceHandler });
            return onceHandler;
          },
          off: (event, handler) => {
            this.eventBus.off(event, handler);
            pluginState.eventSubscriptions = pluginState.eventSubscriptions.filter(
              (sub) => !(sub.event === event && sub.handler === handler)
            );
          },
          emit: (event, payload) => this.eventBus.emit(event, payload),
          registerLineProcessor: (definition) => {
            if (!this.outputProcessor) {
              throw new Error('当前环境不支持注册行解析器');
            }
            const id = this.outputProcessor.registerProcessor(definition);
            pluginState.lineProcessors.push(id);
            return id;
          },
          unregisterLineProcessor: (id) => {
            if (!this.outputProcessor || !id) {
              return;
            }
            this.outputProcessor.unregisterProcessor(id);
            pluginState.lineProcessors = pluginState.lineProcessors.filter((stored) => stored !== id);
          }
        }
      : null;
    const agentApi = this.agentDataStore
      ? {
          getSnapshot: () => this.agentDataStore.getSnapshot(),
          on: (event, handler) => {
            this.agentDataStore.on(event, handler);
            pluginState.agentSubscriptions.push({ event, handler });
            return handler;
          },
          once: (event, handler) => {
            const onceHandler = (...args) => {
              handler(...args);
              this.agentDataStore.off(event, onceHandler);
              pluginState.agentSubscriptions = pluginState.agentSubscriptions.filter(
                (sub) => sub.handler !== onceHandler
              );
            };
            this.agentDataStore.on(event, onceHandler);
            pluginState.agentSubscriptions.push({ event, handler: onceHandler });
            return onceHandler;
          },
          off: (event, handler) => {
            this.agentDataStore.off(event, handler);
            pluginState.agentSubscriptions = pluginState.agentSubscriptions.filter(
              (sub) => !(sub.event === event && sub.handler === handler)
            );
          }
        }
      : null;

    const pluginConfigDir = join(this.projectRoot, 'config', meta.id);
    if (!existsSync(pluginConfigDir)) {
      mkdirSync(pluginConfigDir, { recursive: true });
    }

    // 创建快捷配置接口
    const configHelper = new ConfigHelper(pluginConfigDir, this.logger);

    return {
      meta,
      pluginDir,
      pluginConfigDir,
      logger: this.logger,
      config: this.config,
      serverManager: this.serverManager,
      commandRegistry: registry,
      commandHandler: this.commandHandler,
      plugins: pluginsApi,
      rcon: rconApi,
      messenger: this.messenger,
      events: eventsApi,
      agent: agentApi,
      permissions: this.permissionManager ? this.permissionManager.getPublicApi() : null,
      players: this.agentManager ? this.agentManager.getPlayerListManager()?.getPublicApi() : null,
      // 快捷配置接口
      configHelper: {
        /**
         * 读取配置
         * @param {string} filename - 配置文件名（可选，默认为 config.yml 或 config.json）
         * @param {'yml'|'yaml'|'json'} type - 配置类型（可选，默认从文件名推断，否则为 yml）
         * @param {object} defaultValue - 默认值（如果文件不存在）
         * @returns {object} 配置对象
         */
        read: (filename, type, defaultValue) => configHelper.read(filename, type, defaultValue),
        /**
         * 写入配置
         * @param {object} data - 要写入的配置对象
         * @param {string} filename - 配置文件名（可选，默认为 config.yml 或 config.json）
         * @param {'yml'|'yaml'|'json'} type - 配置类型（可选，默认从文件名推断，否则为 yml）
         */
        write: (data, filename, type) => configHelper.write(data, filename, type),
        /**
         * 检查配置文件是否存在
         * @param {string} filename - 配置文件名（可选）
         * @param {'yml'|'yaml'|'json'} type - 配置类型（可选）
         * @returns {boolean} 文件是否存在
         */
        exists: (filename, type) => configHelper.exists(filename, type)
      },
      registerCommand: (path, definition) => {
        registry.register(path, definition);
        const storedPath = Array.isArray(path) ? [...path] : [path];
        pluginState.commands.push(storedPath);
      },
      unregisterCommand: (path) => {
        registry.unregister(path);
        const normalized = (Array.isArray(path) ? path : [path])
          .map(p => p.toLowerCase())
          .join(' ');
        pluginState.commands = pluginState.commands.filter(
          stored => stored.map(p => p.toLowerCase()).join(' ') !== normalized
        );
      },
      sendServerCommand: (cmd) => this.serverManager.sendCommand(cmd)
    };
  }

  listLoadedPlugins() {
    return Array.from(this.loadedPlugins.values()).map(state => state.meta);
  }

  getLoadedPlugin(id) {
    return this.loadedPlugins.get(id) || null;
  }

  getPluginMeta(id) {
    const state = this.loadedPlugins.get(id);
    return state ? state.meta : null;
  }

  getAllEntries() {
    return this.readPluginEntries(false);
  }

  async unloadPlugin(id) {
    const state = this.loadedPlugins.get(id);
    if (!state) {
      throw new Error(`插件 ${id} 未加载`);
    }

    if (state.teardown) {
      await Promise.resolve(state.teardown(state.context || {}));
    }

    const registry = this.commandHandler.getRegistry();
    state.commands.forEach(path => registry.unregister(path));
    if (state.eventSubscriptions) {
      state.eventSubscriptions.forEach(({ event, handler }) => {
        this.eventBus?.off(event, handler);
      });
    }
    if (state.lineProcessors) {
      state.lineProcessors.forEach((processorId) => {
        this.outputProcessor?.unregisterProcessor(processorId);
      });
    }
    if (state.agentSubscriptions && this.agentDataStore) {
      state.agentSubscriptions.forEach(({ event, handler }) => {
        this.agentDataStore.off(event, handler);
      });
    }

    this.loadedPlugins.delete(id);
    this.pluginIds.delete(id);
    this.logger.info(`插件 ${state.meta.name} 已卸载`);
  }

  async reloadPlugin(id) {
    const state = this.loadedPlugins.get(id);
    if (!state) {
      throw new Error(`插件 ${id} 未加载`);
    }
    const entryName = state.entryName;
    await this.unloadPlugin(id);
    await this.loadSingleEntry(entryName);
  }

  async loadPluginEntry(entryName) {
    await this.loadSingleEntry(entryName);
  }

  async deletePluginEntry(entryName) {
    const entryPath = join(this.pluginsDir, entryName);
    if (!existsSync(entryPath)) {
      throw new Error(`插件文件 ${entryName} 不存在`);
    }

    for (const [id, state] of this.loadedPlugins.entries()) {
      if (state.entryName === entryName) {
        await this.unloadPlugin(id);
      }
    }

    rmSync(entryPath, { recursive: true, force: true });
    const cacheDir = join(this.cacheDir, basename(entryName, extname(entryName)));
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }
}

