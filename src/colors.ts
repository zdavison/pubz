const isColorSupported =
  process.env.FORCE_COLOR !== '0' &&
  (process.env.FORCE_COLOR !== undefined ||
    (process.stdout.isTTY && process.env.TERM !== 'dumb'));

const fmt = (open: string, close: string) => {
  if (!isColorSupported) {
    return (str: string) => str;
  }
  return (str: string) => `\x1b[${open}m${str}\x1b[${close}m`;
};

export const bold = fmt('1', '22');
export const dim = fmt('2', '22');
export const italic = fmt('3', '23');
export const underline = fmt('4', '24');

export const red = fmt('31', '39');
export const green = fmt('32', '39');
export const yellow = fmt('33', '39');
export const blue = fmt('34', '39');
export const magenta = fmt('35', '39');
export const cyan = fmt('36', '39');
export const white = fmt('37', '39');
export const gray = fmt('90', '39');

export const bgRed = fmt('41', '49');
export const bgGreen = fmt('42', '49');
export const bgYellow = fmt('43', '49');
export const bgBlue = fmt('44', '49');

// Semantic colors for CLI
export const success = green;
export const error = red;
export const warning = yellow;
export const info = cyan;
export const highlight = bold;
export const muted = gray;

// Frame helpers for structured CLI output
const FRAME_WIDTH = 52;

export function frameHeader(title: string): void {
  const inner = `─ ${title} `;
  const padding = '─'.repeat(Math.max(2, FRAME_WIDTH - inner.length));
  console.log(dim(`┌${inner}${padding}`));
}

export function frameFooter(): void {
  console.log(dim(`└${'─'.repeat(FRAME_WIDTH)}`));
}

export function frameLine(text = ''): void {
  console.log('  ' + text);
}
