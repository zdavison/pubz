import { describe, it, expect } from 'bun:test';
import { isValidVersion, bumpVersion } from '../src/version.js';

describe('isValidVersion', () => {
  it('accepts standard semver versions', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('0.0.0')).toBe(true);
    expect(isValidVersion('10.20.30')).toBe(true);
  });

  it('accepts versions with pre-release suffixes', () => {
    expect(isValidVersion('1.2.3-beta')).toBe(true);
    expect(isValidVersion('1.2.3-rc.1')).toBe(true);
    expect(isValidVersion('0.8.9-alpha.2')).toBe(true);
  });

  it('rejects invalid versions', () => {
    expect(isValidVersion('')).toBe(false);
    expect(isValidVersion('1.2')).toBe(false);
    expect(isValidVersion('1')).toBe(false);
    expect(isValidVersion('abc')).toBe(false);
    expect(isValidVersion('v1.2.3')).toBe(false);
    expect(isValidVersion('1.2.3.4')).toBe(false);
  });
});

describe('bumpVersion', () => {
  it('bumps patch version', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('bumps minor version', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('bumps major version', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  it('returns same version for none', () => {
    expect(bumpVersion('1.2.3', 'none')).toBe('1.2.3');
  });
});
