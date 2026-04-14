import { describe, it, expect } from 'bun:test';
import { parseConfirmOrEditInput } from '../src/prompts.js';

describe('parseConfirmOrEditInput', () => {
  it('returns yes for empty string (default)', () => {
    expect(parseConfirmOrEditInput('')).toBe('yes');
  });

  it('returns yes for "y"', () => {
    expect(parseConfirmOrEditInput('y')).toBe('yes');
  });

  it('returns yes for "Y"', () => {
    expect(parseConfirmOrEditInput('Y')).toBe('yes');
  });

  it('returns no for "n"', () => {
    expect(parseConfirmOrEditInput('n')).toBe('no');
  });

  it('returns no for "N"', () => {
    expect(parseConfirmOrEditInput('N')).toBe('no');
  });

  it('returns edit for "e"', () => {
    expect(parseConfirmOrEditInput('e')).toBe('edit');
  });

  it('returns edit for "E"', () => {
    expect(parseConfirmOrEditInput('E')).toBe('edit');
  });

  it('returns yes for any unrecognised input', () => {
    expect(parseConfirmOrEditInput('x')).toBe('yes');
    expect(parseConfirmOrEditInput('foo')).toBe('yes');
    expect(parseConfirmOrEditInput('  ')).toBe('yes');
  });
});
