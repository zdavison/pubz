# Edit Release Notes in Editor — Design

**Date:** 2026-04-15

## Summary

Allow users to press `e` after release notes are generated (AI or plain commit list) to open them in their preferred editor (`$VISUAL`/`$EDITOR`/`vi`) before they are used for a GitHub release. Follows the same UX pattern as `git commit -e`.

## User Flow

```
generate changelog (markdown + terminal display)
→ if AI available: ask "Generate with AI? [Y/n]" (simple yes/no, unchanged)
  → if yes: generate, display in frame, set releaseNotes = aiNotes
→ if releaseNotes && !skipConfirms:
    "Use these release notes? [Y/n/e to edit]"
    → Y / enter  → use as-is
    → n          → releaseNotes = '' (no GitHub release body)
    → e          → open in editor, read back, use immediately (no second confirm)
→ CI / --yes path: skip prompt, use whatever is set (unchanged)
```

## Components

### `confirmOrEdit(message)` — `src/prompts.ts`

New exported function.

```ts
export async function confirmOrEdit(message: string): Promise<'yes' | 'no' | 'edit'>
```

- Prints: `? <message> [Y/n/e to edit]`
- Reads one line via existing `prompt()`.
- Maps: `''` | `'y'` → `'yes'`; `'n'` → `'no'`; `'e'` → `'edit'`; anything else → `'yes'` (default-yes).

### `openInEditor(content)` — `src/prompts.ts`

New exported function.

```ts
export function openInEditor(content: string): string
```

Steps:
1. Write `content` to `os.tmpdir() + '/pubz-release-notes-<timestamp>.md'`
2. `pausePrompt()` — release stdin
3. Resolve editor: `process.env.VISUAL ?? process.env.EDITOR ?? 'vi'`
4. `spawnSync(editor, [tmpFile], { stdio: 'inherit' })` — blocks until user saves and quits
5. `resetPrompt()` — reclaim stdin
6. Read temp file, delete it, return content

### CLI integration — `src/cli.ts`

After `releaseNotes` is finalized (end of the AI section, ~line 639), insert:

```ts
if (releaseNotes && !skipConfirms) {
  const choice = await confirmOrEdit('Use these release notes?');
  if (choice === 'no') releaseNotes = '';
  else if (choice === 'edit') releaseNotes = openInEditor(releaseNotes);
}
```

The AI `confirm('Generate release notes with AI (claude)?')` remains a simple yes/no — no change there.

## Error Handling

- If the editor exits with a non-zero code, log a warning and fall back to the pre-edit content (don't crash the publish flow).
- If the temp file cannot be written, log a warning and skip the edit step.

## Out of Scope

- Raw-mode single-keypress input (Enter is required, consistent with all other prompts).
- Showing a diff of changes made in the editor.
- Saving the edited notes anywhere other than the in-memory `releaseNotes` variable.
