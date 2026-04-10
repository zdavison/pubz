import { describe, it, expect } from 'bun:test';
import { glob } from '../src/glob';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dir, 'fixtures');

describe('glob', () => {
  it('discovers packages via wildcard pattern (packages/*)', async () => {
    const results = await glob('packages/*', join(fixturesDir, 'workspace-formats'));
    expect(results.sort()).toEqual(['packages/pkg-a', 'packages/pkg-b']);
  });

  it('discovers a package via exact directory name', async () => {
    const results = await glob('srb', join(fixturesDir, 'workspace-exact'));
    expect(results).toEqual(['srb']);
  });

  it('returns empty for exact directory without package.json', async () => {
    const results = await glob('nonexistent', join(fixturesDir, 'workspace-exact'));
    expect(results).toEqual([]);
  });
});
