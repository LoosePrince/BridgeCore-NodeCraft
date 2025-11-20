# BCNC 技术性说明

Agent 注入、配置、通信协议与故障排除等细节。

## 1. 注入命令总览

| 命令 | 功能 | 示例 / 备注 |
| --- | --- | --- |
| `!agent inject [pid]` | 将 Agent 注入指定（或自动探测的）Minecraft 进程 | `!agent inject 12345` |
| `!agent compile` | 手动编译 Agent/Attacher JAR | 首次注入自动触发 |
| `!agent status` | 查看注入与连接状态 | 展示端口、PID 等 |
| `!agent ping` | 检测 Agent 是否存活 | 发送 Ping/Pong |
| `!agent info` | 获取 JVM 版本、内存、CPU | 依赖 Agent 已连接 |
| `!agent classes` | 查询已加载类数量 | 诊断类加载情况 |
| `!agent shutdown` | 主动断开并卸载 Agent | 重新注入前使用 |
| `!help agent` | 查看命令帮助 | CLI 说明 |

> 若自动进程查找失败，使用 `tasklist | findstr java`（Windows）或 `ps aux | grep java`（类 Unix）定位 PID。

## 2. 注入执行流程

1. **预检**：
   - 检查 `JAVA_HOME` 是否指向 JDK。
   - 校验 `bcnc-agent.jar` 与 `bcnc-attacher.jar`，缺失则编译。
2. **编译**：
   - `BCNCAgent.java`、`BCNCAttacher.java` 依次编译后打包。
3. **定位进程**：
   - 默认尝试匹配正在运行的 Minecraft 服务端。
   - 用户可传入 PID。
4. **Attach**：
   - 使用 `com.sun.tools.attach.VirtualMachine` 将 Agent 注入。
   - 传入 Node.js Socket 服务端口等参数。
5. **通信建立**：
   - Agent 连接 Node.js `Communicator`。
   - 广播状态（已注入/已连接）。

## 3. 配置与自动注入

### 3.1 `config.yml`

```yaml
# Agent 配置
agent:
  autoInject: true   # true 时在 server:ready 后自动注入
  port: 25575        # Node.js Socket 服务端口

# 服务器配置
server:
  handler: "vanilla"  # 日志解析器: "vanilla", "forge", "paper"
  encoding: "utf-8"   # 输出编码: "utf-8" 或 "gbk"（Windows 中文乱码时使用 "gbk"）

# 日志配置
logging:
  level: "info"  # 日志级别: "debug", "info", "warn", "error"（会同步到 Agent）
```

- **autoInject**：默认关闭；启用后监听 `server:ready` 并延迟（默认 1 秒）调用 `agentManager.inject('auto')`。
- **port**：确保未被占用；Agent 与 Node.js 必须一致。
- **handler**：服务器日志解析器，根据服务器类型选择（Vanilla/Forge/Paper）。
- **encoding**：服务器输出编码，Windows 系统如果 Agent 日志显示乱码，可设置为 `"gbk"`（需要安装 `iconv-lite`）。
- **logging.level**：BCNC 日志级别，会自动同步到 Agent，控制 Agent 的日志输出详细程度。

### 3.2 调整自动注入

- **自定义延迟**：修改 `Script/index.js` 中 `setTimeout`。
- **重试机制**：实现 `injectWithRetry`，控制最大次数与间隔。
- **条件注入**：插件监听 `server:ready`，依据环境变量或其他条件调用命令。

### 3.3 日志级别管理

BCNC 支持动态调整日志级别，并会自动同步到 Agent：

- **配置日志级别**：在 `config.yml` 中设置 `logging.level`（`debug`、`info`、`warn`、`error`）
- **Agent 同步**：BCNC 启动时会自动将日志级别同步到 Agent
- **运行时调整**：通过修改配置并执行 `!config reload`，或直接修改 `config.yml` 后重启

Agent 日志级别说明：
- **TRACE**：最详细的日志（通常不使用）
- **DEBUG**：调试信息，包括方法调用、类加载等
- **INFO**：一般信息，如连接成功、规则注册等
- **WARN**：警告信息
- **ERROR**：错误信息

默认情况下，Agent 的大部分内部日志使用 `DEBUG` 级别，只有在 BCNC 日志级别为 `debug` 时才会显示。

## 4. 通信协议

### 4.1 Agent → Node.js

```json
{
  "type": "CHAT_INTERCEPTED",
  "data": "ruleId|message|playerName"
}
```

- `type`：事件类型。
- `data`：以 `|` 分隔的规则 ID、消息内容、玩家名。

### 4.2 Node.js → Agent

```json
{ "type": "REGISTER_RULE", "data": "id|pattern|matchType" }
{ "type": "UNREGISTER_RULE", "data": "ruleId" }
{ "type": "LIST_RULES", "data": "" }
{ "type": "CLEAR_RULES", "data": "" }
```

- `matchType`：`prefix` / `contains` / `regex`。
- Agent 端匹配后，将触发事件或调用 handler。

## 5. 拦截规则 API

### 5.1 快捷方法

| 方法 | 说明 |
| --- | --- |
| `onCommand(prefix, handler)` | 拦截指定前缀命令，`handler(command, playerName)` |
| `onKeyword(keyword, handler)` | 针对包含关键词的消息触发 |
| `onRegex(pattern, id, handler)` | 通过正则匹配消息 |

### 5.2 `registerRule` 参数

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 规则唯一标识 |
| `pattern` | string | 匹配模式或正则 |
| `matchType` | `prefix` / `contains` / `regex` | 匹配方式 |
| `handler` | function | 处理函数，接收 `{ message, playerName, ruleId }` |

### 5.3 规则管理

```javascript
interceptor.registerRule({...});
interceptor.unregisterRule('rule-id');
interceptor.clearRules();
const rules = interceptor.listRules();
```

## 6. 权限系统

### 6.1 权限级别

BCNC 使用 4 级权限系统（1-4，数字越大权限越高）：

- **级别 1**：默认玩家权限
- **级别 2-3**：中等权限，可执行部分管理命令
- **级别 4**：最高权限，CLI 默认拥有，可执行所有 BCNC 系统命令

### 6.2 权限配置

权限配置位于 `config/permissions.yml`：

```yaml
defaultLevel: 1  # 默认权限级别
4:              # 4 级权限玩家列表
  - AdminPlayer
3:              # 3 级权限玩家列表
  - Moderator1
  - Moderator2
2:              # 2 级权限玩家列表
  - TrustedPlayer
1:              # 1 级权限玩家列表（通常为空，使用默认级别）
  - []
```

### 6.3 权限命令

| 命令 | 功能 | 示例 |
| --- | --- | --- |
| `!perm list` | 列出所有玩家权限设置 | 显示默认级别和所有自定义权限 |
| `!perm set <玩家> <级别>` | 设置玩家权限级别 | `!perm set PlayerName 3` |
| `!perm get <玩家>` | 查询玩家权限级别 | `!perm get PlayerName` |
| `!perm remove <玩家>` | 移除玩家自定义权限 | `!perm remove PlayerName` |
| `!perm default <级别>` | 设置默认权限级别 | `!perm default 1` |

### 6.4 插件中的权限

插件注册命令时可指定 `permissionLevel`：

```javascript
ctx.registerCommand('admin', {
  permissionLevel: 3,  // 需要 3 级或以上权限
  denyMessage: '你没有权限执行此命令',
  handler: async (args, context) => {
    // 处理逻辑
  }
});
```

## 7. 常见问题与排查

| 问题 | 现象 | 解决方案 |
| --- | --- | --- |
| `JAVA_HOME` 未设置 | `agent compile` 失败 | 将 `JAVA_HOME` 指向 JDK，如 `C:\Program Files\Java\jdk-21` |
| 缺少 `tools.jar` | Attach 时报错 | 使用完整 JDK，确认 `$JAVA_HOME/lib/tools.jar` 存在 |
| 未找到 Minecraft 进程 | `inject` 输出"未找到" | 确保服务器已启动；手动指定 PID；延长自动注入等待 |
| Agent 无法连接 | 日志出现 `[BCNC Agent] 无法连接` | 检查端口占用、防火墙、Node.js 端 Socket 是否运行 |
| 自动注入失败 | 日志提示 `Agent 管理器未初始化` | 确认 BCNC 版本；检查 `Script/agent/` 目录；重启 BCNC |
| Agent 日志乱码 | Windows 下中文显示为乱码 | 在 `config.yml` 中设置 `server.encoding: "gbk"`，并确保已安装 `iconv-lite` |
| 权限系统未生效 | 命令权限检查失败 | 检查 `config/permissions.yml` 是否存在且格式正确；使用 `!perm list` 查看当前配置 |

## 8. 服务器输出处理

### 8.1 日志解析器（Handler）

BCNC 支持多种服务器类型的日志解析：

- **vanilla**：原版 Minecraft 服务器
- **forge**：Forge 服务器（支持 Mod 加载器）
- **paper**：Paper 服务器（优化版 Spigot）

在 `config.yml` 中配置：

```yaml
server:
  handler: "paper"  # 根据服务器类型选择
```

### 8.2 编码配置

Windows 系统下，如果 Agent 日志显示乱码，可配置编码：

```yaml
server:
  encoding: "gbk"  # 或 "utf-8"
```

**注意**：使用 `gbk` 编码需要安装 `iconv-lite` 依赖：

```bash
cd Script
npm install iconv-lite
```

### 8.3 Agent 日志过滤

BCNC 会自动过滤 `[BCNC Agent]` 前缀的日志，将其重定向到 BCNC 的内部日志系统，不会出现在服务器输出中。

## 9. JVM & Agent 技术细节

- **Java Agent**：实现 `agentmain`，通过 `java.lang.instrument.Instrumentation` 操作类。
- **ASM/字节码**：注入聊天处理方法，调用自定义逻辑。
- **Attach API**：利用 `com.sun.tools.attach.VirtualMachine` 将 Agent 附加到运行中的 JVM。
- **Socket 通信**：TCP + JSON，支持多条指令与事件。
- **安全性**：Agent 能访问完整 JVM，需确保注入代码可信；若在生产环境启用，应限制命令来源。

## 10. 日志参考

```
[INFO] Agent JAR 文件不存在，正在编译...
[注入] 自动发现Minecraft服务器进程: PID=12345
[注入] Agent已成功注入!
[BCNC Agent] 已连接到Node.js服务器
```

- 自动注入流程可参考 `AUTO_INJECT_EXAMPLE.md` 的完整时间线。
- 若需要更详细的调试，可提升日志级别或在插件中监听 `server:line`。

## 11. 扩展指南

1. **新增拦截类型**：在 Agent 端添加新的 Transformer，并在 Node.js 端沿用 `registerRule` 模式。
2. **命令桥接**：通过 `interceptor.onCommand` 将游戏内命令转发到 Node.js 命令处理器。
3. **检测/反作弊**：结合 `onRegex`、`registerRule` 与插件内逻辑，实现敏感词、IP、作弊检测。
4. **监控指标**：使用 `!agent info`、`!agent classes` 联合插件统计，输出至日志或仪表盘。

## 12. 推荐操作清单

- 启动前：确认 `JAVA_HOME`、端口、服务器目录。
- 首次注入：执行 `!agent compile`，确保构建成功。
- 自动注入：启用 `agent.autoInject` 并观察 `server:ready` 后日志。
- 拦截调试：先注册简单规则（如命令前缀），再扩展到复杂场景。
- 故障时：查看 `agent status`、`agent ping`、服务器 stdout/stderr，与 Node.js 日志比对。

---

若需了解平台架构与使用场景，请参阅《BCNC 基础说明与架构概览》；插件能力、事件与上下文请参考《BCNC 插件与 API 参考》。

