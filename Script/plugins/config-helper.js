import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname } from 'path';
import yaml from 'js-yaml';

/**
 * 快捷配置接口
 * 提供在 pluginConfigDir 下的快速读写配置功能
 */
export class ConfigHelper {
  constructor(pluginConfigDir, logger) {
    this.pluginConfigDir = pluginConfigDir;
    this.logger = logger;
    
    // 确保配置目录存在
    if (!existsSync(pluginConfigDir)) {
      mkdirSync(pluginConfigDir, { recursive: true });
    }
  }
  
  /**
   * 获取配置文件路径
   * @param {string} filename - 配置文件名（可选，默认为 config.yml 或 config.json）
   * @param {'yml'|'yaml'|'json'} type - 配置类型（可选，默认从文件名推断，否则为 yml）
   * @returns {string} 配置文件路径
   */
  getConfigPath(filename = null, type = null) {
    if (filename) {
      // 如果提供了文件名，使用提供的文件名
      return join(this.pluginConfigDir, filename);
    }
    
    // 如果没有提供文件名，使用默认文件名
    if (type === 'json') {
      return join(this.pluginConfigDir, 'config.json');
    }
    // 默认使用 yml
    return join(this.pluginConfigDir, 'config.yml');
  }
  
  /**
   * 推断配置类型
   * @param {string} filepath - 文件路径
   * @param {'yml'|'yaml'|'json'} defaultType - 默认类型
   * @returns {'yml'|'json'} 配置类型
   */
  inferType(filepath, defaultType = 'yml') {
    const ext = extname(filepath).toLowerCase();
    if (ext === '.json') {
      return 'json';
    }
    if (ext === '.yml' || ext === '.yaml') {
      return 'yml';
    }
    return defaultType === 'json' ? 'json' : 'yml';
  }
  
  /**
   * 读取配置
   * @param {string} filename - 配置文件名（可选）
   * @param {'yml'|'yaml'|'json'} type - 配置类型（可选）
   * @param {object} defaultValue - 默认值（如果文件不存在）
   * @returns {object} 配置对象
   */
  read(filename = null, type = null, defaultValue = {}) {
    const filepath = this.getConfigPath(filename, type);
    const configType = type || this.inferType(filepath);
    
    if (!existsSync(filepath)) {
      // 如果文件不存在，返回默认值
      return defaultValue;
    }
    
    try {
      const content = readFileSync(filepath, 'utf8');
      
      if (configType === 'json') {
        return JSON.parse(content);
      } else {
        return yaml.load(content) || defaultValue;
      }
    } catch (error) {
      this.logger?.warn(`读取配置文件失败: ${filepath}, ${error.message}`);
      return defaultValue;
    }
  }
  
  /**
   * 写入配置
   * @param {object} data - 要写入的配置对象
   * @param {string} filename - 配置文件名（可选）
   * @param {'yml'|'yaml'|'json'} type - 配置类型（可选）
   */
  write(data, filename = null, type = null) {
    const filepath = this.getConfigPath(filename, type);
    const configType = type || this.inferType(filepath);
    
    try {
      let content;
      if (configType === 'json') {
        content = JSON.stringify(data, null, 2);
      } else {
        content = yaml.dump(data, {
          indent: 2,
          lineWidth: -1,
          noRefs: true
        });
      }
      
      writeFileSync(filepath, content, 'utf8');
    } catch (error) {
      this.logger?.error(`写入配置文件失败: ${filepath}, ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 检查配置文件是否存在
   * @param {string} filename - 配置文件名（可选）
   * @param {'yml'|'yaml'|'json'} type - 配置类型（可选）
   * @returns {boolean} 文件是否存在
   */
  exists(filename = null, type = null) {
    const filepath = this.getConfigPath(filename, type);
    return existsSync(filepath);
  }
}

