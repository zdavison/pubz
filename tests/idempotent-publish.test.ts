import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createTestWorkspace,
  runPubz,
  type TestWorkspace,
} from './helpers/workspace';

function gitCommitAll(workspace: TestWorkspace, message: string) {
  spawnSync('git', ['add', '-A'], { cwd: workspace.path });
  spawnSync('git', ['commit', '-m', message], { cwd: workspace.path });
}

function getGitTags(workspace: TestWorkspace): string[] {
  const result = spawnSync('git', ['tag', '-l'], { cwd: workspace.path });
  return result.stdout.toString().trim().split('\n').filter(Boolean);
}

function getHeadMessage(workspace: TestWorkspace): string {
  const result = spawnSync('git', ['log', '-1', '--format=%s'], { cwd: workspace.path });
  return result.stdout.toString().trim();
}

describe('idempotent publish - version bump', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('skips version bump when packages already have the target version', async () => {
    // First run: bump to 1.0.1
    const first = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build', '--skip-publish']);
    expect(first.code).toBe(0);

    const versionAfterFirst = workspace.readPackageJson('packages/pkg-a').version;
    expect(versionAfterFirst).toBe('1.0.1');
    const commitAfterFirst = getHeadMessage(workspace);
    expect(commitAfterFirst).toBe('chore: release v1.0.1');

    // Second run: same version, should skip bump
    const second = await runPubz(workspace, ['--ci', '--version', '1.0.1', '--skip-build', '--skip-publish']);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('already set to 1.0.1');

    // Should not have created a new commit
    const commitAfterSecond = getHeadMessage(workspace);
    expect(commitAfterSecond).toBe('chore: release v1.0.1');

    // Version should still be 1.0.1
    const versionAfterSecond = workspace.readPackageJson('packages/pkg-a').version;
    expect(versionAfterSecond).toBe('1.0.1');
  });

  it('bumps version normally when target is different from current', async () => {
    // First run: bump to 1.0.1
    const first = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build', '--skip-publish']);
    expect(first.code).toBe(0);

    // Second run: bump to 1.1.0 (different version)
    const second = await runPubz(workspace, ['--ci', '--version', 'minor', '--skip-build', '--skip-publish']);
    expect(second.code).toBe(0);
    expect(second.stdout).not.toContain('already set to');

    const version = workspace.readPackageJson('packages/pkg-a').version;
    expect(version).toBe('1.1.0');
  });
});

describe('idempotent publish - npm publish', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('skips packages already published to the registry', async () => {
    // Simulate @test/pkg-a@1.0.1 already on registry
    const published = { '@test/pkg-a@1.0.1': true };

    const result = await runPubz(
      workspace,
      ['--ci', '--version', 'patch', '--skip-build'],
      { MOCK_NPM_PUBLISHED_VERSIONS: JSON.stringify(published) },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('already published, skipping');

    // Only pkg-b should have been published
    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(1);
    expect(publishCalls[0].cwd).toContain('pkg-b');
  });

  it('skips all packages when all are already published', async () => {
    const published = {
      '@test/pkg-a@1.0.1': true,
      '@test/pkg-b@1.0.1': true,
    };

    const result = await runPubz(
      workspace,
      ['--ci', '--version', 'patch', '--skip-build'],
      { MOCK_NPM_PUBLISHED_VERSIONS: JSON.stringify(published) },
    );

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(0);
  });

  it('publishes all packages when none are on the registry', async () => {
    const result = await runPubz(
      workspace,
      ['--ci', '--version', 'patch', '--skip-build'],
    );

    expect(result.code).toBe(0);

    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(2);
  });
});

describe('idempotent publish - git tag', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('does not fail when tag already exists', async () => {
    // Create the tag manually first
    spawnSync('git', ['tag', 'v1.0.1'], { cwd: workspace.path });
    expect(getGitTags(workspace)).toContain('v1.0.1');

    // Run publish with same version — should not fail on tag creation
    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build', '--skip-publish']);

    expect(result.code).toBe(0);

    // Tag should still exist (only one)
    const tags = getGitTags(workspace);
    expect(tags.filter((t) => t === 'v1.0.1').length).toBe(1);
  });
});

describe('idempotent publish - full re-run', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('succeeds on full re-run with all steps already completed', async () => {
    // Simulate everything already done: version bumped, packages published, tag created
    // First bump the version manually
    for (const pkgDir of ['packages/pkg-a', 'packages/pkg-b']) {
      const pkgJsonPath = join(workspace.path, pkgDir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      pkg.version = '1.0.1';
      writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
    }
    gitCommitAll(workspace, 'chore: release v1.0.1');
    spawnSync('git', ['tag', 'v1.0.1'], { cwd: workspace.path });

    const published = {
      '@test/pkg-a@1.0.1': true,
      '@test/pkg-b@1.0.1': true,
    };

    // Re-run: everything should be skipped gracefully
    const result = await runPubz(
      workspace,
      ['--ci', '--version', '1.0.1', '--skip-build'],
      { MOCK_NPM_PUBLISHED_VERSIONS: JSON.stringify(published) },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('already set to 1.0.1');

    // No npm publish calls
    const publishCalls = workspace.getNpmCalls().filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(0);
  });
});
