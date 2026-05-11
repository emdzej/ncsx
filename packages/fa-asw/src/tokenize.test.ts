import { describe, expect, it } from 'vitest';
import { tokenizeFa } from './tokenize.js';

describe('tokenizeFa', () => {
  it('splits on whitespace and commas', () => {
    expect(tokenizeFa('0902 0524 0205')).toEqual(['0902', '0524', '0205']);
    expect(tokenizeFa('0902,0524,0205')).toEqual(['0902', '0524', '0205']);
    expect(tokenizeFa('0902\t0524\n0205')).toEqual(['0902', '0524', '0205']);
  });

  it("drops '$' prefix", () => {
    expect(tokenizeFa('$0902 $0524')).toEqual(['0902', '0524']);
  });

  it('uppercases tokens', () => {
    expect(tokenizeFa('0abc 0def')).toEqual(['0ABC', '0DEF']);
  });

  it("drops category-letter prefix (W0205, S0230)", () => {
    expect(tokenizeFa('W0205 S0230 Z#0904')).toEqual(['0205', '0230', '0904']);
  });

  it('ignores empty tokens', () => {
    expect(tokenizeFa('  0902  ,, 0524  ')).toEqual(['0902', '0524']);
  });

  it('returns empty array for blank input', () => {
    expect(tokenizeFa('')).toEqual([]);
    expect(tokenizeFa('   ')).toEqual([]);
  });
});
