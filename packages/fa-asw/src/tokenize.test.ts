import { describe, expect, it } from 'vitest';
import { tokenizeFa } from './tokenize.js';

describe('tokenizeFa', () => {
  it('splits on whitespace and commas', () => {
    expect(tokenizeFa('0205 0502 0524')).toEqual(['0205', '0502', '0524']);
    expect(tokenizeFa('0205,0502,0524')).toEqual(['0205', '0502', '0524']);
  });

  it("strips '$' and '#' prefixes", () => {
    expect(tokenizeFa('$0902 #0904')).toEqual(['0902', '0904']);
  });

  it('uppercases', () => {
    expect(tokenizeFa('bl91 br91')).toEqual(['BL91', 'BR91']);
  });

  it('does NOT drop alphanumeric vehicle-type codes (BL91, BR91)', () => {
    expect(tokenizeFa('BL91 BR91 BW92')).toEqual(['BL91', 'BR91', 'BW92']);
  });

  it('ignores empty tokens', () => {
    expect(tokenizeFa('  0902  ,, 0524  ')).toEqual(['0902', '0524']);
    expect(tokenizeFa('')).toEqual([]);
  });
});
