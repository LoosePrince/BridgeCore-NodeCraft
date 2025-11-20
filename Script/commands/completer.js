/**
 * 命令补全器
 */
export class CommandCompleter {
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * 获取补全建议
   * @param {string} line - 当前输入行（包含前缀）
   * @returns {Object} {candidates: Array, shouldShow: boolean, type: 'command'|'subcommand'|'argument'}
   */
  complete(line) {
    const prefix = this.registry.prefix;

    if (!line.startsWith(prefix)) {
      return { candidates: [], shouldShow: false, type: 'command' };
    }
    
    const commandInput = line.substring(prefix.length);
    const trimmedInput = commandInput.trim();
    const hasTrailingSpace = commandInput.endsWith(' ');
    
    // 空输入：显示所有顶级命令
    if (trimmedInput === '' && !hasTrailingSpace) {
      const allCommands = this.registry.getCompletions('');
      return {
        candidates: allCommands.map(cmd => cmd.substring(prefix.length)),
        shouldShow: true,
        type: 'command'
      };
    }
    
    const parsed = this.registry.parse(trimmedInput);
    const inputParts = trimmedInput.split(/\s+/);
    
    if (parsed.command) {
      const commandPathLength = parsed.command.path.length;
      const isExactMatch = inputParts.length === commandPathLength && !hasTrailingSpace;
      
      // 完全匹配命令路径，不显示候选
      if (isExactMatch) {
        return { candidates: [], shouldShow: false, type: 'command' };
      }
      
      // 检查参数完全匹配
      if (inputParts.length > commandPathLength && !hasTrailingSpace) {
        if (this.checkArgumentExactMatch(parsed.command, inputParts, trimmedInput, hasTrailingSpace)) {
          return { candidates: [], shouldShow: false, type: 'argument' };
        }
      }
      
      // 获取子命令或参数补全
      if (hasTrailingSpace || inputParts.length > commandPathLength) {
        const completions = this.registry.getCompletions(commandInput);
        if (completions.length > 0) {
          const candidates = this.extractCandidateParts(completions, prefix, trimmedInput, hasTrailingSpace, parsed.command);
          const type = inputParts.length === commandPathLength ? 'subcommand' : 'argument';
          return { candidates, shouldShow: true, type };
        }
      }
      
      // 部分匹配子命令（如 "log l" -> "level"）
      if (inputParts.length > commandPathLength && !hasTrailingSpace) {
        const candidates = this.findMatchingSubCommands(parsed.command, inputParts, commandPathLength);
        if (candidates.length > 0) {
          return { candidates, shouldShow: true, type: 'subcommand' };
        }
      }
    }
    
    // 部分匹配命令
    if (trimmedInput.length > 0) {
      const completions = this.registry.getCompletions(commandInput);
      if (completions.length > 0) {
        const candidates = this.extractCandidateParts(completions, prefix, trimmedInput, hasTrailingSpace, null);
        return { candidates, shouldShow: true, type: 'command' };
      }
    }
    
    return { candidates: [], shouldShow: false, type: 'command' };
    }
    
  /**
   * 检查参数是否完全匹配某个选项
   */
  checkArgumentExactMatch(command, inputParts, trimmedInput, hasTrailingSpace) {
    const commandPathLength = command.path.length;
    const typedArgs = inputParts.slice(commandPathLength);
    const lastArg = typedArgs[typedArgs.length - 1];
    const argDefs = command.args || [];
    
    if (argDefs.length === 0) return false;
    
    const currentArgIndex = typedArgs.length - 1;
    if (currentArgIndex >= argDefs.length) return false;
    
    const argDef = argDefs[currentArgIndex];
    let options = argDef.options || [];
    
    if (typeof options === 'function') {
      try {
        options = options({
          command,
          argIndex: currentArgIndex,
          parts: inputParts,
          rawInput: trimmedInput,
          hasTrailingSpace
        }) || [];
      } catch (error) {
        return false;
      }
    }
    
    return options.some(opt => opt.toLowerCase() === lastArg.toLowerCase());
  }
  
  /**
   * 查找匹配的子命令
   */
  findMatchingSubCommands(command, inputParts, commandPathLength) {
    const subCommandPrefix = inputParts.slice(commandPathLength).join(' ').toLowerCase();
    const allCommands = this.registry.getAllCommands();
    
    return allCommands
      .filter(cmd => {
        if (cmd.path.length !== commandPathLength + 1) return false;
        
        // 检查路径前缀是否匹配
        for (let i = 0; i < commandPathLength; i++) {
          if (cmd.path[i].toLowerCase() !== command.path[i].toLowerCase()) {
            return false;
          }
        }
        
        // 检查最后一个部分是否以输入前缀开头
        return cmd.path[cmd.path.length - 1].toLowerCase().startsWith(subCommandPrefix);
      })
      .map(cmd => cmd.path[cmd.path.length - 1]);
  }
  
  /**
   * 提取候选部分（去掉前缀和已输入部分）
   */
  extractCandidateParts(completions, prefix, input, hasTrailingSpace, matchedCommand = null) {
    const inputTrimmed = input.trim();
    const inputParts = inputTrimmed.split(/\s+/);
    const inputPartsCount = inputParts.length;
    
    return completions
      .map(completion => {
        const candidate = this.removePrefix(completion, prefix).trim();
        const candidateParts = candidate.split(/\s+/);
        
        if (!inputTrimmed) {
          return candidate;
        }
        
        // 词数相同：可能是命令补全或参数补全
        if (candidateParts.length === inputPartsCount) {
          const result = this.handleEqualLength(candidateParts, inputParts, candidate, matchedCommand);
          if (result !== null) return result;
        }
        
        // 候选词数大于输入：可能是子命令或参数补全
        if (candidateParts.length > inputPartsCount) {
          const result = this.handleLongerCandidate(candidateParts, inputParts, hasTrailingSpace, matchedCommand);
          if (result !== null) return result;
        }
        
        // 字符串匹配：可能是命令补全
        if (candidate.startsWith(inputTrimmed)) {
          return this.handleStringMatch(candidate, candidateParts, inputTrimmed, inputPartsCount, hasTrailingSpace);
        }
        
        return candidate;
      })
      .filter(c => c.length > 0);
  }
  
  /**
   * 移除前缀
   */
  removePrefix(text, prefix) {
    return text.startsWith(prefix) ? text.substring(prefix.length) : text;
  }
  
  /**
   * 处理词数相同的情况
   */
  handleEqualLength(candidateParts, inputParts, candidate, matchedCommand) {
    const inputPartsCount = inputParts.length;
    
    // 参数补全：路径匹配，只返回参数值
    if (matchedCommand && inputPartsCount > matchedCommand.path.length) {
      if (this.isPathMatched(candidateParts, inputParts, matchedCommand.path.length)) {
        return candidateParts[candidateParts.length - 1];
      }
    }
    
    // 命令补全：第一个词部分匹配
    const candidateFirst = candidateParts[0].toLowerCase();
    const inputFirst = inputParts[0].toLowerCase();
    
    if (candidateFirst.startsWith(inputFirst) && candidateFirst !== inputFirst) {
      return candidateParts[0];
    }
    
    if (candidateFirst === inputFirst) {
      return candidate;
    }
    
    return null;
  }
  
  /**
   * 处理候选词数大于输入的情况
   */
  handleLongerCandidate(candidateParts, inputParts, hasTrailingSpace, matchedCommand) {
    const inputPartsCount = inputParts.length;
    
    if (!this.isPathMatched(candidateParts, inputParts, inputPartsCount)) {
      return null;
    }
    
    const lastPart = candidateParts[candidateParts.length - 1];
    const isArgumentCompletion = matchedCommand && inputPartsCount > matchedCommand.path.length;
    
    // 参数补全：总是返回参数值
    if (isArgumentCompletion) {
      return lastPart;
    }
    
    // 有末尾空格：返回最后一个词
    if (hasTrailingSpace) {
      return lastPart;
    }
    
    // 检查最后一个词是否匹配
    const inputLast = inputParts[inputPartsCount - 1].toLowerCase();
    const candidateLast = lastPart.toLowerCase();
    
    return candidateLast.startsWith(inputLast) ? lastPart : lastPart;
  }
  
  /**
   * 处理字符串匹配的情况
   */
  handleStringMatch(candidate, candidateParts, inputTrimmed, inputPartsCount, hasTrailingSpace) {
    // 命令补全：返回第一个词
    if (candidateParts.length === inputPartsCount || inputPartsCount === 1) {
      return candidateParts[0];
    }
    
    // 子命令或参数补全：提取剩余部分
    const remaining = candidate.substring(inputTrimmed.length).trim();
    if (!remaining) return candidate;
    
    if (hasTrailingSpace) {
      return remaining;
    }
    
    return remaining.split(/\s+/)[0];
  }
  
  /**
   * 检查路径是否匹配
   */
  isPathMatched(candidateParts, inputParts, matchLength) {
    for (let i = 0; i < matchLength; i++) {
      if (candidateParts[i].toLowerCase() !== inputParts[i].toLowerCase()) {
        return false;
      }
    }
    return true;
  }
}

