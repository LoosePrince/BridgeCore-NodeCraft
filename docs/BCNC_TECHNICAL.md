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
```

- **autoInject**：默认关闭；启用后监听 `server:ready` 并延迟（默认 1 秒）调用 `agentManager.inject('auto')`。
- **port**：确保未被占用；Agent 与 Node.js 必须一致。

### 3.2 调整自动注入

- **自定义延迟**：修改 `Script/index.js` 中 `setTimeout`。
- **重试机制**：实现 `injectWithRetry`，控制最大次数与间隔。
- **条件注入**：插件监听 `server:ready`，依据环境变量或其他条件调用命令。

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

## 6. 常见问题与排查

| 问题 | 现象 | 解决方案 |
| --- | --- | --- |
| `JAVA_HOME` 未设置 | `agent compile` 失败 | 将 `JAVA_HOME` 指向 JDK，如 `C:\Program Files\Java\jdk-21` |
| 缺少 `tools.jar` | Attach 时报错 | 使用完整 JDK，确认 `$JAVA_HOME/lib/tools.jar` 存在 |
| 未找到 Minecraft 进程 | `inject` 输出“未找到” | 确保服务器已启动；手动指定 PID；延长自动注入等待 |
| Agent 无法连接 | 日志出现 `[BCNC Agent] 无法连接` | 检查端口占用、防火墙、Node.js 端 Socket 是否运行 |
| 自动注入失败 | 日志提示 `Agent 管理器未初始化` | 确认 BCNC 版本；检查 `Script/agent/` 目录；重启 BCNC |

## 7. JVM & Agent 技术细节

- **Java Agent**：实现 `agentmain`，通过 `java.lang.instrument.Instrumentation` 操作类。
- **ASM/字节码**：注入聊天处理方法，调用自定义逻辑。
- **Attach API**：利用 `com.sun.tools.attach.VirtualMachine` 将 Agent 附加到运行中的 JVM。
- **Socket 通信**：TCP + JSON，支持多条指令与事件。
- **安全性**：Agent 能访问完整 JVM，需确保注入代码可信；若在生产环境启用，应限制命令来源。

## 8. 日志参考

```
[INFO] Agent JAR 文件不存在，正在编译...
[注入] 自动发现Minecraft服务器进程: PID=12345
[注入] Agent已成功注入!
[BCNC Agent] 已连接到Node.js服务器
```

- 自动注入流程可参考 `AUTO_INJECT_EXAMPLE.md` 的完整时间线。
- 若需要更详细的调试，可提升日志级别或在插件中监听 `server:line`。

## 9. 扩展指南

1. **新增拦截类型**：在 Agent 端添加新的 Transformer，并在 Node.js 端沿用 `registerRule` 模式。
2. **命令桥接**：通过 `interceptor.onCommand` 将游戏内命令转发到 Node.js 命令处理器。
3. **检测/反作弊**：结合 `onRegex`、`registerRule` 与插件内逻辑，实现敏感词、IP、作弊检测。
4. **监控指标**：使用 `!agent info`、`!agent classes` 联合插件统计，输出至日志或仪表盘。

## 10. 推荐操作清单

- 启动前：确认 `JAVA_HOME`、端口、服务器目录。
- 首次注入：执行 `!agent compile`，确保构建成功。
- 自动注入：启用 `agent.autoInject` 并观察 `server:ready` 后日志。
- 拦截调试：先注册简单规则（如命令前缀），再扩展到复杂场景。
- 故障时：查看 `agent status`、`agent ping`、服务器 stdout/stderr，与 Node.js 日志比对。

---

若需了解平台架构与使用场景，请参阅《BCNC 基础说明与架构概览》；插件能力、事件与上下文请参考《BCNC 插件与 API 参考》。

