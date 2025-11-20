# BridgeCore-NodeCraft

> 桥接核心 - Node技艺

使用 Node.js 运行和管理 Minecraft 服务器，并通过 Java Agent 和 ASM 注入到服务器进程中实现更深入的功能

## 特别说明

本项目为构想验证性项目，请勿用于生产级环境。

## 安装

1. 确保已安装 Node.js (推荐 v18 或更高版本)

2. 进入 Script 目录并安装依赖：
```bash
cd Script
npm install
cd ..
```

## 使用方法

### 配置

复制 config.yml.example 并重命名为 config.yml，根据需要修改配置。

```bash
cp config.yml.example config.yml
```

### 启动服务器

**方式一：使用启动脚本（推荐）**
```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

**方式二：手动进入 Script 目录**
```bash
cd Script
npm start
```

### 停止服务器

- 在交互式命令行中输入 `!stop` 或 `!exit`
- 或按 `Ctrl+C` 发送中断信号

## 支持列表

> 仅在以下版本中测试，理论可用其他版本

- 1.21.10
- 1.21.10 - Forge
- 1.21.10 - Paper
- 1.21.8 - Leaves
- 1.21
- 1.21 - Fabric
- 1.16.5

## 文档

详细的文档和 API 参考请查看 `docs/` 目录：

- **[BCNC 基础说明与架构概览](docs/BCNC_FOUNDATION.md)** - 系统定位、关键特性、架构概览和使用场景
- **[BCNC 技术性说明](docs/BCNC_TECHNICAL.md)** - Agent 注入、配置、通信协议、权限系统和故障排除
- **[BCNC 插件与 API 参考](docs/BCNC_PLUGIN_REFERENCE.md)** - 插件开发指南、上下文 API、事件系统和编写规范

## 许可证

Apache License