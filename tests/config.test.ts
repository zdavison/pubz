import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pubz-config-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test('returns empty object when no .pubz file exists', () => {
  const config = loadConfig(tmpDir);
  expect(config).toEqual({});
});

test('parses bare boolean flags', () => {
  writeFileSync(join(tmpDir, '.pubz'), 'skip-publish\nskip-build\n');
  const config = loadConfig(tmpDir);
  expect(config['skip-publish']).toBe(true);
  expect(config['skip-build']).toBe(true);
});

test('parses explicit true/false values', () => {
  writeFileSync(join(tmpDir, '.pubz'), 'skip-publish=true\nskip-build=false\n');
  const config = loadConfig(tmpDir);
  expect(config['skip-publish']).toBe(true);
  expect(config['skip-build']).toBe(false);
});

test('parses registry value', () => {
  writeFileSync(join(tmpDir, '.pubz'), 'registry=https://npm.pkg.github.com\n');
  const config = loadConfig(tmpDir);
  expect(config.registry).toBe('https://npm.pkg.github.com');
});

test('ignores comments and blank lines', () => {
  writeFileSync(join(tmpDir, '.pubz'), '# This is a comment\n\nskip-publish\n\n# Another comment\n');
  const config = loadConfig(tmpDir);
  expect(config['skip-publish']).toBe(true);
  expect(Object.keys(config)).toEqual(['skip-publish']);
});

test('ignores unknown keys', () => {
  writeFileSync(join(tmpDir, '.pubz'), 'skip-publish\nunknown-key=value\n');
  const config = loadConfig(tmpDir);
  expect(config['skip-publish']).toBe(true);
  expect(Object.keys(config)).toEqual(['skip-publish']);
});

test('handles mixed config', () => {
  writeFileSync(
    join(tmpDir, '.pubz'),
    `# pubz config
skip-publish
registry=https://npm.pkg.github.com
`,
  );
  const config = loadConfig(tmpDir);
  expect(config['skip-publish']).toBe(true);
  expect(config.registry).toBe('https://npm.pkg.github.com');
});
