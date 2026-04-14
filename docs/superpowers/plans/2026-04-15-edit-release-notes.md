# Edit Release Notes in Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users press `e` after release notes are shown to open them in `$VISUAL`/`$EDITOR`/`vi`, edit, and use the result immediately — regardless of whether AI or plain commit list generated the notes.

**Architecture:** Two new exported functions in `src/prompts.ts` (`parseConfirmOrEditInput` + `confirmOrEdit` + `openInEditor`), plus a single insertion point in `src/cli.ts` after `releaseNotes` is finalized. The input-parsing logic is extracted as a pure, exported helper so it can be unit-tested independently of IO.

**Tech Stack:** Bun, TypeScript, Node built-ins (`os`, `fs`, `child_process`)

---

### Task 1: Add `parseConfirmOrEditInput` to prompts.ts and test it

**Files:**
- Modify: `src/prompts.ts`
- Create: `tests/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/prompts.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { parseConfirmOrEditInput } from '../src/prompts.js';

describe('parseConfirmOrEditInput', () => {
  it('returns yes for empty string (default)', () => {
    expect(parseConfirmOrEditInput('')).toBe('yes');
  });

  it('returns yes for "y"', () => {
    expect(parseConfirmOrEditInput('y')).toBe('yes');
  });

  it('returns yes for "Y"', () => {
    expect(parseConfirmOrEditInput('Y')).toBe('yes');
  });

  it('returns no for "n"', () => {
    expect(parseConfirmOrEditInput('n')).toBe('no');
  });

  it('returns no for "N"', () => {
    expect(parseConfirmOrEditInput('N')).toBe('no');
  });

  it('returns edit for "e"', () => {
    expect(parseConfirmOrEditInput('e')).toBe('edit');
  });

  it('returns edit for "E"', () => {
    expect(parseConfirmOrEditInput('E')).toBe('edit');
  });

  it('returns yes for any unrecognised input', () => {
    expect(parseConfirmOrEditInput('x')).toBe('yes');
    expect(parseConfirmOrEditInput('foo')).toBe('yes');
    expect(parseConfirmOrEditInput('  ')).toBe('yes');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && bun test tests/prompts.test.ts
```

Expected: error — `parseConfirmOrEditInput` is not exported from `../src/prompts.js`.

- [ ] **Step 3: Add `parseConfirmOrEditInput` to `src/prompts.ts`**

Add this export at the bottom of `src/prompts.ts` (before the closing of the file):

```ts
export function parseConfirmOrEditInput(input: string): 'yes' | 'no' | 'edit' {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'n') return 'no';
  if (normalized === 'e') return 'edit';
  return 'yes';
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && bun test tests/prompts.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && git add src/prompts.ts tests/prompts.test.ts && git commit -m "feat: add parseConfirmOrEditInput helper with tests"
```

---

### Task 2: Add `confirmOrEdit` and `openInEditor` to `src/prompts.ts`

**Files:**
- Modify: `src/prompts.ts`

(These functions are IO-bound — spawning an editor, reading temp files — so they are not unit-tested. The core input-parsing logic is already covered by Task 1.)

- [ ] **Step 1: Add the two new imports at the top of `src/prompts.ts`**

`src/prompts.ts` currently imports only `readline` and colors. Add the Node built-ins needed:

```ts
import { tmpdir } from 'node:os';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
```

Add these lines directly after the existing `import * as readline from 'node:readline';` line at the top of the file.

- [ ] **Step 2: Add `confirmOrEdit` to `src/prompts.ts`**

Add after `parseConfirmOrEditInput`:

```ts
export async function confirmOrEdit(message: string): Promise<'yes' | 'no' | 'edit'> {
  const answer = await prompt(`${cyan('?')} ${message} ${dim('[Y/n/e to edit]')} `);
  return parseConfirmOrEditInput(answer);
}
```

- [ ] **Step 3: Add `openInEditor` to `src/prompts.ts`**

Add after `confirmOrEdit`:

```ts
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
  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });
  resetPrompt();

  if (result.status !== 0) {
    console.warn(yellow('Warning: editor exited with an error. Using original notes.'));
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
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && git add src/prompts.ts && git commit -m "feat: add confirmOrEdit and openInEditor to prompts"
```

---

### Task 3: Wire the edit prompt into `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Import the two new functions in `src/cli.ts`**

Find the existing import line (line 19):

```ts
import { closePrompt, confirm, multiSelect, pausePrompt, prompt, resetPrompt, select } from './prompts.js';
```

Replace it with:

```ts
import { closePrompt, confirm, confirmOrEdit, multiSelect, openInEditor, pausePrompt, prompt, resetPrompt, select } from './prompts.js';
```

- [ ] **Step 2: Insert the unified edit prompt after `releaseNotes` is finalized**

In `src/cli.ts`, find the closing brace of the AI release notes block. It looks like this (around line 639):

```ts
      frameFooter();
      console.log('');
    }
  }
}

const errors: string[] = [];
```

The outer `}` on the line just before `const errors` closes the `if (changelog.commits.length > 0)` block. Insert the edit prompt between that closing brace and `const errors`:

```ts
      frameFooter();
      console.log('');
    }
  }
}

if (releaseNotes && !skipConfirms) {
  const choice = await confirmOrEdit('Use these release notes?');
  if (choice === 'no') releaseNotes = '';
  else if (choice === 'edit') releaseNotes = openInEditor(releaseNotes);
  console.log('');
}

const errors: string[] = [];
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run existing tests to confirm no regressions**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && bun test
```

Expected: same pass/fail counts as before (33 pass, 17 fail — the 17 pre-existing failures are unrelated to this change).

- [ ] **Step 5: Commit**

```bash
cd /Users/z/.local/share/deer/tasks/pubz/deer_mnz8rk712f264o3u/worktree && git add src/cli.ts && git commit -m "feat: add edit-in-editor prompt for release notes"
```
