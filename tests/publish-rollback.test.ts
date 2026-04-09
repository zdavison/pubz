import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  createTestWorkspace,
  runPubz,
  type TestWorkspace,
} from './helpers/workspace';

function getGitLog(cwd: string): string[] {
  const result = spawnSync('git', ['log', '--oneline'], { cwd, encoding: 'utf-8' });
  return result.stdout.trim().split('\n').filter(Boolean);
}

describe('publish failure rollback', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('rolls back the version bump commit when publish fails', async () => {
    const commitsBefore = getGitLog(workspace.path).length;

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build'], {
      MOCK_NPM_FAIL: 'true',
    });

    expect(result.code).not.toBe(0);

    const commitsAfter = getGitLog(workspace.path).length;
    expect(commitsAfter).toBe(commitsBefore);
  });

  it('restores package.json to original version when publish fails', async () => {
    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build'], {
      MOCK_NPM_FAIL: 'true',
    });

    expect(result.code).not.toBe(0);

    const pkgA = workspace.readPackageJson('packages/pkg-a');
    expect(pkgA.version).toBe('1.0.0');
  });

  it('does not roll back when publish succeeds', async () => {
    const commitsBefore = getGitLog(workspace.path).length;

    const result = await runPubz(workspace, ['--ci', '--version', 'patch', '--skip-build']);

    expect(result.code).toBe(0);

    const commitsAfter = getGitLog(workspace.path).length;
    expect(commitsAfter).toBe(commitsBefore + 1);
  });
});
