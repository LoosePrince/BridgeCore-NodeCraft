export class BaseServerHandler {
  constructor({ logger, eventBus } = {}) {
    this.logger = logger;
    this.eventBus = eventBus;
    this.id = 'base';
    this.name = 'Base Handler';
    this.description = '默认基础处理器';
  }

  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  getDescription() {
    return this.description;
  }

  getProcessors() {
    return [];
  }

  dispose() {}
}

