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
const FRAME_INDENT = 3; // "│  "

/** Strip ANSI escape sequences to get visible character count. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Wrap text so each visual line fits within the terminal, preserving the frame border. */
function wrapFrameText(text: string): string[] {
  const cols = process.stdout.columns || 80;
  const maxWidth = cols - FRAME_INDENT;
  if (maxWidth <= 10) return [text]; // too narrow to bother

  const visible = stripAnsi(text);
  if (visible.length <= maxWidth) return [text];

  // Word-wrap on the visible text, then map positions back to the styled string
  const lines: string[] = [];
  let pos = 0; // position in visible text
  let styledPos = 0; // position in styled text

  while (pos < visible.length) {
    let end = pos + maxWidth;
    if (end >= visible.length) {
      // last chunk
      lines.push(text.slice(styledPos));
      break;
    }
    // try to break at a space
    let breakAt = visible.lastIndexOf(' ', end);
    if (breakAt <= pos) breakAt = end;

    // map breakAt (visible) to styledPos offset in styled string
    let visCount = 0;
    let styledEnd = styledPos;
    while (visCount < breakAt - pos && styledEnd < text.length) {
      if (text[styledEnd] === '\x1b') {
        // skip entire escape sequence
        const seqEnd = text.indexOf('m', styledEnd);
        styledEnd = seqEnd === -1 ? styledEnd + 1 : seqEnd + 1;
      } else {
        visCount++;
        styledEnd++;
      }
    }
    // include any trailing ANSI codes at the break point
    while (styledEnd < text.length && text[styledEnd] === '\x1b') {
      const seqEnd = text.indexOf('m', styledEnd);
      styledEnd = seqEnd === -1 ? styledEnd + 1 : seqEnd + 1;
    }

    lines.push(text.slice(styledPos, styledEnd));
    pos = breakAt;
    styledPos = styledEnd;
    // skip the space we broke on
    if (visible[pos] === ' ') {
      pos++;
      if (styledPos < text.length && text[styledPos] === ' ') styledPos++;
    }
  }

  return lines;
}

export function frameHeader(title: string): void {
  const inner = `─ ${title} `;
  const padding = '─'.repeat(Math.max(2, FRAME_WIDTH - inner.length));
  console.log(dim(`┌${inner}${padding}`));
}

export function frameFooter(): void {
  console.log(dim(`└${'─'.repeat(FRAME_WIDTH)}`));
}

export function frameLine(text = ''): void {
  if (text === '') {
    console.log(dim('│'));
  } else {
    const lines = wrapFrameText(text);
    for (const line of lines) {
      console.log(dim('│') + '  ' + line);
    }
  }
}
