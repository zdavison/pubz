# Plan: Multi-Ecosystem Support

Expand pubz from npm-only to a general-purpose release tool supporting multiple package ecosystems via an adapter abstraction.

**Status**: Not started

---

## Background

pubz currently hardcodes npm throughout: package discovery via `package.json`, workspace protocol via `workspace:*`, publishing via `npm publish`, auth via `npm whoami`. The git operations, changelog, AI release notes, and GitHub release creation are already ecosystem-agnostic.

The goal is to introduce an `EcosystemAdapter` interface that encapsulates all ecosystem-specific behavior, so `cli.ts` can orchestrate any ecosystem through a single contract.

---

## Part A: Adapter Abstraction

### Prerequisite — `src/toml.ts`

Bun provides `Bun.TOML.parse` for reads but no stringify. TOML writes use targeted regex mutation to preserve comments and formatting.

Primitives:
- `setTOMLField(content: string, sectionPath: string[], key: string, newValue: string): string` — section-aware value replacement
- `replaceTOMLDependencyLine(content: string, depName: string, newSpec: string): string` — targeted per-dep-line replacement

Tests in `tests/toml.test.ts`:
- `setTOMLField` targets `[package].version` without touching `[workspace.package].version`
- Preserves comments and whitespace
- Round-trip parse → mutate → parse gives consistent result

### Phase 1 — Parameterize `src/glob.ts`

Add `manifestFile = 'package.json'` default parameter so non-npm adapters can discover workspace members by their own manifest filename.

```ts
// Before
export async function glob(pattern: string, cwd: string): Promise<string[]>

// After
export async function glob(pattern: string, cwd: string, manifestFile = 'package.json'): Promise<string[]>
```

No existing callers change — they pass two args and get the default.

### Phase 2 — Define `EcosystemAdapter` interface (`src/ecosystem.ts`)

```ts
interface EcosystemAdapter {
  /** Human-readable name for UI display, e.g. "npm", "Cargo", "Python/uv". */
  readonly name: string

  // --- Discovery ---

  /** Return manifest path if this ecosystem is present in cwd, null otherwise. */
  detectManifest(cwd: string): Promise<string | null>

  /** Return absolute paths to all workspace member directories. */
  discoverWorkspaceMembers(cwd: string, manifestPath: string): Promise<string[]>

  /** Read package name and version from a member directory. */
  readNameVersion(packageDir: string): Promise<{ name: string; version: string; manifestPath: string }>

  /** True if this package should be excluded from publishing by default. */
  isPrivate(packageDir: string, manifestPath: string): Promise<boolean>

  /** Names of local workspace dependencies declared by this package. */
  findLocalDependencies(
    packageDir: string,
    manifestPath: string,
    workspacePackageNames: Set<string>,
  ): Promise<string[]>

  // --- Versioning ---

  /** Write a new version into the manifest. Must preserve all other content. */
  writeVersion(pkg: DiscoveredPackage, newVersion: string, dryRun: boolean): Promise<void>

  /** Update hard-coded inter-package dep version refs (non-workspace-protocol). */
  updateLocalDepVersions(packages: DiscoveredPackage[], newVersion: string, dryRun: boolean): Promise<void>

  // --- Workspace protocol lock/unlock ---
  // Called in try/finally around publish. Transforms workspace refs to pinned versions
  // before publish and restores them after, even on failure.

  lockWorkspaceDeps(packages: DiscoveredPackage[], newVersion: string, dryRun: boolean): Promise<WorkspaceTransform[]>
  unlockWorkspaceDeps(transforms: WorkspaceTransform[]): Promise<void>

  // --- Auth ---

  checkAuth(registry: string): Promise<AuthResult>
  login(registry: string): Promise<LoginResult>

  // --- Build + Publish ---

  build(cwd: string, dryRun: boolean): Promise<BuildResult>
  verifyBuild(pkg: DiscoveredPackage): Promise<BuildResult>
  publish(pkg: DiscoveredPackage, registry: string, context: PublishContext, dryRun: boolean): Promise<PublishResult>

  // --- Registry UI ---

  getRegistryChoices(): RegistryChoice[]
  defaultRegistry(): string
}

interface WorkspaceTransform {
  manifestPath: string
  /** Full original file content — used to restore exactly, preserving formatting. */
  original: string
  description: string
}
```

### Phase 3 — npm adapter (`src/adapters/npm.ts`)

Pure extraction refactor. Move all npm-specific logic from `discovery.ts`, `version.ts`, `publish.ts`, `auth.ts` into the adapter. Existing module-level functions stay where they are; the adapter delegates to them. Zero behavior change for existing users.

### Phase 6 — Auto-detection (`src/detect.ts`)

```ts
export async function detectEcosystem(cwd: string): Promise<'npm' | 'cargo' | 'python'>
```

Detection order:
1. `.pubz` `ecosystem=` key (explicit override)
2. `Cargo.toml` present → `'cargo'`
3. `pyproject.toml` present → `'python'`
4. `package.json` present → `'npm'`
5. Default: `'npm'`

Add `ecosystem` key to `PubzConfig` and `VALID_KEYS` in `config.ts`.

### Phase 7 — Wire into `cli.ts`

- Call `detectEcosystem(cwd)` early in `main()`
- Instantiate the correct adapter
- Replace all direct calls to discovery/version/publish/auth functions with adapter method calls

**What does NOT change in `cli.ts`**: git commit, git tag/push, changelog generation, AI release notes, GitHub release creation, all prompt UI, dry-run handling.

### `src/types.ts` changes

- Rename `packageJsonPath` → `manifestPath` on `DiscoveredPackage`
- Add `ecosystem: 'npm' | 'cargo' | 'python'` to `DiscoveredPackage`

---

## Part B: Python / uv / PyPI Adapter (`src/adapters/python.ts`)

| Concern        | Detail                                                              |
|----------------|---------------------------------------------------------------------|
| Manifest       | `pyproject.toml`                                                    |
| Workspaces     | `[tool.uv.workspace].members` globs                                 |
| Version field  | `[project].version`                                                 |
| Dependencies   | `[project.dependencies]` — PEP 508 strings                          |
| Workspace deps | `[tool.uv.sources]: pkg = { workspace = true }`                     |
| Build          | `uv build` (produces `dist/*.whl`)                                  |
| Publish        | `uv publish`                                                        |
| Auth           | `UV_PUBLISH_TOKEN` env var or `~/.pypirc`                           |
| Registries     | PyPI (`https://upload.pypi.org/legacy/`), TestPyPI                  |

### Workspace lock/unlock (most complex transform)

Before publish, two things change atomically:
1. `[tool.uv.sources]` entry `pkg-a = { workspace = true }` is removed
2. `[project.dependencies]` entry `"pkg-a"` becomes `"pkg-a>=1.2.3"`

Both are restored from `WorkspaceTransform.original` (full file content) after publish.

### Gotchas

- **PEP 503 normalization**: `my-pkg`, `my_pkg`, `My.Package` are equivalent. Normalize with `name.toLowerCase().replace(/[-_.]+/g, '-')` before comparing to workspace member names.
- **Marker expressions**: PEP 508 deps can include `; python_version >= "3.8"`. Name extraction regex must not consume the marker.
- **uv publish needs pre-built artifacts**: Unlike npm (which packs on the fly), `uv publish` uploads whatever is in `dist/`. `verifyBuild` must confirm `dist/*.whl` exists. Warn loudly if `--skip-build` is used with the Python adapter.
- **No `private` equivalent**: `isPrivate` always returns false. Exclusion is handled via `.pubz skip-publish`.
- **Dynamic versioning** (`version = {attr = "..."}`) is not supported — produce a clear error.

---

## Part C: Rust / Cargo / crates.io Adapter (`src/adapters/cargo.ts`)

| Concern        | Detail                                                              |
|----------------|---------------------------------------------------------------------|
| Manifest       | `Cargo.toml`                                                        |
| Workspaces     | `[workspace].members` globs                                         |
| Version field  | `[package].version`                                                 |
| Dependencies   | `[dependencies]` — string or inline table                           |
| Workspace deps | `dep = { workspace = true }`                                        |
| Build          | `cargo build --release` (or skip — crates.io builds from source)   |
| Publish        | `cargo publish --allow-dirty`                                       |
| Auth           | `CARGO_REGISTRY_TOKEN` env var or `~/.cargo/credentials.toml`      |
| Registries     | crates.io (`crates-io`)                                             |

### Workspace lock/unlock

`{ workspace = true }` → `{ version = "X.Y.Z" }` and back. Store full original file content in `WorkspaceTransform.original`.

### Gotchas

- **crates.io index propagation delay**: After publishing a crate, the index takes ~15–30s to update before dependents can declare it as a dep. Add a configurable inter-package delay, or document `cargo publish --no-verify` for CI. This is the most significant operational concern for Cargo.
- **`--allow-dirty` required**: `lockWorkspaceDeps` modifies `Cargo.toml` files without committing. Without this flag, `cargo publish` refuses to run when there are uncommitted changes.
- **Root `Cargo.toml` has no `[package]`**: Workspace root is workspace-only. `readNameVersion` should return null / throw for it. The root crate is rarely published.
- **Feature flags must be preserved**: `{ version = "1.0", features = ["derive"] }` — only the `version` portion is replaced; features and other fields stay.
- **Path deps are NOT transformed**: `{ path = "../other-crate" }` is a local dep that cargo handles separately. Only `{ workspace = true }` entries are pinned.
- **Edition and MSRV inheritance**: Members may inherit `edition` and `rust-version` from `[workspace.package]`. `writeVersion` must target only the `[package]` section of the specific member file.

---

## Implementation Phases (in order)

Phases 4 and 5 (Cargo and Python adapters) are independent and can be done in parallel.

```
Phase 0  src/toml.ts                      TOML read/write utilities
Phase 1  src/glob.ts                      Add manifestFile parameter
Phase 2  src/ecosystem.ts                 EcosystemAdapter interface
Phase 3  src/adapters/npm.ts              npm adapter (extract existing logic)
Phase 4  src/adapters/cargo.ts            Cargo adapter
Phase 5  src/adapters/python.ts           Python adapter
Phase 6  src/detect.ts                    detectEcosystem()
Phase 7  src/cli.ts, types.ts, config.ts  Wire adapters in
Phase 8  tests/                           Tests (written before each phase, TDD)
```

---

## New Files

| File                               | Purpose                                      |
|------------------------------------|----------------------------------------------|
| `src/toml.ts`                      | TOML read/targeted-write utilities           |
| `src/ecosystem.ts`                 | `EcosystemAdapter` interface + result types  |
| `src/detect.ts`                    | `detectEcosystem()` auto-detection           |
| `src/adapters/npm.ts`              | npm adapter                                  |
| `src/adapters/cargo.ts`            | Cargo/crates.io adapter                      |
| `src/adapters/python.ts`           | uv/PyPI adapter                              |
| `tests/toml.test.ts`               | TOML utility unit tests                      |
| `tests/cargo-adapter.test.ts`      | Cargo adapter integration tests              |
| `tests/python-adapter.test.ts`     | Python adapter integration tests             |
| `tests/ecosystem-detect.test.ts`   | Auto-detection unit tests                    |
| `tests/fixtures/workspace-cargo/`  | Cargo fixture (root + 2 crates, one dep)     |
| `tests/fixtures/workspace-python/` | Python fixture (root + 2 packages, one dep)  |
| `tests/helpers/mock-cargo.ts`      | Mock cargo command recorder                  |
| `tests/helpers/mock-uv.ts`         | Mock uv command recorder                     |

## Modified Files

| File                       | Changes                                                              |
|----------------------------|----------------------------------------------------------------------|
| `src/types.ts`             | `packageJsonPath` → `manifestPath`, add `ecosystem` to `DiscoveredPackage` |
| `src/config.ts`            | Add `ecosystem` to `PubzConfig` and `VALID_KEYS`                    |
| `src/glob.ts`              | Add `manifestFile = 'package.json'` default parameter               |
| `src/cli.ts`               | Add adapter detection/instantiation; replace direct calls with adapter calls |
| `tests/helpers/workspace.ts` | Extend for multi-ecosystem fixture setup                           |

---

## Test Strategy

Follow the existing pattern: integration-style tests run the compiled CLI against temp-dir copies of fixture workspaces, with mock executables injected via env vars (`PUBZ_CARGO_COMMAND`, `PUBZ_UV_COMMAND` — mirroring `PUBZ_NPM_COMMAND`).

### Key assertions per adapter

**Cargo**:
- Workspace discovery finds both crates from `[workspace].members`
- `lockWorkspaceDeps` replaces `{ workspace = true }` before cargo is called
- `unlockWorkspaceDeps` restores original content — even when publish fails
- Version bump writes to `[package]`, not `[workspace]`
- Topological order is preserved (dependency published before dependent)

**Python**:
- Workspace discovery finds packages from `[tool.uv.workspace].members`
- PEP 503 normalization: `my-pkg` matches `my_pkg` in dep list
- `lockWorkspaceDeps` updates both `[tool.uv.sources]` entry and `project.dependencies` string
- `unlockWorkspaceDeps` restores both — even when publish fails
- `verifyBuild` fails when `dist/` has no `.whl` file

**Backward compat**:
- A directory with only `package.json` behaves identically to before — uses npm adapter, calls `PUBZ_NPM_COMMAND`, no TOML parsing attempted
