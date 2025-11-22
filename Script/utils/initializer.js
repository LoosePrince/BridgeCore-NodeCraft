import { join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import chalk from 'chalk';

/**
 * 初始化项目结构（创建必要的文件和文件夹）
 * @param {string} projectRoot - 项目根目录
 * @returns {boolean} 是否创建了新的 config.yml 文件
 */
export function initializeProject(projectRoot) {
  let configCreated = false;
  
  // 1. 检查并创建 config.yml
  const configPath = join(projectRoot, 'config.yml');
  if (!existsSync(configPath)) {
    try {
      const examplePath = join(projectRoot, 'config.yml.example');
      let configContent;
      
      if (existsSync(examplePath)) {
        // 如果存在示例文件，复制它
        configContent = readFileSync(examplePath, 'utf8');
      } else {
        // 否则使用默认配置
        configContent = getDefaultConfig();
      }
      
      writeFileSync(configPath, configContent, 'utf8');
      console.log(chalk.green('✓ 已创建 config.yml 文件'));
      configCreated = true;
    } catch (error) {
      console.error(chalk.red('✗ 创建 config.yml 失败:'), error.message);
    }
  }

  // 2. 检查并创建 server 文件夹
  const serverDir = join(projectRoot, 'server');
  if (!existsSync(serverDir)) {
    try {
      mkdirSync(serverDir, { recursive: true });
      console.log(chalk.green('✓ 已创建 server 文件夹'));
    } catch (error) {
      console.error(chalk.red('✗ 创建 server 文件夹失败:'), error.message);
    }
  }

  // 3. 检查并创建 plugins 文件夹
  const pluginsDir = join(projectRoot, 'plugins');
  if (!existsSync(pluginsDir)) {
    try {
      mkdirSync(pluginsDir, { recursive: true });
      console.log(chalk.green('✓ 已创建 plugins 文件夹'));
    } catch (error) {
      console.error(chalk.red('✗ 创建 plugins 文件夹失败:'), error.message);
    }
  }

  // 4. 检查并创建 start.bat（Windows）
  const startBatPath = join(projectRoot, 'start.bat');
  if (!existsSync(startBatPath)) {
    try {
      const startBatContent = getStartBatContent();
      writeFileSync(startBatPath, startBatContent, 'utf8');
      console.log(chalk.green('✓ 已创建 start.bat 文件'));
    } catch (error) {
      console.error(chalk.red('✗ 创建 start.bat 失败:'), error.message);
    }
  }

  // 5. 检查并创建 start.sh（Linux/Mac）
  const startShPath = join(projectRoot, 'start.sh');
  if (!existsSync(startShPath)) {
    try {
      const startShContent = getStartShContent();
      writeFileSync(startShPath, startShContent, 'utf8');
      // 在 Unix 系统上设置执行权限
      try {
        chmodSync(startShPath, 0o755);
      } catch {
        // 如果 chmod 失败（如 Windows），忽略
      }
      console.log(chalk.green('✓ 已创建 start.sh 文件'));
    } catch (error) {
      console.error(chalk.red('✗ 创建 start.sh 失败:'), error.message);
    }
  }
  
  return configCreated;
}

/**
 * 获取默认配置文件内容
 * @returns {string} 默认配置内容
 */
function getDefaultConfig() {
  return `# BridgeCore-NodeCraft 配置文件

# 服务器配置
server:
  # 服务器目录路径（相对于项目根目录或绝对路径）
  directory: "./server"
  
  # 服务器启动命令
  # 示例
  # "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe" -Xmx16G -jar server.jar nogui
  # "C:\\Windows\\System32\\cmd.exe" /c run.bat
  startCommand: ''
  
  # 日志解析 handler
  # 可选值: "vanilla", "forge", "paper"
  handler: "vanilla"
  
  # 服务器输出编码
  # 可选值: "utf-8", "gbk"
  # Windows 系统如果中文显示乱码，可以尝试使用 "gbk"
  encoding: "utf-8"

# 日志配置
logging:
  # 是否在控制台显示服务器输出
  consoleOutput: true
  
  # 是否保存日志到文件
  saveToFile: true
  
  # 日志文件路径（相对于项目根目录）
  logFile: "./logs/server.log"
  
  # 日志级别: "debug", "info", "warn", "error"
  level: "info"
  
  # 是否显示时间戳
  showTimestamp: true
  
  # 是否显示颜色输出
  coloredOutput: true

# 自动重启配置
autoRestart:
  # 是否启用自动重启
  enabled: false
  
  # 服务器崩溃后等待多少秒再重启（秒）
  delay: 10
  
  # 最大重启次数（0 表示无限制）
  maxRestarts: 3

# 命令配置
commands:
  # 是否启用交互式命令输入
  interactive: true
  
  # 命令前缀（用于区分系统命令和服务器命令）
  prefix: "!"

# Agent 注入配置
agent:
  # 是否在服务器启动完成后自动注入 Agent
  autoInject: true
  
  # 通信端口
  port: 25575

# RCON 配置（自动读取 server.properties）
rcon:
  enabled: true
`;
}

/**
 * 获取 start.bat 文件内容
 * @returns {string} start.bat 内容
 */
function getStartBatContent() {
  return `@echo off
cd Script
call npm start
cd ..
`;
}

/**
 * 获取 start.sh 文件内容
 * @returns {string} start.sh 内容
 */
function getStartShContent() {
  return `#!/bin/bash
cd Script
npm start
cd ..
`;
}

