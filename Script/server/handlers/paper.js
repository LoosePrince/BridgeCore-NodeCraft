import { randomUUID } from 'crypto';
import { BaseServerHandler } from './base.js';

// Paper 日志格式: [时间 INFO]: 消息 (没有线程部分，聊天消息可能有 [Not Secure] 前缀)
const CHAT_REGEX = /^\[(?<time>.+?) INFO\]: (?:\[Not Secure\] )?<(?<player>[^>]+)> (?<message>.+)$/;
const JOIN_REGEX = /^\[(?<time>.+?) INFO\]: (?<player>.+) joined the game$/;
const LEAVE_REGEX = /^\[(?<time>.+?) INFO\]: (?<player>.+) left the game$/;
const DEATH_REGEX = /^\[(?<time>.+?) INFO\]: (?<message>.+)$/;
const ADVANCEMENT_REGEX = /^\[(?<time>.+?) INFO\]: (?<player>.+) has (made the advancement|completed the challenge|reached the goal) \[(?<advancement>.+)\]$/;
const SERVER_READY_REGEX = /^\[(?<time>.+?) INFO\]: Done \((?<duration>[\d.]+)s\)! For help, type "help"$/;

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

export class PaperServerHandler extends BaseServerHandler {
  constructor(options = {}) {
    super(options);
    this.id = 'paper';
    this.name = 'Paper Handler';
    this.description = '适配 Paper 日志格式的解析器';
    this.processors = [
      createRegexProcessor({
        id: 'chat',
        event: 'server:chat',
        regex: CHAT_REGEX,
        transform: (match) => ({
          player: match.groups.player,
          message: match.groups.message,
          time: match.groups.time
        })
      }),
      createRegexProcessor({
        id: 'player_join',
        event: 'player:join',
        regex: JOIN_REGEX,
        transform: (match) => ({
          player: match.groups.player.trim(),
          time: match.groups.time
        })
      }),
      createRegexProcessor({
        id: 'player_leave',
        event: 'player:leave',
        regex: LEAVE_REGEX,
        transform: (match) => ({
          player: match.groups.player.trim(),
          time: match.groups.time
        })
      }),
      createRegexProcessor({
        id: 'player_death',
        event: 'player:death',
        regex: DEATH_REGEX,
        filter: (match) => {
          const message = match.groups.message.toLowerCase();
          return (
            message.includes(' was ') ||
            message.includes(' died') ||
            message.includes(' fell') ||
            message.includes(' slain') ||
            message.includes(' shot')
          );
        },
        transform: (match) => ({
          message: match.groups.message.trim(),
          time: match.groups.time
        })
      }),
      createRegexProcessor({
        id: 'player_advancement',
        event: 'player:advancement',
        regex: ADVANCEMENT_REGEX,
        transform: (match) => ({
          player: match.groups.player.trim(),
          advancement: match.groups.advancement,
          category: match[2],
          time: match.groups.time
        })
      }),
      createRegexProcessor({
        id: 'server_ready',
        event: 'server:ready',
        regex: SERVER_READY_REGEX,
        transform: (match) => ({
          duration: match.groups.duration,
          time: match.groups.time
        })
      })
    ];
  }

  getProcessors() {
    return this.processors;
  }
}

