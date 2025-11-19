/**
 * 命令补全器
 */
export class CommandCompleter {
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * 获取补全建议
   * @param {string} line - 当前输入行
   * @returns {Array} 补全建议数组
   */
  complete(line) {
    const prefix = this.registry.prefix;

    // 检查是否以前缀开头（不 trim，保留空格信息）
    if (!line.startsWith(prefix)) {
      return [];
    }
    
    // 提取命令部分（去掉前缀）
    const commandInput = line.substring(prefix.length);
    
    // 如果输入为空（只有前缀），返回补全
    if (commandInput.trim() === '' && commandInput.length === 0) {
      return this.registry.getCompletions('');
    }
    
    // 检查是否有末尾空格（表示要补全子命令）
    const hasTrailingSpace = commandInput.endsWith(' ');
    const trimmedCommand = commandInput.trim();
    
    // 如果输入为空（只有前缀和空格），返回补全
    if (trimmedCommand === '' && hasTrailingSpace) {
      return [];
    }
    
    // 使用注册表获取补全建议（传入原始输入，保留空格信息）
    return this.registry.getCompletions(commandInput);
  }
}

