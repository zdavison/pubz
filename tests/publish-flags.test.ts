import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createTestWorkspace,
  runPubz,
  type TestWorkspace,
} from './helpers/workspace';

function writePubzConfig(workspace: TestWorkspace, pkgDir: string, content: string) {
  writeFileSync(join(workspace.path, pkgDir, '.pubz'), content);
}

function gitCommitAll(workspace: TestWorkspace, message: string) {
  spawnSync('git', ['add', '-A'], { cwd: workspace.path });
  spawnSync('git', ['commit', '-m', message], { cwd: workspace.path });
}

function setPrivate(workspace: TestWorkspace, pkgDir: string, isPrivate: boolean) {
  const pkgJsonPath = join(workspace.path, pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  if (isPrivate) {
    pkg.private = true;
  } else {
    delete pkg.private;
  }
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

describe('per-package skip-publish flag', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('excludes a package with skip-publish in .pubz', async () => {
    writePubzConfig(workspace, 'packages/pkg-b', 'skip-publish\n');
    gitCommitAll(workspace, 'add skip-publish to pkg-b');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(1);
    expect(publishCalls[0].cwd).toContain('pkg-a');
  });

  it('succeeds with version bump when all packages have skip-publish', async () => {
    writePubzConfig(workspace, 'packages/pkg-a', 'skip-publish\n');
    writePubzConfig(workspace, 'packages/pkg-b', 'skip-publish\n');
    gitCommitAll(workspace, 'add skip-publish to all packages');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Skipping npm publish');

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(0);
  });

  it('respects skip-publish=true explicit form', async () => {
    writePubzConfig(workspace, 'packages/pkg-b', 'skip-publish=true\n');
    gitCommitAll(workspace, 'add skip-publish=true to pkg-b');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(1);
    expect(publishCalls[0].cwd).toContain('pkg-a');
  });

  it('skip-publish=false does not exclude the package', async () => {
    writePubzConfig(workspace, 'packages/pkg-b', 'skip-publish=false\n');
    gitCommitAll(workspace, 'add skip-publish=false to pkg-b');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(2);
  });
});

describe('per-package always-publish flag', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('includes a private package with always-publish in .pubz', async () => {
    setPrivate(workspace, 'packages/pkg-a', true);
    writePubzConfig(workspace, 'packages/pkg-a', 'always-publish\n');
    gitCommitAll(workspace, 'make pkg-a private with always-publish');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    const publishedPkgs = publishCalls.map((c) => c.cwd);
    expect(publishedPkgs.some((p) => p.includes('pkg-a'))).toBe(true);
  });

  it('overrides per-package skip-publish when both are set', async () => {
    // always-publish wins: filter checks alwaysPublish first
    writePubzConfig(workspace, 'packages/pkg-a', 'always-publish\nskip-publish\n');
    writePubzConfig(workspace, 'packages/pkg-b', 'skip-publish\n');
    gitCommitAll(workspace, 'always-publish + skip-publish on pkg-a, skip-publish on pkg-b');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(1);
    expect(publishCalls[0].cwd).toContain('pkg-a');
  });
});

describe('global --skip-publish with per-package always-publish', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('skips all npm publishes when no package has always-publish', async () => {
    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build', '--skip-publish']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(0);
    expect(result.stdout).toContain('Skipping npm publish');
  });

  it('still publishes packages with always-publish when global --skip-publish is set', async () => {
    writePubzConfig(workspace, 'packages/pkg-a', 'always-publish\n');
    gitCommitAll(workspace, 'add always-publish to pkg-a');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build', '--skip-publish']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(1);
    expect(publishCalls[0].cwd).toContain('pkg-a');
  });

  it('does not publish packages without always-publish when global --skip-publish is set', async () => {
    writePubzConfig(workspace, 'packages/pkg-a', 'always-publish\n');
    gitCommitAll(workspace, 'add always-publish to pkg-a only');

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build', '--skip-publish']);

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    const pkgBPublished = publishCalls.some((c) => c.cwd.includes('pkg-b'));
    expect(pkgBPublished).toBe(false);
  });
});
