import * as readline from 'node:readline';
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { bold, cyan, dim, green, muted, yellow } from './colors.js';

let rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

export function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export function closePrompt(): void {
  rl.close();
}

/**
 * Pause the readline interface before spawning an interactive child process.
 * This releases stdin so the child process can receive input (e.g. Enter to open browser).
 */
export function pausePrompt(): void {
  rl.close();
}

/**
 * Reset the readline interface after an interactive command took over stdin.
 * This ensures prompts work correctly after npm publish --auth-type=web.
 */
export function resetPrompt(): void {
  rl.close();
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function confirm(
  message: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? `[${bold('Y')}/n]` : `[y/${bold('N')}]`;
  const answer = await prompt(`${cyan('?')} ${message} ${hint} `);

  if (answer === '') {
    return defaultYes;
  }

  return answer.toLowerCase() === 'y';
}

export async function select<T extends string>(
  message: string,
  options: { label: string; value: T }[],
  defaultIndex = 0,
): Promise<T> {
  console.log(`${cyan('?')} ${message}`);
  console.log('');

  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIndex ? cyan('>') : ' ';
    const num = dim(`${i + 1})`);
    console.log(`  ${marker} ${num} ${options[i].label}`);
  }

  console.log('');
  const answer = await prompt(
    `  Enter choice ${dim(`[1-${options.length}]`)} ${muted(`(default: ${defaultIndex + 1})`)}: `,
  );

  if (answer === '') {
    return options[defaultIndex].value;
  }

  const index = Number.parseInt(answer, 10) - 1;
  if (index >= 0 && index < options.length) {
    return options[index].value;
  }

  console.log(yellow(`  Invalid choice. Using default: ${options[defaultIndex].label}`));
  return options[defaultIndex].value;
}

export async function multiSelect<T>(
  message: string,
  options: { label: string; value: T }[],
  allSelectedByDefault = true,
): Promise<T[]> {
  const selected = new Set<number>(
    allSelectedByDefault ? options.map((_, i) => i) : [],
  );
  let cursor = 0;

  const clearLines = (count: number) => {
    for (let i = 0; i < count; i++) {
      process.stdout.write('\x1b[A\x1b[2K');
    }
  };

  const render = (initial = false) => {
    if (!initial) {
      clearLines(options.length + 3);
    }

    console.log(`${cyan('?')} ${message}`);
    console.log('');

    for (let i = 0; i < options.length; i++) {
      const isSelected = selected.has(i);
      const isCursor = i === cursor;
      const checkbox = isSelected ? green('[x]') : dim('[ ]');
      const pointer = isCursor ? cyan('>') : ' ';
      const label = isCursor ? bold(options[i].label) : options[i].label;
      console.log(`  ${pointer} ${checkbox} ${label}`);
    }

    console.log('');
    console.log(dim('  ↑/↓ navigate • space toggle • a all • n none • enter confirm'));
  };

  return new Promise((resolve) => {
    render(true);

    // Pause readline so we can use raw mode
    rl.pause();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();

    const onKeypress = (key: Buffer) => {
      const str = key.toString();

      // Ctrl+C
      if (str === '\x03') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onKeypress);
        rl.resume();
        console.log('');
        process.exit(0);
      }

      // Enter
      if (str === '\r' || str === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onKeypress);
        rl.resume();
        console.log('');
        resolve(options.filter((_, i) => selected.has(i)).map((o) => o.value));
        return;
      }

      // Space - toggle selection
      if (str === ' ') {
        if (selected.has(cursor)) {
          selected.delete(cursor);
        } else {
          selected.add(cursor);
        }
        render();
        return;
      }

      // Up arrow
      if (str === '\x1b[A' || str === 'k') {
        cursor = cursor > 0 ? cursor - 1 : options.length - 1;
        render();
        return;
      }

      // Down arrow
      if (str === '\x1b[B' || str === 'j') {
        cursor = cursor < options.length - 1 ? cursor + 1 : 0;
        render();
        return;
      }

      // 'a' - select all
      if (str === 'a') {
        for (let i = 0; i < options.length; i++) {
          selected.add(i);
        }
        render();
        return;
      }

      // 'n' - select none
      if (str === 'n') {
        selected.clear();
        render();
        return;
      }
    };

    stdin.on('data', onKeypress);
  });
}

export function parseConfirmOrEditInput(input: string): 'yes' | 'no' | 'edit' {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'n') return 'no';
  if (normalized === 'e') return 'edit';
  return 'yes';
}

export async function confirmOrEdit(message: string): Promise<'yes' | 'no' | 'edit'> {
  const answer = await prompt(`${cyan('?')} ${message} ${dim('[')}${bold('Y')}${dim('/n/e to edit]')} `);
  return parseConfirmOrEditInput(answer);
}

/** Synchronous — blocks the event loop until the editor process exits. */
export function openInEditor(content: string): string {
  const tmpFile = join(tmpdir(), `pubz-release-notes-${Date.now()}.md`);

  try {
    writeFileSync(tmpFile, content, 'utf-8');
  } catch {
    console.warn(yellow('Warning: could not write temp file for editor. Using original notes.'));
    return content;
  }

  pausePrompt();
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? 'vi';
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
  } finally {
    resetPrompt();
  }

  if (result.error || result.status !== 0) {
    const reason = result.error
      ? `could not launch editor (${result.error.message})`
      : 'editor exited with an error';
    console.warn(yellow(`Warning: ${reason}. Using original notes.`));
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    return content;
  }

  let edited = content;
  try {
    edited = readFileSync(tmpFile, 'utf-8');
  } catch {
    console.warn(yellow('Warning: could not read edited file. Using original notes.'));
  }
  try { unlinkSync(tmpFile); } catch { /* ignore */ }
  return edited;
}
