import { VanillaServerHandler } from './vanilla.js';
import { ForgeServerHandler } from './forge.js';

const handlerRegistry = new Map();
handlerRegistry.set('vanilla', VanillaServerHandler);
handlerRegistry.set('forge', ForgeServerHandler);

export function registerServerHandler(name, handlerClass) {
  if (!name || typeof handlerClass !== 'function') {
    throw new Error('注册 handler 需要名称和处理器类');
  }
  handlerRegistry.set(name.toLowerCase(), handlerClass);
}

export function createServerHandler(name, options = {}) {
  const key = (name || 'vanilla').toLowerCase();
  const HandlerClass = handlerRegistry.get(key) || handlerRegistry.get('vanilla');
  return new HandlerClass(options);
}

export function listServerHandlers() {
  return Array.from(handlerRegistry.keys());
}

