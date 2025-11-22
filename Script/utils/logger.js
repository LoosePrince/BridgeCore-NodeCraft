import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import chalk from 'chalk';
import AdmZip from 'adm-zip';

const LEVEL_PRIORITY = {
  'debug': 0,
  'info': 1,
  'warn': 2,
  'error': 3
};

/**
 * 格式化时间戳（使用本地时间）
 * @returns {string} 格式化的时间戳 (YYYY-MM-DD HH:mm:ss)
 */
function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function injectDateIntoMinecraftTimestamp(line) {
  if (!line || /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(line)) {
    return line;
  }
  
  // 匹配 Paper 格式: [HH:mm:ss INFO]: 或 [HH:mm:ss WARN]: 等
  const paperMatch = line.match(/\[(\d{2}:\d{2}:\d{2})\s+(INFO|WARN|ERROR|DEBUG)\]:/);
  if (paperMatch) {
    const date = formatCurrentDate();
    const target = paperMatch[0];
    return line.replace(target, `[${date} ${paperMatch[1]}] [${paperMatch[2]}]`);
  }
  
  // 匹配原版/Forge 格式: [HH:mm:ss] 或 [HH:mm:ss] [Thread/INFO]:
  const vanillaMatch = line.match(/\[(\d{2}:\d{2}:\d{2})\]/);
  if (vanillaMatch) {
  const date = formatCurrentDate();
    const target = vanillaMatch[0];
    return line.replace(target, `[${date} ${vanillaMatch[1]}]`);
  }
  
  return line;
}

/**
 * 格式化时间戳用于文件名（使用本地时间）
 * @returns {string} 格式化的时间戳 (YYYY-MM-DD_HH:mm:ss)
 */
function formatTimestampForFilename() {
  return formatTimestampForFilenameFromDate(new Date());
}

/**
 * 从指定日期格式化时间戳用于文件名
 * @param {Date} date - 日期对象
 * @returns {string} 格式化的时间戳 (YYYY-MM-DD_HH-mm-ss)
 */
function formatTimestampForFilenameFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * 日志输出类
 */
export class Logger {
  constructor(config, projectRoot) {
    this.projectRoot = projectRoot;
    this.logStream = null;
    this.debugLogStream = null;
    this.config = null;
    this.subscribers = new Set();
    this.applyConfig(config.logging);
  }

  /**
   * 确保日志目录存在
   * @param {string} logPath - 日志文件路径
   */
  ensureLogDirectory(logPath) {
    const logDir = dirname(logPath);
    if (!existsSync(logDir)) {
      try {
        mkdirSync(logDir, { recursive: true });
        if (!existsSync(logDir)) {
          this.error(`无法创建日志目录: ${logDir}`);
        }
      } catch (error) {
        this.error(chalk.red(`[日志] 创建日志目录失败: ${error.message}`));
      }
    }
  }

  applyConfig(loggingConfig) {
    if (!loggingConfig) {
      return;
    }

    const needReopenStream = !this.config ||
      this.config.saveToFile !== loggingConfig.saveToFile ||
      this.config.logFile !== loggingConfig.logFile;

    if (needReopenStream && this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    // 关闭并重新创建 debug.log（每次启动覆盖）
    if (this.debugLogStream) {
      this.debugLogStream.end();
      this.debugLogStream = null;
    }

    this.config = loggingConfig;

    // 创建 debug.log 文件（每次启动覆盖，包含所有日志）
    const debugLogPath = join(this.projectRoot, 'logs', 'debug.log');
    this.ensureLogDirectory(debugLogPath);
    try {
      this.debugLogStream = createWriteStream(debugLogPath, { flags: 'w' });
      this.debugLogStream.on('error', (error) => {
        this.error(`[日志] 写入 debug.log 失败: ${error.message}`);
      });
    } catch (error) {
      this.error(`[日志] 创建 debug.log 失败: ${error.message}`);
    }

    if (this.config.saveToFile) {
      const originalLogPath = join(this.projectRoot, this.config.logFile);
      this.ensureLogDirectory(originalLogPath);
      
      // 获取当前启动时间戳（用于压缩包和新日志文件）
      const timestamp = formatTimestampForFilename();
      const logDir = dirname(originalLogPath);
      
      // 压缩所有旧的日志文件（每个日志文件使用自己的文件名作为压缩包名称）
      try {
        // 查找所有需要压缩的日志文件
        const logFilesToCompress = [];
        
        // 检查是否存在 server.log
        if (existsSync(originalLogPath)) {
          logFilesToCompress.push(basename(originalLogPath));
        }
        
        // 查找并添加所有时间戳格式的旧日志文件（格式：YYYY-MM-DD_HH-mm-ss.log）
        const timestampPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/;
        if (existsSync(logDir)) {
          const files = readdirSync(logDir);
          const timestampLogFiles = files.filter(file => 
            file.endsWith('.log') && 
            timestampPattern.test(file) && 
            file !== `${timestamp}.log` // 排除当前要创建的新日志文件
          );
          logFilesToCompress.push(...timestampLogFiles);
        }
        
        // 为每个日志文件创建对应的压缩包
        for (const logFile of logFilesToCompress) {
          try {
            const logFilePath = join(logDir, logFile);
            const logFileName = basename(logFile, '.log');
            const zipPath = join(logDir, `${logFileName}.zip`);
            
            // 如果压缩包已存在，跳过（避免重复压缩）
            if (existsSync(zipPath)) {
              this.debug(`[日志轮转] 压缩包已存在，跳过: ${basename(zipPath)}`);
              continue;
            }
            
            const zip = new AdmZip();
            zip.addFile(logFile, readFileSync(logFilePath));
            zip.writeZip(zipPath);
            unlinkSync(logFilePath);
            
            this.debug(`[日志轮转] 已压缩: ${logFile} -> ${basename(zipPath)}`);
          } catch (error) {
            this.error(`[日志轮转] 压缩 ${logFile} 失败: ${error.message}`);
          }
        }
      } catch (error) {
        this.error(`[日志轮转] 压缩旧日志文件失败: ${error.message}`);
      }
      
      // 创建新的日志文件，使用当前启动时间戳命名
      const newLogPath = join(logDir, `${timestamp}.log`);
      // 再次确保目录存在（防止目录创建失败）
      this.ensureLogDirectory(newLogPath);
      
      try {
        this.logStream = createWriteStream(newLogPath, { flags: 'w' });
        // 监听错误事件
        this.logStream.on('error', (error) => {
          this.error(`[日志] 写入日志文件失败: ${error.message}`);
        });
      } catch (error) {
        this.error(`[日志] 创建日志文件失败: ${error.message}`);
      }
      
      // 更新配置中的日志文件路径（用于后续引用）
      this.config.logFile = join(logDir, `${timestamp}.log`).replace(this.projectRoot + '/', './').replace(this.projectRoot + '\\', '.\\');
    }
  }

  /**
   * 判断是否应该输出该级别日志
   */
  shouldLog(level) {
    const currentLevel = this.config?.level || 'info';
    const currentPriority = LEVEL_PRIORITY[currentLevel] ?? LEVEL_PRIORITY.info;
    const messagePriority = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;
    return messagePriority >= currentPriority;
  }

  write(level, message) {
    const normalizedLevel = level.toLowerCase();
    
    const timestamp = this.config.showTimestamp ? `[${formatTimestamp()}] ` : '';
    const prefix = {
      'debug': chalk.gray('DEBUG'),
      'info': chalk.blue('INFO'),
      'warn': chalk.yellow('WARN'),
      'error': chalk.red('ERROR')
    }[normalizedLevel] || chalk.blue('INFO');

    const output = `${timestamp}[${prefix}] ${message}`;
    const plainOutput = output.replace(/\u001b\[[0-9;]*m/g, '');
    
    // 写入 debug.log（包含所有日志，不受日志级别限制）
    if (this.debugLogStream) {
      this.debugLogStream.write(plainOutput + '\n');
    }
    
    // 检查是否应该输出该级别日志（控制台和普通日志文件）
    if (!this.shouldLog(normalizedLevel)) {
      return;
    }
    
    if (this.config.consoleOutput) {
      if (this.config.coloredOutput) {
        console.log(output);
      } else {
        console.log(plainOutput);
      }
    }

    if (this.logStream) {
      this.logStream.write(plainOutput + '\n');
    }

    if (this.subscribers.size > 0) {
      const entry = { level: normalizedLevel, message, timestamp: new Date() };
      this.subscribers.forEach(listener => {
        try {
          listener(entry);
        } catch (error) {
          // 忽略监听器错误
        }
      });
    }
  }

  log(message) {
    this.write('info', message);
  }

  info(message) {
    this.write('info', message);
  }

  debug(message) {
    this.write('debug', message);
  }

  warn(message) {
    this.write('warn', message);
  }

  error(message) {
    this.write('error', message);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /**
   * 更新日志级别
   * @param {string} level - 新日志级别
   */
  setLevel(level) {
    if (!LEVEL_PRIORITY.hasOwnProperty(level)) {
      this.error(`无法设置日志级别: 不支持的级别 ${level}`);
      return;
    }
    this.config.level = level;
  }

  getLevel() {
    return this.config?.level || 'info';
  }

  /**
   * 更新日志配置（用于热重载）
   * @param {Object} loggingConfig - 最新日志配置
   */
  updateConfig(loggingConfig) {
    this.applyConfig(loggingConfig);
  }

  /**
   * 记录服务器输出
   * @param {string} line - 服务器输出行
   */
  serverOutput(line) {
    const normalizedLine = injectDateIntoMinecraftTimestamp(line);
    if (this.config.consoleOutput) {
      if (this.config.coloredOutput) {
        console.log(chalk.gray(normalizedLine));
      } else {
        console.log(normalizedLine);
      }
    }

    if (this.logStream) {
      this.logStream.write(`[SERVER] ${normalizedLine}\n`);
    }

    // 写入 debug.log（包含所有服务器输出）
    if (this.debugLogStream) {
      this.debugLogStream.write(`[SERVER] ${normalizedLine}\n`);
    }
  }

  /**
   * 关闭日志流
   */
  close() {
    if (this.logStream) {
      this.logStream.end();
    }
    if (this.debugLogStream) {
      this.debugLogStream.end();
    }
  }
}

