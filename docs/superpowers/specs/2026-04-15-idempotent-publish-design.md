# Idempotent Publish

Make `pubz publish` safe to re-run after a partial failure. Each step checks whether its work is already done for the target version before executing. No state files — each check queries the actual source of truth (npm registry, git, GitHub).

## Problem

If a publish fails partway through (e.g., npm publish fails for one package, network drops during git push), re-running `pubz publish` with the same version fails because earlier steps already completed. The user must manually undo or skip steps to recover.

## Design

### Principle

Every mutating step gets an idempotency guard: check whether the work is already done, skip if yes, execute if no. A re-run with the same version converges to the desired end state regardless of where the previous run failed.

If the user changes the version, it's treated as a new publish — all checks will see the new version as unpublished and proceed normally.

### Step-by-step changes

#### 1. Version bump (cli.ts, version bump section)

**Current:** Always writes `newVersion` to all `package.json` files and commits.

**Change:** Before bumping, read the first package's current version from disk. If it already equals `newVersion`, skip the entire bump block (including `updatePackageVersion`, `updateLocalDependencyVersions`, and `commitVersionBump`). Log: `⏭ Version already set to {version}, skipping bump`.

#### 2. Git commit (publish.ts:commitVersionBump)

**Already idempotent.** Checks `git status --porcelain` and returns success if nothing to commit. No change needed.

#### 3. Build

**No change.** Always re-runs. Cheap and ensures build artifacts match current source.

#### 4. npm publish (publish.ts + cli.ts publish loop)

**New function** in `publish.ts`:

```typescript
export async function isVersionPublished(
  packageName: string,
  version: string,
  registry: string,
): Promise<boolean>
```

Runs `npm view {name}@{version} version --registry {registry}` silently. Returns `true` if the command succeeds and outputs a matching version string.

**Change in cli.ts publish loop:** Before calling `publishPackage` for each package, call `isVersionPublished`. If already published, log `⏭ {name}@{version} already published, skipping` and continue to next package.

#### 5. Git tag (publish.ts:createGitTag)

**Current:** Runs `git tag {tagName}`, fails if tag exists.

**Change:** Before creating, run `git tag -l {tagName}`. If output is non-empty, the tag already exists — return success. Log: `⏭ Tag {tagName} already exists, skipping`.

#### 6. Git push (publish.ts:pushGitTag)

**Already idempotent.** `git push` when up-to-date is a no-op. `git push origin {tag}` when the tag is already on remote says "Everything up-to-date". No change needed.

#### 7. GitHub release (changelog.ts:createGitHubRelease)

**Current:** Runs `gh release create`, fails if release exists.

**Change:** Before creating, run `gh release view {tagName}`. If exit code 0, the release already exists — return success with the URL from the output. Log: `⏭ GitHub release for {tagName} already exists, skipping`.

### Logging

When a step is skipped due to idempotency, log a clear message so the user understands what happened. Use the existing `dim`/`muted` styling with `⏭` prefix.

### What stays the same

- Overall orchestration flow in `cli.ts` unchanged
- Dry-run behavior unchanged
- Workspace protocol transform/restore unchanged (temporary, always restored in `finally`)
- Auth checking unchanged
- Changelog generation unchanged (read-only)
- Package discovery, selection, and dependency ordering unchanged

### Files to modify

| File | Change |
|------|--------|
| `src/publish.ts` | Add `isVersionPublished()`, update `createGitTag()` to check before creating |
| `src/changelog.ts` | Update `createGitHubRelease()` to check before creating |
| `src/cli.ts` | Skip version bump if already at target version, call `isVersionPublished` before each `publishPackage` |
