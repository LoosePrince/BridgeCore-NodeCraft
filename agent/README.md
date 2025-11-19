# BCNC Java Agent 注入系统

## 概述

BCNC Java Agent 注入系统允许在**不重启服务器**的情况下，将代码动态注入到运行中的 Minecraft 服务器 JVM 中。

这是一个基于 Java Agent 技术的深层注入方案，可以实现：
- ✅ 运行时注入代码到 JVM
- ✅ 与 Node.js 双向通信
- ✅ 访问服务器内部状态
- ✅ 无需重启服务器
- ✅ 原版服务器支持（不需要 Fabric/Forge）

## 架构

```
┌─────────────────────────────────────┐
│      BridgeCore-NodeCraft           │
│  ┌────────────────────────────┐     │
│  │   Agent Manager (Node.js)  │     │
│  │  - Injector (编译&注入)    │     │
│  │  - Communicator (通信)     │     │
│  └──────────┬─────────────────┘     │
│             │ Socket                │
└─────────────┼─────────────────────────┘
              │
┌─────────────▼─────────────────────────┐
│      Minecraft Server JVM             │
│  ┌────────────────────────────────┐   │
│  │     BCNC Agent (Java)          │   │
│  │  - agentmain 入口              │   │
│  │  - Socket 通信                 │   │
│  │  - 命令执行                    │   │
│  └────────────────────────────────┘   │
│         Minecraft Server               │
└────────────────────────────────────────┘
```

## 目录结构

```
agent/
├── src/                    # Java 源代码
│   ├── BCNCAgent.java      # Agent 主类
│   ├── BCNCAttacher.java   # 注入器
│   └── MANIFEST.MF         # Agent 清单文件
├── dist/                   # 编译输出（自动生成）
│   ├── bcnc-agent.jar      # Agent JAR
│   └── bcnc-attacher.jar   # 注入器 JAR
├── build/                  # 编译临时文件（自动生成）
├── build.bat               # Windows 编译脚本
├── build.sh                # Linux/Mac 编译脚本
└── README.md               # 本文档
```

## 使用方法

### 1. 前提条件

- **JAVA_HOME 环境变量**必须设置并指向 JDK（不是 JRE）
- JDK 版本建议 8 或更高
- 确保 `$JAVA_HOME/lib/tools.jar` 存在

检查方法：
```bash
# Windows
echo %JAVA_HOME%

# Linux/Mac
echo $JAVA_HOME
```

### 2. 自动编译和注入

系统会在首次注入时自动编译 Agent，无需手动操作：

```bash
# 在 BCNC 控制台中执行
!agent inject

# 或指定进程 ID
!agent inject 12345
```

### 3. 手动编译（可选）

如果需要手动编译：

```bash
# Windows
cd agent
build.bat

# Linux/Mac
cd agent
chmod +x build.sh
./build.sh
```

### 4. 可用命令

在 BCNC 控制台中：

| 命令 | 说明 |
|------|------|
| `!agent inject [pid]` | 注入 Agent 到服务器（pid 可选，默认自动查找） |
| `!agent compile` | 手动编译 Agent JAR 文件 |
| `!agent status` | 查看 Agent 状态 |
| `!agent ping` | Ping Agent 测试连接 |
| `!agent info` | 获取服务器 JVM 信息 |
| `!agent classes` | 获取已加载的类数量 |
| `!agent shutdown` | 关闭 Agent 连接 |

### 5. 使用示例

```bash
# 1. 启动 Minecraft 服务器
npm start

# 2. 在 BCNC 控制台中注入 Agent
!agent inject

# 输出示例：
# [BCNC] 正在注入 Agent 到进程 auto...
# [编译] 开始编译 Agent...
# [编译] [1/4] 编译 BCNCAgent.java...
# [编译] [2/4] 编译 BCNCAttacher.java...
# [编译] [3/4] 打包 bcnc-agent.jar...
# [编译] [4/4] 打包 bcnc-attacher.jar...
# [编译] [成功] 编译完成!
# [注入] 自动发现Minecraft服务器进程: PID=12345
# [注入] 正在附加Agent到进程 12345...
# [注入] 已连接到JVM
# [注入] Agent已成功注入!
# [注入] 已从JVM断开连接
# [BCNC] Agent 注入成功！
# [BCNC] Agent 已连接
# [BCNC] Agent 就绪: Agent已就绪
# [BCNC] 服务器信息: Loaded Classes: 8234, Retransform Capable: true, Redefine Capable: true

# 3. 测试 Agent
!agent ping
# [BCNC] 发送 Ping 到 Agent...
# [BCNC] Agent存活

# 4. 获取 JVM 信息
!agent info
# [BCNC] 请求 JVM 信息...
# [BCNC] JVM 信息: Java: 21.0.1, Memory: 4096MB / 16384MB, Processors: 16

# 5. 获取类信息
!agent classes
# [BCNC] 请求类信息...
# [BCNC] 已加载类数量: 8234

# 6. 查看状态
!agent status
# === Agent 状态 ===
# 已注入: 是
# 已连接: 是
# 通信端口: 25575
# Agent JAR: D:\path\to\BridgeCore-NodeCraft\agent\dist\bcnc-agent.jar
# Attacher JAR: D:\path\to\BridgeCore-NodeCraft\agent\dist\bcnc-attacher.jar
```

## 通信协议

Agent 与 Node.js 之间通过 Socket 进行 JSON 消息通信：

### 消息格式

```json
{
  "type": "消息类型",
  "data": "消息数据"
}
```

### Node.js -> Agent 消息类型

| 类型 | 说明 | 响应 |
|------|------|------|
| `PING` | 测试连接 | `PONG` |
| `GET_CLASSES` | 获取已加载类数量 | `CLASSES_COUNT` |
| `GET_JVM_INFO` | 获取 JVM 信息 | `JVM_INFO` |
| `EXECUTE` | 执行代码（预留） | `EXECUTE_RESULT` |
| `SHUTDOWN` | 关闭 Agent | `SHUTDOWN_ACK` |

### Agent -> Node.js 消息类型

| 类型 | 说明 |
|------|------|
| `AGENT_READY` | Agent 就绪 |
| `SERVER_INFO` | 服务器信息 |
| `PONG` | Ping 响应 |
| `CLASSES_COUNT` | 类数量 |
| `JVM_INFO` | JVM 信息 |
| `EXECUTE_RESULT` | 执行结果 |
| `ERROR` | 错误信息 |
| `UNKNOWN_COMMAND` | 未知命令 |

## 配置

在 `config.yml` 中添加 Agent 配置（可选）：

```yaml
# Agent 配置
agent:
  # 通信端口
  port: 25575
```

## 扩展开发

### 在 Agent 中添加新功能

编辑 `agent/src/BCNCAgent.java`：

```java
case "YOUR_COMMAND":
    // 你的代码
    String result = yourFunction();
    sendMessage("YOUR_RESPONSE", result);
    break;
```

### 在 Node.js 中调用

编辑 `Script/agent/communicator.js`：

```javascript
// 添加新方法
yourCommand(data) {
  return this.sendMessage('YOUR_COMMAND', data);
}

// 添加事件处理
case 'YOUR_RESPONSE':
  this.emit('yourResponse', data.data);
  break;
```

## 常见问题

### Q1: 编译失败：JAVA_HOME 未设置

**A:** 确保设置了 JAVA_HOME 环境变量：

```bash
# Windows
set JAVA_HOME=C:\Program Files\Java\jdk-21

# Linux/Mac
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk
```

### Q2: 编译失败：找不到 tools.jar

**A:** 确保使用的是 **JDK** 而不是 JRE。JDK 包含 `lib/tools.jar`，JRE 不包含。

### Q3: 注入失败：找不到 Minecraft 进程

**A:** 尝试手动指定进程 ID：

```bash
# 1. 找到进程 ID（Windows）
tasklist | findstr java

# 2. 找到进程 ID（Linux/Mac）
ps aux | grep java

# 3. 使用进程 ID 注入
!agent inject 12345
```

### Q4: Agent 无法连接

**A:** 检查：
1. 端口 25575 是否被占用
2. 防火墙是否阻止
3. 查看 Minecraft 服务器日志中是否有 `[BCNC Agent]` 相关输出

### Q5: 支持哪些 Minecraft 版本？

**A:** 理论上支持所有使用 JVM 的 Minecraft 服务器：
- ✅ 原版服务器
- ✅ Fabric
- ✅ Forge
- ✅ Paper/Spigot/Bukkit
- ✅ 其他基于 JVM 的服务器

## 技术原理

### Java Agent 技术

Java Agent 是 JVM 提供的一种机制，允许在 JVM 启动时或运行时加载代理程序。

### Attach API

使用 `com.sun.tools.attach.VirtualMachine` API 可以：
1. 附加到运行中的 JVM 进程
2. 加载 Agent JAR
3. 执行 Agent 代码

### 字节码操作（未来）

Agent 可以使用 `Instrumentation` API 进行：
- 类重定义（Redefine）
- 类转换（Retransform）
- 添加/修改方法
- Hook 方法调用

## 安全警告

⚠️ **注意：** Agent 具有完全的 JVM 访问权限，请只注入可信的代码！

## 参考资料

- [Java Agent 官方文档](https://docs.oracle.com/javase/8/docs/api/java/lang/instrument/package-summary.html)
- [Attach API 文档](https://docs.oracle.com/javase/8/docs/jdk/api/attach/spec/com/sun/tools/attach/package-summary.html)
- [参考博客](https://blog.csdn.net/qq_44876089/article/details/128279875)

## 未来计划

- [ ] 字节码操作支持
- [ ] 命令注册到游戏中
- [ ] 事件监听系统
- [ ] 热更新支持
- [ ] GUI 管理界面

## 许可证

MIT License

---

**Powered by BridgeCore-NodeCraft**

