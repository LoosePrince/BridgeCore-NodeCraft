import { EventEmitter } from 'events';

export class ServerEventBus extends EventEmitter {
  emitEvent(event, payload) {
    this.emit(event, payload);
  }

  onEvent(event, handler) {
    this.on(event, handler);
    return () => this.off(event, handler);
  }

  onceEvent(event, handler) {
    this.once(event, handler);
    return () => this.off(event, handler);
  }
}

