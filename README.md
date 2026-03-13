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

```
pubz - npm package publisher
══════════════════════════════

Discovering packages...

Found 1 publishable package(s):

  • pubz@0.4.0

Step 1: Version Management
──────────────────────────────

Current version: 0.4.0

? Bump version before publishing? [Y/n] n
? Select publish target:

  > 1) Public npm registry (https://registry.npmjs.org)
    2) GitHub Packages (https://npm.pkg.github.com)

  Enter choice [1-2] (default: 1): 

Publishing to: https://registry.npmjs.org

Verifying npm authentication...
Authenticated as zdavison

Step 2: Building Packages
──────────────────────────────

Running build...

$ bun build src/cli.ts --outdir dist --target node
Bundled 10 modules in 5ms

  cli.js  41.27 KB  (entry point)


Build completed successfully

Verifying builds...

  ✓ pubz build verified

Step 3: Publishing to npm
──────────────────────────────

About to publish the following packages:

  • pubz@0.4.0

Registry: https://registry.npmjs.org

? Continue? [Y/n] 

Preparing packages for publish...

Publishing packages...

Publishing pubz@0.4.0...
npm notice 
npm notice 📦  pubz@0.4.0
npm notice === Tarball Contents === 
npm notice 7.1kB  README.md   
npm notice 41.3kB dist/cli.js 
npm notice 697B   package.json
npm notice === Tarball Details === 
npm notice name:          pubz                                    
npm notice version:       0.4.0                                   
npm notice filename:      pubz-0.4.0.tgz                          
npm notice package size:  12.0 kB                                 
npm notice unpacked size: 49.1 kB                                 
npm notice shasum:        3026a7936458dcaa84030a0ce2e206b9f74aa65d
npm notice integrity:     sha512-6vKMOsC7sZa87[...]w8KNx1fD45u/A==
npm notice total files:   3                                       
npm notice 
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access
Authenticate your account at:
https://www.npmjs.com/auth/cli/c47d9bee-2a1e-4adf-9aab-63d15acfade2
Press ENTER to open in the browser...

+ pubz@0.4.0
  pubz published successfully

══════════════════════════════
Publishing complete!

Published version: 0.4.0

Changes since v0.2.12:
  5553c95 Fix ENTER to open browser not working.
  9aaddff Fix tag/push/release branch when using --yes.
  0ce3ab8 Generate changlog and attach it to release page / print it out during publish.
  5a29ca4 Merge branch 'main' of github.com:mm-zacharydavison/pubz
  b4c47fc Clean up README.md formatting
  2da403c Update README.md
  88a4211 Update README with image and usage instructions
  8a8148a Update README.md
  2b45d21 Transform 'workspace:' definitions on publish, and restore them before any commit.

? Create a git tag for v0.4.0? [Y/n] 

  Tag v0.4.0 created
? Push tag to origin? [Y/n] 
remote: This repository moved. Please use the new location:        
remote:   git@github.com:zdavison/pubz.git        
To github.com:mm-zacharydavison/pubz.git
 * [new tag]         v0.4.0 -> v0.4.0
  Tag v0.4.0 pushed to origin
? Create a GitHub release? [Y/n] 
  Release created: https://github.com/zdavison/pubz/releases/tag/v0.4.0

Done!
```
