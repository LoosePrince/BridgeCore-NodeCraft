import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 加载配置文件
 * @param {string} projectRoot - 项目根目录路径
 * @returns {object} 配置对象
 */
export function loadConfig(projectRoot) {
  try {
    const configPath = join(projectRoot, 'config.yml');
    const configContent = readFileSync(configPath, 'utf8');
    return yaml.load(configContent);
  } catch (error) {
    console.error(chalk.red('❌ 加载配置文件失败:'), error.message);
    process.exit(1);
  }
}

