import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  createTestWorkspace,
  runPubz,
  type TestWorkspace,
} from './helpers/workspace';

describe('workspace protocol transformation', () => {
  let workspace: TestWorkspace;

  beforeEach(async () => {
    workspace = await createTestWorkspace('workspace-formats');
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it('publishes with transformed workspace references and restores after', async () => {
    // Fixture has pkg-a and pkg-b, where pkg-b depends on pkg-a with:
    // - dependencies: workspace:^
    // - devDependencies: workspace:~
    // - peerDependencies: workspace:*

    const result = await runPubz(workspace, [
      '--ci',
      '--version',
      'patch',
      '--skip-build',
    ]);

    expect(result.code).toBe(0);

    // Verify npm was called for both packages
    const npmCalls = workspace.getNpmCalls();
    const publishCalls = npmCalls.filter((c) => c.args[0] === 'publish');
    expect(publishCalls.length).toBe(2);

    // Verify packages published in dependency order (pkg-a before pkg-b)
    const pkgAIndex = publishCalls.findIndex((c) => c.cwd.includes('pkg-a'));
    const pkgBIndex = publishCalls.findIndex((c) => c.cwd.includes('pkg-b'));
    expect(pkgAIndex).toBeLessThan(pkgBIndex);

    // Verify workspace references were transformed at publish time
    const pkgBPublish = publishCalls.find((c) => c.cwd.includes('pkg-b'));
    const publishedPkg = pkgBPublish!.packageJson!;
    expect((publishedPkg.dependencies as Record<string, string>)['@test/pkg-a']).toBe('^1.0.1');
    expect((publishedPkg.devDependencies as Record<string, string>)['@test/pkg-a']).toBe('~1.0.1');
    expect((publishedPkg.peerDependencies as Record<string, string>)['@test/pkg-a']).toBe('1.0.1');

    // Verify workspace references were restored after publish
    const pkgBFinal = workspace.readPackageJson('packages/pkg-b');
    expect((pkgBFinal.dependencies as Record<string, string>)['@test/pkg-a']).toBe('workspace:^');
    expect((pkgBFinal.devDependencies as Record<string, string>)['@test/pkg-a']).toBe('workspace:~');
    expect((pkgBFinal.peerDependencies as Record<string, string>)['@test/pkg-a']).toBe('workspace:*');

    // Verify versions were bumped and persisted
    expect(pkgBFinal.version).toBe('1.0.1');
  });

  it('restores workspace references when publish fails', async () => {
    const result = await runPubz(
      workspace,
      ['--ci', '--version', 'patch', '--skip-build'],
      { MOCK_NPM_FAIL: 'true' },
    );

    expect(result.code).not.toBe(0);

    // Verify workspace references were restored despite failure
    const pkgBFinal = workspace.readPackageJson('packages/pkg-b');
    expect((pkgBFinal.dependencies as Record<string, string>)['@test/pkg-a']).toBe('workspace:^');
    expect((pkgBFinal.devDependencies as Record<string, string>)['@test/pkg-a']).toBe('workspace:~');
    expect((pkgBFinal.peerDependencies as Record<string, string>)['@test/pkg-a']).toBe('workspace:*');
  });
});
