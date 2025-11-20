import { spawn } from 'child_process';
import { existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';
import iconv from 'iconv-lite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = dirname(dirname(__dirname));

/**
 * Agent 注入管理器
 * 负责编译和注入 Java Agent
 */
export class AgentInjector {
  constructor(logger, config = null) {
    this.logger = logger;
    this.config = config;
    this.agentDir = join(projectRoot, 'agent');
    this.distDir = join(this.agentDir, 'dist');
    this.agentJar = join(this.distDir, 'bcnc-agent.jar');
    this.attacherJar = join(this.distDir, 'bcnc-attacher.jar');
  }

  /**
   * 确保 Agent 已编译
   * @returns {Promise<boolean>}
   */
  async ensureCompiled() {
    // 检查是否已存在编译文件
    if (existsSync(this.agentJar) && existsSync(this.attacherJar)) {
      this.logger.debug('Agent JAR 文件已存在');
      return true;
    }

    this.logger.info('Agent JAR 文件不存在，正在编译...');
    return await this.compile();
  }

  /**
   * 编译 Agent
   * @returns {Promise<boolean>}
   */
  async compile() {
    return new Promise((resolve, reject) => {
      const isWindows = platform() === 'win32';
      const buildScript = join(this.agentDir, isWindows ? 'build.bat' : 'build.sh');

      if (!existsSync(buildScript)) {
        reject(new Error(`编译脚本不存在: ${buildScript}`));
        return;
      }

      // Linux/Mac需要执行权限
      if (!isWindows) {
        try {
          chmodSync(buildScript, '755');
        } catch (err) {
          this.logger.warn(`设置执行权限失败: ${err.message}`);
        }
      }

      this.logger.info('开始编译 Agent...');

      const buildProcess = spawn(buildScript, [], {
        cwd: this.agentDir,
        shell: true,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      // 获取编码配置，默认为 utf-8
      const encoding = this.config?.server?.encoding || 'utf-8';
      const isGBK = encoding.toLowerCase() === 'gbk';

      // 设置编码（仅 UTF-8 支持 setEncoding）
      if (!isGBK && buildProcess.stdout.setEncoding) {
        buildProcess.stdout.setEncoding('utf8');
      }
      buildProcess.stdout.on('data', (data) => {
        let text;
        if (isGBK) {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          text = iconv.decode(buffer, 'gbk');
        } else {
          text = typeof data === 'string' ? data : data.toString('utf8');
        }
        const output = text;
        stdout += output;
        // 实时显示编译输出
        output.split('\n').forEach(line => {
          if (line.trim()) {
            this.logger.debug(`[编译] ${line.trim()}`);
          }
        });
      });

      // 设置编码（仅 UTF-8 支持 setEncoding）
      if (!isGBK && buildProcess.stderr.setEncoding) {
        buildProcess.stderr.setEncoding('utf8');
      }
      buildProcess.stderr.on('data', (data) => {
        let text;
        if (isGBK) {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          text = iconv.decode(buffer, 'gbk');
        } else {
          text = typeof data === 'string' ? data : data.toString('utf8');
        }
        stderr += text;
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          this.logger.info('Agent 编译成功');
          resolve(true);
        } else {
          const errorMsg = `Agent 编译失败 (退出码: ${code})`;
          this.logger.error(errorMsg);
          if (stderr) {
            this.logger.error(`错误输出: ${stderr}`);
          }
          reject(new Error(errorMsg));
        }
      });

      buildProcess.on('error', (err) => {
        this.logger.error(`编译进程错误: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 注入 Agent 到目标进程
   * @param {string|number} pid - 进程ID，或 'auto' 自动查找
   * @param {number} communicationPort - 通信端口
   * @returns {Promise<boolean>}
   */
  async inject(pid = 'auto', communicationPort = 25575) {
    // 确保已编译
    await this.ensureCompiled();

    return new Promise((resolve, reject) => {
      // 检测 JAVA_HOME
      const javaHome = process.env.JAVA_HOME;
      if (!javaHome) {
        reject(new Error('JAVA_HOME 环境变量未设置'));
        return;
      }

      const javaExe = platform() === 'win32' 
        ? join(javaHome, 'bin', 'java.exe')
        : join(javaHome, 'bin', 'java');

      if (!existsSync(javaExe)) {
        reject(new Error(`Java 可执行文件不存在: ${javaExe}`));
        return;
      }

      const toolsJar = join(javaHome, 'lib', 'tools.jar');
      
      this.logger.info(`正在注入 Agent 到进程 ${pid}...`);

      // 构建命令：java -cp attacher.jar:tools.jar BCNCAttacher <pid> <agent.jar> <args>
      const classpath = platform() === 'win32'
        ? `${this.attacherJar};${toolsJar}`
        : `${this.attacherJar}:${toolsJar}`;

      const args = [
        '-cp',
        classpath,
        'com.bridgecore.agent.BCNCAttacher',
        String(pid),
        this.agentJar,
        `port=${communicationPort}`
      ];

      this.logger.debug(`执行命令: ${javaExe} ${args.join(' ')}`);

      const attachProcess = spawn(javaExe, args, {
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      // 获取编码配置，默认为 utf-8
      const encoding = this.config?.server?.encoding || 'utf-8';
      const isGBK = encoding.toLowerCase() === 'gbk';

      // 设置编码（仅 UTF-8 支持 setEncoding）
      if (!isGBK && attachProcess.stdout.setEncoding) {
        attachProcess.stdout.setEncoding('utf8');
      }
      attachProcess.stdout.on('data', (data) => {
        let text;
        if (isGBK) {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          text = iconv.decode(buffer, 'gbk');
        } else {
          text = typeof data === 'string' ? data : data.toString('utf8');
        }
        const output = text;
        stdout += output;
        output.split('\n').forEach(line => {
          if (line.trim()) {
            this.logger.debug(`[注入] ${line.trim()}`);
          }
        });
      });

      // 设置编码（仅 UTF-8 支持 setEncoding）
      if (!isGBK && attachProcess.stderr.setEncoding) {
        attachProcess.stderr.setEncoding('utf8');
      }
      attachProcess.stderr.on('data', (data) => {
        let text;
        if (isGBK) {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
          text = iconv.decode(buffer, 'gbk');
        } else {
          text = typeof data === 'string' ? data : data.toString('utf8');
        }
        stderr += text;
      });

      attachProcess.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          const errorMsg = `Agent 注入失败 (退出码: ${code})`;
          this.logger.error(errorMsg);
          if (stderr) {
            this.logger.error(`错误输出: ${stderr}`);
          }
          reject(new Error(errorMsg));
        }
      });

      attachProcess.on('error', (err) => {
        this.logger.error(`注入进程错误: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * 获取 Agent 路径信息
   */
  getAgentPaths() {
    return {
      agentDir: this.agentDir,
      agentJar: this.agentJar,
      attacherJar: this.attacherJar,
      distDir: this.distDir
    };
  }
}

