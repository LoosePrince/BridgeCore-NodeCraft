# BCNC 插件与 API 参考

插件形态、上下文 API、事件系统与编写规范。

## 1. 插件基础

### 1.1 形态

| 形态 | 放置方式 | 适用场景 |
| --- | --- | --- |
| 单文件 | `plugins/example.js` | 体量小、脚本化 |
| 文件夹 | `plugins/example/index.js` | 需要资源/配置 |
| 打包 | `plugins/example.bcnc` / `.zip` | 分发、隔离依赖 |

BCNC 启动时会扫描 `plugins/`，也可通过命令 `!plugins load`/`reload` 管理。

### 1.2 最小示例

```javascript
export default {
  meta: {
    id: 'sample-plugin',
    name: '示例插件',
    description: '演示命令注册',
    author: { name: 'BCNC', link: 'https://github.com/BridgeCore-Network' },
    link: 'https://github.com/BridgeCore-Network',
    versionCode: 1,
    version: '1.0.0'
  },
  async setup(ctx) {
    ctx.registerCommand('hello', {
      description: '问候',
      handler: async (args, context) => {
        await context.reply({ text: 'Hello from plugin!', color: 'aqua' });
        return true;
      }
    });
  }
};
```

> `setup` 可替换为 `activate` / `init` / `register` / `load`；如需清理资源可导出 `teardown` 等方法。

### 1.3 元信息字段

| 字段 | 说明 |
| --- | --- |
| `id` | 插件唯一 ID（推荐小写 + `-`） |
| `name` | 显示名 |
| `description` | 简述功能 |
| `author` | `{ name, link }` |
| `link` | 插件主页/仓库 |
| `versionCode` | 递增数值，用于比较 |
| `version` | 面向用户的版本号 |

## 2. 插件上下文 (`ctx`)

加载插件时 BCNC 传入单一 `ctx` 对象，常用字段如下。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `meta` | `PluginMeta` | 当前插件元信息 |
| `pluginDir` | `string` | 插件所在目录 |
| `pluginConfigDir` | `string` | 插件专属配置目录 |
| `logger` | `Logger` | 日志实例（`debug/info/warn/error`） |
| `config` | `object` | 只读运行配置 |
| `serverManager` | `ServerManager` | 控制 MC 服务器（`start/stop/sendCommand/isRunning`） |
| `commandRegistry` | `CommandRegistry` | 低级命令树操作 |
| `commandHandler` | `CommandHandler` | 可直接调用核心命令 |
| `plugins` | `PluginAPI` | 管理其他插件 |
| `rcon` | `RconAPI` | RCON 封装，需要配置启用 |
| `events` | `EventsAPI` | 结构化事件接口 |
| `messenger` | `Messenger` | 文本组件消息工具 |
| `permissions` | `PermissionAPI` | 权限管理 API |
| `configHelper` | `ConfigHelperAPI` | 快捷配置接口（读写 YAML/JSON） |

### 2.1 命令注册

```javascript
ctx.registerCommand(['plugin', 'reload'], {
  description: '重载插件',
  aliases: ['plr'],
  permissionLevel: 3,  // 可选：需要 3 级或以上权限
  denyMessage: '你没有权限执行此命令',  // 可选：权限不足时的提示消息
  handler: async (args, context) => { ... }
});

ctx.unregisterCommand(['plugin', 'reload']);
```

- `handler(args, context)`：
  - `context.source`：`'cli'` 或 `'player'`
  - `context.player`：玩家名（若来源为玩家）
  - `context.reply(message, options)`：统一回复
  - `context.messenger`：同 `ctx.messenger`
- `permissionLevel`：可选，指定命令所需的最低权限级别（1-4）
- `denyMessage`：可选，权限不足时显示的消息（默认："你没有权限执行此命令"）

### 2.2 服务器交互

```javascript
if (ctx.serverManager.isRunning()) {
  ctx.sendServerCommand('say Hello!');
}
```

- `ctx.sendServerCommand` 会直接写入服务器标准输入。
- 需确保服务器已启动。

### 2.3 权限管理

```javascript
// 检查玩家权限
const hasPermission = ctx.permissions.hasPermission('PlayerName', 3);

// 获取玩家权限级别
const level = ctx.permissions.getLevel('PlayerName');

// 设置玩家权限级别
ctx.permissions.setLevel('PlayerName', 3);

// 获取默认权限级别
const defaultLevel = ctx.permissions.getDefaultLevel();

// 列出所有玩家权限
const players = ctx.permissions.list();
```

权限级别范围：1-4（数字越大权限越高）
- CLI 默认拥有 4 级权限
- 游戏中玩家默认 1 级权限
- 可在 `config/permissions.yml` 中配置

### 2.4 插件管理 API

| 方法 | 描述 |
| --- | --- |
| `ctx.plugins.list()` | 列出所有插件 |
| `ctx.plugins.info(id)` | 获取元信息 |
| `ctx.plugins.load(entry)` | 加载插件 |
| `ctx.plugins.reload(id)` | 重载 |
| `ctx.plugins.unload(id)` | 卸载并调用 `teardown` |
| `ctx.plugins.delete(entry)` | 卸载并删除 |

> 操作其他插件需谨慎，避免循环依赖或频繁重载。

### 2.5 RCON API

```javascript
if (ctx.rcon?.isEnabled()) {
  await ctx.rcon.ensureConnected();
  const result = await ctx.rcon.send('list');
  ctx.logger.info(`在线玩家: ${result}`);
}
```

- `isEnabled()` 与 `isConnected()` 可判断状态。
- 通过 `getSettings()` 查询 host/port（只读）。

### 2.6 消息发送

```javascript
await context.reply({ text: '操作成功', color: 'green' });

await ctx.messenger.sendToPlayer('PlayerName', [
  { text: '[BCNC] ', color: 'gold' },
  { text: '自定义消息', color: 'white' }
]);
```

- 统一使用 Minecraft 原始 JSON 文本组件，确保颜色与样式一致。

### 2.7 快捷配置接口

`ctx.configHelper` 提供在 `pluginConfigDir` 下的快速读写配置功能，支持 YAML 和 JSON 格式。

```javascript
// 读取配置（默认使用 config.yml）
const config = ctx.configHelper.read();
// 或指定文件名和类型
const config = ctx.configHelper.read('settings.json', 'json', { default: 'value' });

// 写入配置（默认使用 config.yml）
ctx.configHelper.write({ key: 'value', number: 42 });
// 或指定文件名和类型
ctx.configHelper.write({ key: 'value' }, 'settings.json', 'json');

// 检查配置文件是否存在
if (ctx.configHelper.exists('settings.json', 'json')) {
  // 文件存在
}
```

**API 说明：**

- `read(filename?, type?, defaultValue?)`：读取配置
  - `filename`：配置文件名（可选，默认为 `config.yml` 或 `config.json`）
  - `type`：配置类型 `'yml'|'yaml'|'json'`（可选，默认从文件名推断，否则为 `yml`）
  - `defaultValue`：默认值（如果文件不存在，默认为 `{}`）
  - 返回：配置对象

- `write(data, filename?, type?)`：写入配置
  - `data`：要写入的配置对象
  - `filename`：配置文件名（可选，默认为 `config.yml` 或 `config.json`）
  - `type`：配置类型 `'yml'|'yaml'|'json'`（可选，默认从文件名推断，否则为 `yml`）

- `exists(filename?, type?)`：检查配置文件是否存在
  - `filename`：配置文件名（可选）
  - `type`：配置类型（可选）
  - 返回：`boolean`

**示例：**

```javascript
export default {
  meta: { /* ... */ },
  async setup(ctx) {
    // 读取默认配置（config.yml）
    let settings = ctx.configHelper.read(null, null, { enabled: true, port: 8080 });
    
    // 修改配置
    settings.enabled = false;
    
    // 保存配置
    ctx.configHelper.write(settings);
    
    // 使用 JSON 格式
    const jsonConfig = ctx.configHelper.read('data.json', 'json', {});
    jsonConfig.lastUpdate = Date.now();
    ctx.configHelper.write(jsonConfig, 'data.json', 'json');
  }
};
```

## 3. 事件系统

### 3.1 事件总线

- `ctx.eventBus`：基于 Node.js `EventEmitter`。
- `ctx.events`：结构化事件接口，附带行解析器。

### 3.2 内置事件示例

| 事件 | 数据结构 | 说明 |
| --- | --- | --- |
| `server:ready` | `{ duration, time, thread, line, source, timestamp }` | 服务器启动完成 |
| `server:closing` | `{ timestamp }` | 服务器开始关闭（调用 stop() 时触发） |
| `server:closed` | `{ code, signal, timestamp }` | 服务器已关闭（进程退出时触发） |
| `server:line` | `{ line, source, timestamp }` | 每一行日志 |
| `server:chat` | `{ player, message, time, thread, line, source, timestamp }` | 玩家聊天 |
| `player:join` | `{ player, time, line, source, timestamp }` | 玩家加入 |
| `player:leave` | 同上 | 玩家离开 |
| `player:death` | `{ message, time, line, source, timestamp }` | 玩家死亡 |
| `player:advancement` | `{ player, advancement, category, time, line, source, timestamp }` | 成就/进度 |

### 3.3 监听示例

```javascript
export function setup(ctx) {
  ctx.eventBus.on('server:ready', ({ duration }) => {
    ctx.logger.info(`服务器启动耗时 ${duration}s`);
  });

  ctx.eventBus.on('server:chat', ({ player, message }) => {
    if (message === '!time') {
      const now = new Date().toLocaleTimeString();
      ctx.sendServerCommand(`tellraw ${player} {"text":"当前时间：${now}","color":"aqua"}`);
    }
  });
}
```

### 3.4 自定义解析器

```javascript
const processorId = ctx.events.registerLineProcessor({
  regex: /^\[(.+?)\] \[(.+?)\/INFO\]: Custom: (.+)$/,
  event: 'custom:event',
  transform: (match) => ({ time: match[1], thread: match[2], data: match[3] })
});

ctx.events.on('custom:event', ({ data }) => {
  ctx.logger.info(`捕获自定义事件: ${data}`);
});

ctx.events.off('custom:event', handler);
ctx.events.unregisterLineProcessor(processorId);
```

- 注册解析器时需保证正则/匹配函数鲁棒，避免异常影响其他插件。

## 4. 编写规范

1. **模块导出**
   - 使用 ESM，默认导出包含 `meta` 与 `setup`。
   - 如需清理资源，导出 `teardown`/`dispose` 等。
2. **异步**
   - 所有耗时操作使用 `async/await`。
   - `setup`/`teardown` 返回 Promise 时，BCNC 会等待完成。
3. **命令冲突**
   - 避免与核心命令（`!stop`、`!help` 等）重名。
   - 卸载时记得 `unregisterCommand`。
4. **日志与输出**
   - 统一使用 `ctx.logger`；面向玩家使用 `context.reply` / `ctx.messenger`。
5. **资源访问**
   - 使用 `ctx.pluginConfigDir` 读写插件自身资源；勿写入核心目录。
6. **服务器交互**
   - 在发送命令前确认服务器状态。
7. **事件清理**
   - 插件卸载时自动清理监听器和解析器；如需提前移除，可保存引用手动处理。
8. **RCON 安全**
   - 检查启用状态，捕获连接错误，避免高频调用。
9. **配置与状态**
   - `ctx.config` 为只读；自定义配置应写入插件目录。
10. **插件自管理**
    - 使用 `ctx.plugins` 操作其他插件前需考虑依赖、并发与安全。

## 5. 权限系统示例

### 5.1 权限检查示例

```javascript
export default {
  meta: {
    id: 'permission-example',
    name: '权限示例插件',
    version: '1.0.0'
  },
  async setup(ctx) {
    // 注册需要 3 级权限的命令
    ctx.registerCommand('admin', {
      permissionLevel: 3,
      denyMessage: '§c你需要管理员权限才能使用此命令',
      handler: async (args, context) => {
        await context.reply({ text: '管理员命令执行成功', color: 'green' });
        return true;
      }
    });

    // 在事件处理中检查权限
    ctx.eventBus.on('server:chat', async ({ player, message }) => {
      if (message.startsWith('!test')) {
        const hasPermission = ctx.permissions.hasPermission(player, 2);
        if (hasPermission) {
          await ctx.messenger.sendToPlayer(player, [
            { text: '[测试] ', color: 'gold' },
            { text: '你有权限执行此操作', color: 'green' }
          ]);
        } else {
          await ctx.messenger.sendToPlayer(player, [
            { text: '[测试] ', color: 'gold' },
            { text: '权限不足', color: 'red' }
          ]);
        }
      }
    });
  }
};
```

### 5.2 动态权限管理示例

```javascript
export default {
  meta: {
    id: 'permission-manager',
    name: '权限管理插件',
    version: '1.0.0'
  },
  async setup(ctx) {
    // 注册权限管理命令（需要 4 级权限）
    ctx.registerCommand(['perm', 'plugin'], {
      permissionLevel: 4,
      handler: async (args, context) => {
        const [action, player, level] = args;
        
        if (action === 'set' && player && level) {
          const newLevel = parseInt(level, 10);
          if (newLevel >= 1 && newLevel <= 4) {
            ctx.permissions.setLevel(player, newLevel);
            await context.reply({
              text: `已将 ${player} 的权限设置为 ${newLevel} 级`,
              color: 'green'
            });
          } else {
            await context.reply({
              text: '权限级别必须在 1-4 之间',
              color: 'red'
            });
          }
        } else if (action === 'get' && player) {
          const level = ctx.permissions.getLevel(player);
          await context.reply({
            text: `${player} 的权限级别: ${level}`,
            color: 'aqua'
          });
        }
        
        return true;
      }
    });
  }
};
```

## 6. 综合示例：服务器监控插件

```javascript
export const meta = {
  id: 'server-monitor',
  name: '服务器监控',
  version: '1.0.0',
  versionCode: 1,
  description: '监控服务器状态和玩家活动',
  author: { name: 'Your Name', link: 'https://example.com' },
  link: 'https://example.com/plugin'
};

const stats = { startTime: null, playerCount: 0, chatMessages: 0 };

export function setup(ctx) {
  ctx.eventBus.on('server:ready', ({ duration }) => {
    stats.startTime = new Date();
    ctx.logger.info(`服务器启动完成，耗时 ${duration}s`);
  });

  ctx.eventBus.on('player:join', ({ player }) => {
    stats.playerCount++;
    ctx.logger.info(`${player} 加入，当前玩家数：${stats.playerCount}`);
  });

  ctx.eventBus.on('player:leave', ({ player }) => {
    stats.playerCount--;
    ctx.logger.info(`${player} 离开，当前玩家数：${stats.playerCount}`);
  });

  ctx.eventBus.on('server:chat', () => stats.chatMessages++);

  ctx.registerCommand('stats', {
    description: '查看服务器统计信息',
    handler: async () => {
      const uptime = stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0;
      ctx.logger.info(`=== 服务器统计 ===`);
      ctx.logger.info(`运行时间: ${uptime}s`);
      ctx.logger.info(`在线玩家: ${stats.playerCount}`);
      ctx.logger.info(`聊天消息: ${stats.chatMessages}`);
      return true;
    }
  });
}

export function teardown(ctx) {
  ctx.logger.info('服务器监控插件已卸载');
}
```

## 7. 最佳实践速记

- **结构化输出**：统一使用 JSON 文本组件。
- **事件优先**：优先通过事件驱动逻辑，减少轮询。
- **清晰日志**：用 `ctx.logger` 分类输出，便于排查。
- **资源隔离**：所有写操作限定在 `ctx.pluginConfigDir`。
- **命令反馈**：所有命令都使用 `context.reply` 提供结果。

---

更多底层架构与 Agent 能力参见《BCNC 基础说明与架构概览》；Agent 注入、配置与协议可参考《BCNC 技术性说明》。

