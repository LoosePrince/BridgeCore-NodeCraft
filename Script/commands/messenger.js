import { buildTextComponent, componentToConsole } from '../utils/text-component.js';

const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

function stripAnsi(input = '') {
  return input.replace(ANSI_REGEX, '');
}

export class Messenger {
  constructor({ logger, serverManager }) {
    this.logger = logger;
    this.serverManager = serverManager;
  }

  async sendToPlayer(player, message, options = {}) {
    if (!player || !this.serverManager?.sendCommand || !this.serverManager?.isRunning?.()) {
      return false;
    }
    try {
      const component = buildTextComponent(message, options.style);
      const command = `tellraw ${player} ${JSON.stringify(component)}`;
      this.serverManager.sendCommand(command);
      return true;
    } catch (error) {
      if (!options.silent) {
        this.logger?.warn(`向玩家 ${player} 发送消息失败: ${error.message}`);
      }
      return false;
    }
  }

  async reply(context, message, options = {}) {
    const level = options.level || 'info';
    const component = buildTextComponent(message, options.style);

    if (context?.source === 'player' && context.player) {
      const shouldEcho = options.echo === true;
      const success = await this.sendToPlayer(context.player, component, options);
      const fallbackEcho = options.echoFallback === true;
      if (shouldEcho || (!success && fallbackEcho)) {
        const consoleText = componentToConsole([{ text: `[${context.player}] `, color: 'gray' }, component]);
        this.logger?.[level]?.(consoleText);
      }
      return;
    }

    const consoleText = componentToConsole(component);
    this.logger?.[level]?.(consoleText);
  }

  async forwardLog(context, entry) {
    if (context?.source !== 'player' || !context.player) {
      return;
    }

    const cleanMessage = stripAnsi(entry.message || '');
    if (!cleanMessage) {
      return;
    }

    const color = {
      debug: 'gray',
      info: 'white',
      warn: 'yellow',
      error: 'red'
    }[entry.level] || 'white';
    await this.sendToPlayer(
      context.player,
      { text: cleanMessage, color },
      { style: { color }, silent: true, echo: false }
    );
  }
}

