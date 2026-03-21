#!/usr/bin/env bun
// kadai:name Generate Demo
// kadai:emoji 🎬
// kadai:description Regenerate the README "Example Output" section from a live pubz dry-run

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

async function main() {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'pubz-demo-workspace-'));
  const remoteDir = mkdtempSync(join(tmpdir(), 'pubz-demo-remote-'));
  const binDir = mkdtempSync(join(tmpdir(), 'pubz-demo-bin-'));

  try {
    await setup(workspaceDir, remoteDir, binDir);
    const output = await runDemo(workspaceDir, binDir);

    console.log(output.trim());
    console.log('');

    const answer = await ask('Update README.md with this output? [y/N] ');
    if (answer.trim().toLowerCase() === 'y') {
      updateReadme(output);
      console.log('README.md updated.');
    } else {
      console.log('Skipped.');
    }
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
}

async function setup(workspaceDir: string, remoteDir: string, binDir: string) {
  // --- Fake package ---
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'my-app',
        version: '1.2.0',
        description: 'An example application',
        main: 'dist/index.js',
        scripts: {
          build: 'bun build.js',
        },
      },
      null,
      2,
    ),
  );

  // Fake build script that mimics bun bundler output
  writeFileSync(
    join(workspaceDir, 'build.js'),
    [
      "const { mkdirSync, writeFileSync } = require('fs');",
      "mkdirSync('dist', { recursive: true });",
      "writeFileSync('dist/index.js', 'module.exports = {};\\n');",
      "console.log('Bundled 3 modules in 2ms');",
      "console.log('');",
      "console.log('  index.js  4.12 KB  (entry point)');",
      "console.log('');",
    ].join('\n'),
  );

  mkdirSync(join(workspaceDir, 'src'), { recursive: true });
  writeFileSync(join(workspaceDir, 'src', 'index.ts'), '// source\n');

  // Create a minimal gitconfig to avoid warnings about inaccessible system/global configs
  writeFileSync(
    join(workspaceDir, '.gitconfig'),
    '[core]\n\texcludesFile = /dev/null\n',
  );

  // --- Git setup ---
  await git(['init'], workspaceDir);
  await git(['config', 'user.email', 'demo@example.com'], workspaceDir);
  await git(['config', 'user.name', 'Demo User'], workspaceDir);
  await git(['add', '-A'], workspaceDir);
  await git(['commit', '-m', 'Initial commit'], workspaceDir);
  await git(['tag', 'v1.2.0'], workspaceDir);

  // A few commits after the tag (these become the "Changes since v1.2.0" list)
  writeFileSync(join(workspaceDir, 'src', 'index.ts'), '// feat: add feature A\n');
  await git(['add', '-A'], workspaceDir);
  await git(['commit', '-m', 'feat: add feature A'], workspaceDir);

  writeFileSync(join(workspaceDir, 'src', 'index.ts'), '// fix: fix edge case\n');
  await git(['add', '-A'], workspaceDir);
  await git(['commit', '-m', 'fix: fix edge case in parser'], workspaceDir);

  writeFileSync(join(workspaceDir, 'src', 'index.ts'), '// docs: update readme\n');
  await git(['add', '-A'], workspaceDir);
  await git(['commit', '-m', 'docs: update README'], workspaceDir);

  // --- Local bare remote (so git push works) ---
  await git(['init', '--bare', remoteDir], workspaceDir);
  await git(['remote', 'add', 'origin', remoteDir], workspaceDir);

  // Push initial branch so `git push` (without specifying remote) works later
  const branch = (await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceDir)).trim();
  await git(['push', '--set-upstream', 'origin', branch], workspaceDir);
  await git(['push', 'origin', 'v1.2.0'], workspaceDir);

  // --- Mock gh CLI ---
  const mockGhPath = join(binDir, 'gh');
  writeFileSync(
    mockGhPath,
    '#!/bin/sh\necho "https://github.com/your-org/my-app/releases/tag/v1.3.0"\n',
  );
  chmodSync(mockGhPath, 0o755);

  // --- Mock claude CLI ---
  const mockClaudePath = join(binDir, 'claude');
  writeFileSync(
    mockClaudePath,
    `#!/bin/sh
cat <<'NOTES'
### Features

- Added feature A.

### Bug Fixes

- Fixed an edge case in the parser.

### Documentation

- Updated README.
NOTES
`,
  );
  chmodSync(mockClaudePath, 0o755);
}

async function runDemo(workspaceDir: string, binDir: string): Promise<string> {
  const cliPath = join(repoRoot, 'src', 'cli.ts');
  const mockNpmPath = join(repoRoot, 'tests', 'helpers', 'mock-npm');
  const npmLogFile = join(workspaceDir, '.npm-calls.log');

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', [cliPath, '--ci', '--version', 'minor'], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        PUBZ_NPM_COMMAND: mockNpmPath,
        MOCK_NPM_LOG: npmLogFile,
        PUBZ_GH_COMMAND: join(binDir, 'gh'),
        NO_COLOR: '1',
        // Ensure mock-gh is found first for the PATH used by gh spawns
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        // Use workspace-local gitconfig to avoid warnings about inaccessible system configs
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(workspaceDir, '.gitconfig'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stdout += d.toString(); });
    proc.stdin?.end();

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pubz exited with code ${code}:\n${stdout}`));
      } else {
        const cleaned = stdout
          // Strip any ANSI escape codes that slipped through
          .replace(/\x1b\[[0-9;]*m/g, '')
          // Remove git push progress lines that reference the temp local remote path
          .split('\n')
          .filter((line) => !line.startsWith('To /tmp/') && !line.startsWith('To /var/'))
          // Remove git commit hash lines (e.g. "[main abc1234] chore: ...")
          .map((line) => line.replace(/^\[[\w/]+ [0-9a-f]{7,}\] /, ''))
          // Remove "N file(s) changed" commit summary lines
          .filter((line) => !/^\s+\d+ files? changed/.test(line))
          // Remove git porcelain status lines (e.g. " M package.json", "?? file")
          .filter((line) => !/^[ MADRCU?]{2} /.test(line))
          .join('\n');
        resolve(cleaned);
      }
    });

    proc.on('error', reject);
  });
}

function updateReadme(output: string) {
  const readmePath = join(repoRoot, 'README.md');
  const readme = readFileSync(readmePath, 'utf-8');

  const startMarker = '<!-- demo-output-start -->\n```\n';
  const endMarker = '\n```\n<!-- demo-output-end -->';

  const startIdx = readme.indexOf(startMarker);
  if (startIdx === -1) throw new Error('README missing <!-- demo-output-start --> marker');
  const endIdx = readme.indexOf(endMarker, startIdx);
  if (endIdx === -1) throw new Error('README missing <!-- demo-output-end --> marker');

  const newReadme =
    readme.slice(0, startIdx + startMarker.length) +
    output.trim() +
    readme.slice(endIdx);

  writeFileSync(readmePath, newReadme);
}

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', (chunk) => {
      data = chunk.toString();
      resolve(data);
    });
  });
}

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: 'pipe' });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed: ${stderr}`)),
    );
    proc.on('error', reject);
  });
}

function gitOutput(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`git ${args.join(' ')} failed`)));
    proc.on('error', reject);
  });
}

main().catch((err) => {
  console.error('gen-demo failed:', err.message);
  process.exit(1);
});
