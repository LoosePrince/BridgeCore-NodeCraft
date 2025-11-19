/**
 * Agent 拦截器管理
 * 提供拦截规则注册、管理和处理的高级 API
 */
export class AgentInterceptor {
  constructor(communicator, logger) {
    this.communicator = communicator;
    this.logger = logger;
    this.rules = new Map(); // ruleId -> { pattern, matchType, handler }
    this.setupListeners();
  }

  /**
   * 设置事件监听
   */
  setupListeners() {
    // 监听拦截事件
    this.communicator.on('chatIntercepted', ({ ruleId, message, playerName }) => {
      const rule = this.rules.get(ruleId);
      if (rule && rule.handler) {
        try {
          rule.handler({ message, playerName, ruleId });
        } catch (error) {
          this.logger.error(`拦截规则 ${ruleId} 处理失败: ${error.message}`);
        }
      }
    });

    // 监听规则注册结果
    this.communicator.on('ruleRegistered', (ruleId) => {
      this.logger.debug(`规则已注册: ${ruleId}`);
    });

    this.communicator.on('ruleRegisterFailed', (error) => {
      this.logger.error(`规则注册失败: ${error}`);
    });

    this.communicator.on('ruleUnregistered', (ruleId) => {
      this.logger.debug(`规则已注销: ${ruleId}`);
    });
  }

  /**
   * 注册拦截规则
   * @param {Object} options - 规则选项
   * @param {string} options.id - 规则 ID
   * @param {string} options.pattern - 匹配模式
   * @param {string} options.matchType - 匹配类型: 'prefix', 'regex', 'contains'
   * @param {Function} options.handler - 拦截处理函数 ({ message, playerName, ruleId }) => void
   * @returns {boolean} 是否注册成功
   */
  registerRule({ id, pattern, matchType = 'prefix', handler }) {
    if (!id || !pattern) {
      this.logger.error('规则 ID 和 pattern 不能为空');
      return false;
    }

    if (!['prefix', 'regex', 'contains'].includes(matchType)) {
      this.logger.error(`不支持的匹配类型: ${matchType}`);
      return false;
    }

    // 存储规则和处理器
    this.rules.set(id, { pattern, matchType, handler });

    // 发送到 Agent
    const data = `${id}|${pattern}|${matchType}`;
    this.communicator.sendMessage('REGISTER_RULE', data);

    this.logger.debug(`注册拦截规则: ${id} (${matchType}: "${pattern}")`);
    return true;
  }

  /**
   * 注销拦截规则
   * @param {string} id - 规则 ID
   * @returns {boolean} 是否注销成功
   */
  unregisterRule(id) {
    if (!this.rules.has(id)) {
      this.logger.warn(`规则不存在: ${id}`);
      return false;
    }

    this.rules.delete(id);
    this.communicator.sendMessage('UNREGISTER_RULE', id);
    this.logger.info(`注销拦截规则: ${id}`);
    return true;
  }

  /**
   * 清空所有规则
   */
  clearRules() {
    this.rules.clear();
    this.communicator.sendMessage('CLEAR_RULES', '');
    this.logger.info('已清空所有拦截规则');
  }

  /**
   * 列出所有规则
   * @returns {Array} 规则列表
   */
  listRules() {
    return Array.from(this.rules.entries()).map(([id, rule]) => ({
      id,
      pattern: rule.pattern,
      matchType: rule.matchType,
      hasHandler: !!rule.handler
    }));
  }

  /**
   * 便捷方法：注册命令前缀拦截
   * @param {string} prefix - 命令前缀 (如 "!")
   * @param {Function} handler - 处理函数
   */
  onCommand(prefix, handler) {
    return this.registerRule({
      id: `command:${prefix}`,
      pattern: prefix,
      matchType: 'prefix',
      handler: ({ message, playerName }) => {
        const command = message.substring(prefix.length).trim();
        handler(command, playerName);
      }
    });
  }

  /**
   * 便捷方法：注册包含关键词拦截
   * @param {string} keyword - 关键词
   * @param {Function} handler - 处理函数
   */
  onKeyword(keyword, handler) {
    return this.registerRule({
      id: `keyword:${keyword}`,
      pattern: keyword,
      matchType: 'contains',
      handler
    });
  }

  /**
   * 便捷方法：注册正则表达式拦截
   * @param {string} regex - 正则表达式
   * @param {string} id - 规则 ID
   * @param {Function} handler - 处理函数
   */
  onRegex(regex, id, handler) {
    return this.registerRule({
      id: `regex:${id}`,
      pattern: regex,
      matchType: 'regex',
      handler
    });
  }
}

