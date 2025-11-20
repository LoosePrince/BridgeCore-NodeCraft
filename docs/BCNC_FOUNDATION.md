# BCNC 基础说明与架构概览

整体能力、场景与架构。

## 1. 系统定位

- **BridgeCore-NodeCraft (BCNC)**：面向 Minecraft 服务器的自动化与扩展平台。
- **目标**：无缝接入 Java Agent，提供 Node.js 层可编排的深度控制（聊天拦截、命令桥接、游戏事件等）。
- **价值**：
  - 运行时注入，避免频繁重启。
  - Node.js 端集中承载所有业务逻辑，可迭代、可扩展。
  - 插件化生态；统一上下文、防止重复造轮子。

## 2. 关键特性

| 能力 | 说明 |
| --- | --- |
| 运行时注入 | 通过 Java Attach API 将 Agent 注入任意运行中的 JVM |
| 自动编译 | 首次注入前自动编译 `bcnc-agent.jar` 与 `bcnc-attacher.jar` |
| 双向通信 | 基于 TCP Socket（默认端口 25575），Agent 与 Node.js 实时通讯 |
| 统一拦截 | Agent 负责底层字节码注入，Node.js 负责注册、卸载、执行拦截规则 |
| 事件驱动 | `server:ready`、`server:chat` 等事件与自动注入机制联动 |
| 插件生态 | Node.js 层暴露完整插件 API，支持命令、事件、消息等扩展 |
| 权限系统 | 4 级权限管理（1-4），支持玩家权限配置和命令权限控制 |
| 多服务器支持 | 支持 Vanilla、Forge、Paper 等服务器类型，自动适配日志格式 |
| 编码支持 | 支持 UTF-8 和 GBK 编码，解决 Windows 中文乱码问题 |
| 日志管理 | 动态日志级别控制，Agent 日志自动过滤和重定向 |

## 3. 体系架构

```
┌───────────────────────────────────┐
│  BridgeCore-NodeCraft (Node.js)   │
│  ┌─────────────────────────────┐ │
│  │ AgentManager                │ │
│  │ ├─ Injector（自动编译/Attach） │
│  │ └─ Communicator（Socket 服务） │
│  └──────────┬──────────────────┘ │
└─────────────┼────────────────────┘
              │ TCP Socket (默认 25575)
┌─────────────▼────────────────────┐
│      Minecraft Server (JVM)      │
│  ┌─────────────────────────────┐ │
│  │ BCNC Agent (Java)           │ │
│  │ ├─ 字节码拦截器 & 规则注册     │
│  │ ├─ Socket Client             │
│  │ └─ JVM 访问                  │
│  └─────────────────────────────┘ │
└───────────────────────────────────┘
```

### 3.1 Agent 层（Java）

- **职责**：通过 ASM 注入聊天拦截等底层能力，不含业务逻辑。
- **核心模块**：
  - `ChatInterceptorTransformer`：植入拦截指令。
  - `intercept/ChatInterceptModule`：统一抽取玩家/消息。
  - `intercept/RuleRegistry`：接收 Node.js 注册的规则。
  - `BCNCAgent`：生命周期、通信管理。
- **工作流**：
  1. Agent 进入服务器 JVM。
  2. 针对聊天处理方法植入拦截逻辑。
  3. 匹配 Node.js 下发的规则。
  4. 通过 Socket 发送触发事件。

### 3.2 Node.js 层

- **职责**：集中承载业务逻辑，统一控制 Agent 注入、通信、插件生态。
- **模块**：
  - `AgentManager`：注入、状态、编译。
  - `Communicator`：Socket Server + 消息协议。
  - 各类插件：通过上下文 API 注册命令、监听事件、管理 Agent。

## 4. 注入方式

### 4.1 交互式注入

1. 启动 BCNC：`npm start`
2. 控制台执行 `!agent inject [pid]`
3. 流程：
   - 若缺少 JAR，自动编译。
   - 自动查找（或使用 PID）定位 Minecraft 进程。
   - 通过 Attach API 注入 Agent。
   - 建立 Socket 连接，输出状态。

### 4.2 自动注入

- 在 `config.yml` 中开启：

```yaml
agent:
  autoInject: true
  port: 25575
```

- 工作流：
  1. 服务器启动日志出现 `Done (...)!`。
  2. 触发 `server:ready`。
  3. 若 `autoInject=true`，延迟（默认 1 秒）执行 `agentManager.inject('auto')`。
  4. 成功建立连接后广播“Agent 就绪”。

- 支持：
  - 调整等待时间（例如修改 `setTimeout` 为 3 秒）。
  - 自定义重试逻辑。
  - 插件内基于 `server:ready` 事件做条件注入。

## 5. Agent 能力示例

### 5.1 命令前缀拦截

```javascript
const interceptor = agentManager.getInterceptor();

interceptor.onCommand('!', (command, playerName) => {
  commandHandler.handle('!' + command, { source: 'player', player: playerName });
});
```

### 5.2 关键词/正则拦截

```javascript
interceptor.onKeyword('admin', ({ message, playerName }) => {
  logToFile(`[ADMIN] ${playerName}: ${message}`);
});

interceptor.onRegex('.*\\d{4,}.*', 'number-sequence', ({ message }) => {
  checkForSuspiciousContent(message);
});
```

### 5.3 自定义规则注册

```javascript
interceptor.registerRule({
  id: 'custom-filter',
  pattern: '/tp',
  matchType: 'contains',
  handler: ({ message, playerName }) => {
    if (!hasPermission(playerName, 'command.tp')) {
      messenger.tell(playerName, '§c你没有权限');
      return;
    }
    serverManager.sendCommand(message);
  }
});
```

## 6. 典型时序

1. **启动 BCNC** → 读取配置 → 启动服务器。
2. **服务器就绪** → 触发 `server:ready` → 自动注入（可选）。
3. **Agent 注入成功** → Socket 连接 → Node.js 注册基础规则。
4. **插件加载** → 通过 `ctx` API 注册命令/事件。
5. **运行期**：
   - 玩家触发聊天 → Agent 匹配规则 → 通知 Node.js → 执行业务逻辑。
   - 插件监听事件→ 发送命令/消息 → 更新服务器状态。

## 7. 未来扩展

| 方向 | 说明 |
| --- | --- |
| 玩家移动/方块事件 | 通过新增字节码转换器扩展 Agent，沿用同一通信协议 |
| 命令注册 | 在 Agent 端直接注册自定义游戏命令 |
| 性能监控 | 实时采集 JVM 指标、提供 Node.js 端监控插件 |
| 热更新 | 通过 Agent 支持运行时替换类，实现快速迭代 |

---

- 技术细节（命令参数、配置、协议、故障排除）请参考《BCNC 技术性说明》。

