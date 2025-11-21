/**
 * 命令注册表 - 管理所有命令的指令树
 */
export class CommandRegistry {
  constructor(prefix, options = {}) {
    this.prefix = prefix;
    this.commands = new Map(); // 存储所有注册的命令
    this.commandTree = {}; // 命令树结构
    this.permissionLevelStack = [1];
    this.denyMessageStack = [null];
    this.placeholderResolvers = options.placeholderResolvers || {};
  }

  /**
   * 注册命令
   * @param {string|Array} path - 命令路径，可以是字符串 "help" 或数组 ["server", "restart"]
   * @param {Object} definition - 命令定义
   * @param {Function} definition.handler - 命令处理函数
   * @param {string} definition.description - 命令描述
   * @param {Array} definition.aliases - 命令别名
   * @param {Array} definition.args - 参数定义 [{name: 'name', description: '参数描述', required: false, type: 'string'}]
   * @param {Array} definition.subcommands - 子命令列表
   */
  register(path, definition = {}) {
    const paths = Array.isArray(path) ? path : [path];
    const commandName = paths[paths.length - 1];
    
    // 构建命令键（完整路径）
    const fullPath = paths.join(' ');
    const commandKey = paths.map(p => p.toLowerCase()).join(' ');

    const {
      permissionLevel: explicitPermissionLevel,
      denyMessage: explicitDenyMessage,
      ...restDefinition
    } = definition || {};
    const permissionLevel = this.normalizePermissionLevel(
      typeof explicitPermissionLevel === 'number' ? explicitPermissionLevel : this.getCurrentPermissionLevel()
    );
    const denyMessage = explicitDenyMessage !== undefined
      ? explicitDenyMessage
      : this.getCurrentDenyMessage();
    
    // 存储命令定义
    const commandDef = {
      path: paths,
      fullPath: fullPath,
      key: commandKey,
      name: commandName,
      handler: restDefinition.handler,
      description: restDefinition.description || '',
      aliases: restDefinition.aliases || [],
      args: restDefinition.args || [],
      subcommands: restDefinition.subcommands || [],
      permissionLevel,
      denyMessage,
      ...restDefinition
    };
    
    this.commands.set(commandKey, commandDef);
    
    // 构建命令树
    let current = this.commandTree;
    for (let i = 0; i < paths.length; i++) {
      const pathPart = paths[i].toLowerCase();
      if (!current[pathPart]) {
        current[pathPart] = {
          commands: [],
          subcommands: {}
        };
      }
      if (i === paths.length - 1) {
        // 最后一个路径，添加命令
        current[pathPart].commands.push(commandDef);
      } else {
        // 中间路径，进入子命令
        current = current[pathPart].subcommands;
      }
    }
    
    // 注册别名
    if (definition.aliases) {
      definition.aliases.forEach(alias => {
        const aliasPaths = [...paths];
        aliasPaths[aliasPaths.length - 1] = alias;
        const aliasKey = aliasPaths.map(p => p.toLowerCase()).join(' ');
        this.commands.set(aliasKey, commandDef);
      });
    }
  }

  /**
   * 判断某命令路径是否拥有子命令
   * @param {Array<string>} pathSegments
   * @returns {boolean}
   */
  hasChildren(pathSegments) {
    let current = this.commandTree;
    for (let i = 0; i < pathSegments.length; i++) {
      const seg = pathSegments[i].toLowerCase();
      if (!current[seg]) {
        return false;
      }
      if (i === pathSegments.length - 1) {
        const node = current[seg];
        if (!node || !node.subcommands) {
          return false;
        }
        return Object.keys(node.subcommands).length > 0;
      }
      current = current[seg].subcommands;
    }
    return false;
  }

  /**
   * 查找命令
   * @param {string} commandPath - 命令路径（如 "help" 或 "server restart"）
   * @returns {Object|null} 命令定义
   */
  find(commandPath) {
    const key = commandPath.toLowerCase().trim();
    return this.commands.get(key) || null;
  }

  /**
   * 解析命令和参数
   * @param {string} input - 用户输入（不包含前缀）
   * @returns {Object} {command: 命令定义, args: 参数数组, remaining: 剩余输入}
   */
  parse(input) {
    const parts = input.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return { command: null, args: [], remaining: input };
    }

    // 尝试匹配命令（支持多级命令）
    let bestMatch = null;
    let bestMatchLength = 0;
    
    // 从最长路径开始匹配
    for (let i = parts.length; i > 0; i--) {
      const commandPath = parts.slice(0, i).join(' ');
      const command = this.find(commandPath);
      if (command) {
        bestMatch = command;
        bestMatchLength = i;
        break;
      }
    }

    if (!bestMatch) {
      return { command: null, args: parts, remaining: input };
    }

    // 提取参数
    const args = parts.slice(bestMatchLength);
    
    return {
      command: bestMatch,
      args: args,
      remaining: args.join(' ')
    };
  }

  /**
   * 获取命令补全建议
   * @param {string} input - 当前输入（不包含前缀）
   * @returns {Array} 补全建议数组
   */
  getCompletions(input) {
    // 检查是否有末尾空格（表示要补全子命令）
    const hasTrailingSpace = input.endsWith(' ');
    const trimmed = input.trim();
    
    if (!trimmed) {
      // 返回所有顶级命令（去重，只返回主命令名）
      const seenCommands = new Set();
      const candidates = [];
      
      // 获取所有顶级命令
      Array.from(this.commands.values())
        .filter(cmd => {
          if (cmd.path.length === 1) {
            const originalKey = cmd.path.join(' ');
            if (seenCommands.has(originalKey)) {
              return false;
            }
            seenCommands.add(originalKey);
            // 只返回主命令名，不返回别名
            return cmd.name === cmd.path[0]; // 确保是主命令，不是别名
          }
          return false;
        })
        .forEach(cmd => {
          candidates.push(this.prefix + cmd.name);
        });
      
      // 添加有子命令的父命令（从命令树中查找）
      Object.keys(this.commandTree).forEach(key => {
        const node = this.commandTree[key];
        // 如果这个节点有子命令，且不是已注册的顶级命令，则添加
        if (Object.keys(node.subcommands).length > 0) {
          const parentCommand = this.prefix + key;
          if (!candidates.includes(parentCommand)) {
            // 检查是否有这个父命令的直接命令（如果没有，说明只是父节点）
            const hasDirectCommand = node.commands && node.commands.length > 0;
            if (!hasDirectCommand) {
              candidates.push(parentCommand);
            }
          }
        }
      });
      
      return candidates.sort();
    }

    const parts = trimmed.split(/\s+/);
    const parsedResult = this.parse(trimmed);
    const matchedCommand = parsedResult.command;

    if (matchedCommand) {
      const argCandidates = this.getArgumentCompletions(
        matchedCommand,
        parts,
        input,
        hasTrailingSpace
      );
      if (argCandidates.length > 0) {
        return argCandidates;
      }

      // 如果有末尾空格，说明要补全子命令，不要提前返回
      if (this.isCommandPathMatched(parts, matchedCommand) && !hasTrailingSpace) {
        // 已完整匹配该命令（可能没有参数或没有可补全选项）
        return [];
      }
    }

    // 如果有末尾空格，说明要补全子命令，将 lastPart 设为空
    let lastPart = '';
    let beforeLast = '';
    
    if (hasTrailingSpace) {
      // 有末尾空格，所有部分都是父路径
      beforeLast = trimmed;
      lastPart = '';
    } else {
      // 没有末尾空格，正常处理
      lastPart = parts[parts.length - 1].toLowerCase();
      beforeLast = parts.slice(0, -1).join(' ');
    }

    // 如果已经输入了完整命令，尝试参数补全
    // 但如果有末尾空格，说明要补全子命令，不要返回空
    if (!hasTrailingSpace) {
      const parsed = this.parse(beforeLast || lastPart);
      if (parsed.command && parsed.args.length === 0 && parts.length > parsed.command.path.length) {
        // 完全匹配命令，可能是参数补全（可以后续扩展）
        return [];
      }
    }

    // 命令补全
    const candidates = [];
    
    // 查找可能的命令匹配
    if (beforeLast) {
      // 查找以 beforeLast 开头的命令的子命令
      const parentPath = beforeLast.toLowerCase();
      const matchingCommands = Array.from(this.commands.values())
        .filter(cmd => {
          // 检查是否是父命令的子命令
          if (cmd.path.length > 1) {
            const parentPathParts = parentPath.split(/\s+/);
            if (cmd.path.length === parentPathParts.length + 1) {
              // 检查路径是否匹配
              for (let i = 0; i < parentPathParts.length; i++) {
                if (cmd.path[i].toLowerCase() !== parentPathParts[i]) {
                  return false;
                }
              }
              // 如果 lastPart 为空，显示所有子命令；否则只显示匹配的
              if (lastPart === '') {
                return true;
              }
              // 检查最后一个部分是否匹配
              return cmd.path[cmd.path.length - 1].toLowerCase().startsWith(lastPart);
            }
          }
          return false;
        });
      
      matchingCommands.forEach(cmd => {
        const fullPath = cmd.path.join(' ');
        candidates.push(this.prefix + fullPath);
      });
      
      // 如果 lastPart 为空，也从命令树中查找子命令（处理只有子命令但没有直接注册的情况）
      if (lastPart === '' && matchingCommands.length === 0) {
        // 尝试从命令树中查找
        let currentNode = this.commandTree;
        const parentPathParts = parentPath.split(/\s+/);
        for (let i = 0; i < parentPathParts.length; i++) {
          const part = parentPathParts[i].toLowerCase();
          if (currentNode[part] && currentNode[part].subcommands) {
            currentNode = currentNode[part].subcommands;
          } else {
            currentNode = null;
            break;
          }
        }
        if (currentNode) {
          Object.keys(currentNode).forEach(key => {
            const node = currentNode[key];
            // 如果这个节点有命令，添加完整路径
            if (node.commands && node.commands.length > 0) {
              const fullPath = parentPath + ' ' + key;
              candidates.push(this.prefix + fullPath);
            }
          });
        }
      }
    } else {
      // 顶级命令补全（去重）
      const seenCommands = new Set();
      
      // 查找匹配的顶级命令
      Array.from(this.commands.values())
        .filter(cmd => {
          if (cmd.path.length === 1) {
            const cmdName = cmd.name.toLowerCase();
            const originalKey = cmd.path.join(' ');
            // 只处理原始命令，不处理别名
            if (seenCommands.has(originalKey)) {
              return false;
            }
            seenCommands.add(originalKey);
            return cmdName.startsWith(lastPart) || 
                   cmd.aliases.some(alias => alias.toLowerCase().startsWith(lastPart));
          }
          return false;
        })
        .forEach(cmd => {
          const cmdName = cmd.name.toLowerCase();
          if (cmdName.startsWith(lastPart)) {
            candidates.push(this.prefix + cmd.name);
          }
          // 添加匹配的别名（但不添加主命令名，避免重复）
          cmd.aliases.forEach(alias => {
            if (alias.toLowerCase().startsWith(lastPart) && alias.toLowerCase() !== cmdName) {
              candidates.push(this.prefix + alias);
            }
          });
        });
      
      // 添加匹配的有子命令的父命令
      Object.keys(this.commandTree).forEach(key => {
        const node = this.commandTree[key];
      const keyLower = key.toLowerCase();
      const hasChildren = Object.keys(node.subcommands || {}).length > 0;
      const hasDirectCommand = node.commands && node.commands.length > 0;
      if (
        keyLower.startsWith(lastPart) &&
        hasChildren &&
        !candidates.includes(this.prefix + key) &&
        !hasDirectCommand
      ) {
        candidates.push(this.prefix + key);
      }
      });
    }

    // 去重并排序
    return [...new Set(candidates)].sort();
  }

  /**
   * 获取命令树（用于帮助显示）
   * @returns {Object} 命令树
   */
  getTree() {
    return this.commandTree;
  }

  /**
   * 获取所有命令列表（去重，不包括别名）
   * @returns {Array} 所有命令定义
   */
  getAllCommands() {
    // 使用 Map 按原始路径去重
    const uniqueCommands = new Map();
    this.commands.forEach((cmd, key) => {
      // 使用原始路径作为键（不包括别名）
      const originalKey = cmd.path.map(p => p.toLowerCase()).join(' ');
      if (!uniqueCommands.has(originalKey)) {
        uniqueCommands.set(originalKey, cmd);
      }
    });
    return Array.from(uniqueCommands.values());
  }

  /**
   * 检查输入是否完整匹配命令路径
   * @param {Array<string>} parts
   * @param {Object} command
   */
  isCommandPathMatched(parts, command) {
    if (parts.length < command.path.length) {
      return false;
    }
    for (let i = 0; i < command.path.length; i++) {
      if (parts[i].toLowerCase() !== command.path[i].toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  /**
   * 根据参数定义获取补全建议
   * @param {Object} command - 匹配到的命令
   * @param {Array<string>} parts - 输入拆分后的片段
   * @param {string} rawInput - 未处理的输入（不包含前缀）
   * @param {boolean} hasTrailingSpace - 是否存在末尾空格
   * @returns {Array<string>} 参数补全建议
   */
  getArgumentCompletions(command, parts, rawInput, hasTrailingSpace) {
    const argDefs = command.args || [];
    if (!argDefs.length) {
      return [];
    }

    if (!this.isCommandPathMatched(parts, command)) {
      return [];
    }

    const commandPathLength = command.path.length;
    const typedArgsCount = Math.max(0, parts.length - commandPathLength);

    let currentArgIndex = null;
    let partialValue = '';
    let partialValueNormalized = '';

    if (typedArgsCount === 0) {
      if (hasTrailingSpace || parts.length === commandPathLength) {
        currentArgIndex = 0;
      } else {
        return [];
      }
    } else {
      if (hasTrailingSpace) {
        currentArgIndex = typedArgsCount;
      } else {
        currentArgIndex = typedArgsCount - 1;
        partialValue = parts[parts.length - 1];
        partialValueNormalized = partialValue.toLowerCase();
      }
    }

    if (currentArgIndex === null || currentArgIndex < 0 || currentArgIndex >= argDefs.length) {
      return [];
    }

    const argDef = argDefs[currentArgIndex];
    let options = argDef.options || [];
    if (typeof options === 'function') {
      try {
        options = options({
          command,
          argIndex: currentArgIndex,
          parts,
          rawInput,
          hasTrailingSpace
        }) || [];
      } catch (error) {
        options = [];
      }
    } else if (typeof options === 'string') {
      options = this.resolvePlaceholderOptions(options, {
        command,
        argIndex: currentArgIndex,
        parts,
        rawInput,
        hasTrailingSpace
      });
    }
    if (!Array.isArray(options) || !options.length) {
      return [];
    }

    const filteredOptions = options.filter(opt => {
      if (!partialValue) {
        return true;
      }
      return opt.toLowerCase().startsWith(partialValueNormalized);
    });

    if (!filteredOptions.length) {
      return [];
    }

    const baseInput = partialValue
      ? rawInput.slice(0, rawInput.length - partialValue.length)
      : (rawInput.endsWith(' ') ? rawInput : `${rawInput} `);

    return filteredOptions.map(opt => `${this.prefix}${baseInput}${opt}`);
  }

  resolvePlaceholderOptions(identifier, context) {
    if (!identifier || typeof identifier !== 'string') {
      return [];
    }
    const normalized = identifier.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!normalized) {
      return [];
    }
    const resolver = this.placeholderResolvers?.[normalized];
    if (!resolver) {
      return [];
    }
    try {
      const result = resolver(context);
      if (Array.isArray(result)) {
        return result.filter(item => typeof item === 'string' && item.length > 0);
      }
      return [];
    } catch (error) {
      // 静默失败，避免影响补全功能
      return [];
    }
  }

  /**
   * 注销命令
   * @param {string|Array} path - 要移除的命令路径
   * @returns {boolean} 是否成功
   */
  unregister(path) {
    const paths = Array.isArray(path) ? path : [path];
    const commandKey = paths.map(p => p.toLowerCase()).join(' ');
    const command = this.commands.get(commandKey);
    if (!command) {
      return false;
    }

    this.commands.delete(commandKey);

    if (command.aliases && command.aliases.length > 0) {
      command.aliases.forEach(alias => {
        const aliasPaths = [...command.path];
        aliasPaths[aliasPaths.length - 1] = alias;
        const aliasKey = aliasPaths.map(p => p.toLowerCase()).join(' ');
        if (this.commands.get(aliasKey) === command) {
          this.commands.delete(aliasKey);
        }
      });
    }

    let current = this.commandTree;
    const nodes = [];
    for (let i = 0; i < paths.length; i++) {
      const part = paths[i].toLowerCase();
      if (!current[part]) {
        return true;
      }
      nodes.push({ parent: current, key: part });
      if (i === paths.length - 1) {
        current[part].commands = current[part].commands.filter(cmd => cmd !== command);
      } else {
        current = current[part].subcommands;
      }
    }

    for (let i = nodes.length - 1; i >= 0; i--) {
      const { parent, key } = nodes[i];
      const node = parent[key];
      if (node && node.commands.length === 0 && Object.keys(node.subcommands).length === 0) {
        delete parent[key];
      } else {
        break;
      }
    }

    return true;
  }

  getCurrentPermissionLevel() {
    return this.permissionLevelStack[this.permissionLevelStack.length - 1] ?? 1;
  }

  getCurrentDenyMessage() {
    return this.denyMessageStack[this.denyMessageStack.length - 1] ?? null;
  }

  normalizePermissionLevel(level) {
    const value = parseInt(level, 10);
    if (Number.isNaN(value)) {
      return this.getCurrentPermissionLevel();
    }
    return Math.min(4, Math.max(1, value));
  }

  pushPermissionLevel(level) {
    const normalized = this.normalizePermissionLevel(level);
    this.permissionLevelStack.push(normalized);
  }

  popPermissionLevel() {
    if (this.permissionLevelStack.length > 1) {
      this.permissionLevelStack.pop();
    }
  }

  withPermissionLevel(level, fn) {
    this.pushPermissionLevel(level);
    try {
      return fn();
    } finally {
      this.popPermissionLevel();
    }
  }

  pushDenyMessage(message) {
    this.denyMessageStack.push(message ?? null);
  }

  popDenyMessage() {
    if (this.denyMessageStack.length > 1) {
      this.denyMessageStack.pop();
    }
  }

  withDenyMessage(message, fn) {
    this.pushDenyMessage(message);
    try {
      return fn();
    } finally {
      this.popDenyMessage();
    }
  }
}

