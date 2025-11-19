import chalk from 'chalk';

const COLOR_MAP = {
  black: chalk.hex('#000000'),
  dark_blue: chalk.hex('#0000AA'),
  dark_green: chalk.hex('#00AA00'),
  dark_aqua: chalk.hex('#00AAAA'),
  dark_red: chalk.hex('#AA0000'),
  dark_purple: chalk.hex('#AA00AA'),
  gold: chalk.hex('#FFAA00'),
  gray: chalk.hex('#AAAAAA'),
  dark_gray: chalk.hex('#555555'),
  blue: chalk.hex('#5555FF'),
  green: chalk.hex('#55FF55'),
  aqua: chalk.hex('#55FFFF'),
  red: chalk.hex('#FF5555'),
  light_purple: chalk.hex('#FF55FF'),
  yellow: chalk.hex('#FFFF55'),
  white: chalk.hex('#FFFFFF')
};

const STYLE_MAP = {
  bold: 'bold',
  italic: 'italic',
  underlined: 'underline',
  strikethrough: 'strikethrough',
  obfuscated: 'inverse'
};

function normalizeSegment(segment, baseStyle = {}) {
  if (segment == null) {
    return { text: '', ...baseStyle };
  }

  if (typeof segment === 'string') {
    return {
      ...baseStyle,
      text: segment
    };
  }

  if (Array.isArray(segment)) {
    const normalized = {
      ...baseStyle,
      text: ''
    };
    const extras = segment.map((child) => normalizeSegment(child));
    if (extras.length > 0) {
      normalized.extra = extras;
    }
    return normalized;
  }

  const { text = '', extra, ...rest } = segment;
  const normalized = {
    ...baseStyle,
    ...rest,
    text
  };

  if (Array.isArray(extra) && extra.length > 0) {
    normalized.extra = extra.map((child) => normalizeSegment(child));
  }

  return normalized;
}

export function buildTextComponent(input, baseStyle = {}) {
  return normalizeSegment(input, baseStyle);
}

export function stringifyTextComponent(input, baseStyle = {}) {
  const component = buildTextComponent(input, baseStyle);
  return JSON.stringify(component);
}

export function extractPlainText(input) {
  if (input == null) {
    return '';
  }
  if (typeof input === 'string') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map(extractPlainText).join('');
  }
  if (typeof input === 'object') {
    const text = input.text ? String(input.text) : '';
    const extras = Array.isArray(input.extra) ? input.extra.map(extractPlainText).join('') : '';
    return text + extras;
  }
  return String(input);
}

export function componentToConsole(input, baseStyle = {}) {
  const component = buildTextComponent(input, baseStyle);
  const parts = [];

  function applyStyles(text, node) {
    let styler = node.color && COLOR_MAP[node.color.toLowerCase()]
      ? COLOR_MAP[node.color.toLowerCase()]
      : chalk.white;
    Object.entries(STYLE_MAP).forEach(([key, chalkMethod]) => {
      if (node[key] && typeof styler[chalkMethod] === 'function') {
        styler = styler[chalkMethod];
      }
    });
    return styler(text);
  }

  function walk(node) {
    if (node.text) {
      parts.push(applyStyles(node.text, node));
    }
    if (Array.isArray(node.extra)) {
      node.extra.forEach(walk);
    }
  }

  walk(component);
  return parts.join('');
}

