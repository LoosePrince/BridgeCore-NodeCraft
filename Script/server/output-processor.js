import { randomUUID } from 'crypto';
import { createServerHandler } from './handlers/index.js';

export class ServerOutputProcessor {
  constructor({ eventBus, logger, handlerName = 'vanilla' }) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.dynamicProcessors = new Map();
    this.setHandler(handlerName);
  }

  setHandler(handlerName) {
    if (this.handler && typeof this.handler.dispose === 'function') {
      this.handler.dispose();
    }
    this.handler = createServerHandler(handlerName, {
      logger: this.logger,
      eventBus: this.eventBus
    });
    this.processors = [...(this.handler?.getProcessors?.() || [])];
    this.dynamicProcessors = new Map();
  }

  handleLine(line, source = 'stdout') {
    if (!line) {
      return false;
    }
    const sanitized = line.replace(/\r?\n$/, '').trim();

    if (this.tryHandleAgentLog(sanitized)) {
      return true;
    }

    const context = {
      line: sanitized,
      source,
      timestamp: new Date()
    };

    this.eventBus?.emit('server:line', context);

    const allProcessors = [...(this.processors || []), ...this.dynamicProcessors.values()];
    for (const processor of allProcessors) {
      try {
        const result = processor.match ? processor.match(sanitized, context) : null;
        if (result && result.event) {
          const payload = {
            ...result.data,
            line: sanitized,
            source,
            timestamp: context.timestamp
          };
          this.eventBus?.emit(result.event, payload);
        }
      } catch (error) {
        this.logger?.warn(`处理服务器输出时出错: ${error.message}`);
      }
    }
    return false;
  }

  registerProcessor(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('自定义解析器必须是对象');
    }
    let processor;
    if (definition.match && typeof definition.match === 'function') {
      processor = {
        id: definition.id || randomUUID(),
        match: definition.match
      };
    } else if (definition.regex && definition.event) {
      processor = createRegexProcessor({
        id: definition.id || randomUUID(),
        event: definition.event,
        regex: definition.regex,
        transform: definition.transform,
        filter: definition.filter
      });
    } else {
      throw new Error('解析器必须提供 match 函数或 regex+event');
    }

    this.dynamicProcessors.set(processor.id, processor);
    return processor.id;
  }

  unregisterProcessor(id) {
    if (!id) {
      return;
    }
    this.dynamicProcessors.delete(id);
  }

  tryHandleAgentLog(line) {
    if (!line.includes('[BCNC Agent]')) {
      return false;
    }
    const match = line.match(/\[BCNC Agent\]\[(?<level>[A-Z]+)\]\s*(?<message>.*)$/);
    if (!match) {
      return false;
    }
    const level = (match.groups?.level || 'INFO').toLowerCase();
    const message = match.groups?.message?.trim() || line;
    const logFn = typeof this.logger?.[level] === 'function'
      ? this.logger[level].bind(this.logger)
      : this.logger?.info?.bind(this.logger);
    if (logFn) {
      logFn(message);
    }
    return true;
  }
}

function createRegexProcessor({ id, event, regex, transform, filter }) {
  return {
    id: id || randomUUID(),
    match: (line, context) => {
      const match = regex.exec(line);
      if (!match) {
        return null;
      }
      if (filter && !filter(match, context)) {
        return null;
      }
      const data = transform ? transform(match, context) : match.groups || {};
      return {
        event,
        data
      };
    }
  };
}

