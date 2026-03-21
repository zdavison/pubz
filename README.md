# `pubz`

<img width="1024" height="1024" alt="image" src="https://github.com/user-attachments/assets/11ffa33c-e895-4a7d-b2c3-dfadde8dd124" />

---

```bash
bunx pubz
```

`pubz` publishes multiple packages in one command, with some useful steps:

1. Discovers all publishable packages (supports monorepos)
2. Sorts packages by dependency order
3. Prompts you to select which packages to publish
4. Prompts you to bump version number of packages
5. Updates inter-package dependency versions
6. Commits version changes
7. Prompts you for where you want to publish (e.g. `npm` or private registry)
8. Builds packages
9. Transforms `workspace:` definitions to hard version numbers (so `npm` can be used for publishing with OIDC support).
10. Publishes to npm
11. Prompts you to create a `git tag` and push it
12. Generates a changelog and creates a GitHub Release

## Options

| Flag                   | Description                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `--dry-run`            | Show what would be published without actually publishing                 |
| `--registry <url>`     | Specify npm registry URL (default: public npm)                           |
| `--otp <code>`         | One-time password for 2FA                                                |
| `--skip-build`         | Skip the build step                                                      |
| `--yes`, `-y`          | Skip yes/no confirmation prompts (still asks for choices)                |
| `--ci`                 | CI mode: skip all prompts, auto-accept everything (requires `--version`) |
| `--version <value>`    | Version bump type (`patch`, `minor`, `major`) or explicit version        |
| `-h`, `--help`         | Show help message                                                        |

## Examples

### Interactive publish

```bash
bunx pubz
```

### Preview changes (dry run)

```bash
bunx pubz --dry-run
```

### Quick publish with confirmations auto-accepted

```bash
bunx pubz --yes
```

### Publish to GitHub Packages

```bash
bunx pubz --registry https://npm.pkg.github.com
```

### CI mode with version bump

```bash
bunx pubz --ci --version patch
bunx pubz --ci --version minor
bunx pubz --ci --version major
```

### CI mode with explicit version

```bash
bunx pubz --ci --version 1.2.3
```

## GitHub Actions

Here's an example workflow for publishing with `pubz`, using an input selector for patch/minor/major version bump.

### Using NPM_TOKEN (classic)

```yaml
name: Publish

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version bump type or explicit version'
        required: true
        type: choice
        options:
          - patch
          - minor
          - major

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - run: bun install

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Configure npm
        run: echo "//registry.npmjs.org/:_authToken=${{ secrets.NPM_TOKEN }}" > ~/.npmrc

      - name: Publish
        run: bunx pubz --ci --version ${{ inputs.version }}

      - name: Push changes
        run: git push && git push --tags
```

### Using OIDC Trusted Publishing (recommended)

Trusted publishing uses OpenID Connect to authenticate with npm without storing long-lived tokens. First, configure your package on npmjs.com:

1. Go to your package → Settings → Trusted Publishers
2. Add your GitHub repository and workflow file name

```yaml
name: Publish

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version bump type or explicit version'
        required: true
        type: choice
        options:
          - patch
          - minor
          - major

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - uses: actions/setup-node@v4
        with:
          registry-url: 'https://registry.npmjs.org'

      - run: bun install

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Publish
        run: bunx pubz --ci --version ${{ inputs.version }}

      - name: Push changes
        run: git push && git push --tags
```

## Example Output

```bash
bunx pubz
```

<!-- demo-output-start -->
```
📦 pubz  npm package publisher

┌─ Packages ─────────────────────────────────────────
  • my-app@1.2.0
└────────────────────────────────────────────────────

┌─ 🔖 Version ───────────────────────────────────────
  Bumping (minor): 1.2.0 → 1.3.0
  Updating all packages...
chore: release v1.3.0
└────────────────────────────────────────────────────

┌─ 🏗️  Build ───────────────────────────────────────
  Running bun run build...
  
$ bun build.js
Bundled 3 modules in 2ms

  index.js  4.12 KB  (entry point)

└────────────────────────────────────────────────────

Publishing to https://registry.npmjs.org:

  • my-app@1.3.0

┌─ 🚀 Publish ───────────────────────────────────────
  Preparing packages...
npm notice
npm notice Publishing to https://registry.npmjs.org
npm notice
└────────────────────────────────────────────────────

✅ Published v1.3.0!

┌─ 📋 Changelog ─────────────────────────────────────
  Since v1.2.0
  4e215fd docs: update README
  5cbdd88 fix: fix edge case in parser
  6142990 feat: add feature A
└────────────────────────────────────────────────────


┌─ ✨ AI Release Notes ───────────────────────────────
  Generating...
  
  ### Features
  
  - Added feature A.
  
  ### Bug Fixes
  
  - Fixed an edge case in the parser.
  
  ### Documentation
  
  - Updated README.
└────────────────────────────────────────────────────

┌─ 🏷️  Release ─────────────────────────────────────
  Creating tag v1.3.0...
  Pushing tag to origin...
 * [new tag]         v1.3.0 -> v1.3.0
  Creating GitHub release...
└────────────────────────────────────────────────────

🎉 Done!
```
<!-- demo-output-end -->
