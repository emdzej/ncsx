import { describe, expect, it } from 'vitest';
import { tokenizeFa } from './tokenize.js';

describe('tokenizeFa', () => {
  it('splits on whitespace and commas', () => {
    expect(tokenizeFa('0205 0502 0524')).toEqual(['0205', '0502', '0524']);
    expect(tokenizeFa('0205,0502,0524')).toEqual(['0205', '0502', '0524']);
  });

  it('strips `$` prefix (AT records store SA codes without it)', () => {
    expect(tokenizeFa('$0902 $0904')).toEqual(['0902', '0904']);
  });

  it('KEEPS `#` prefix on date codes (AT keys are like `#0306`)', () => {
    expect(tokenizeFa('#0904')).toEqual(['#0904']);
    expect(tokenizeFa('$0902 #0904')).toEqual(['0902', '#0904']);
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

  it('splits the native glued FA format on category markers', () => {
    // Real-world FA from an E46 cluster — markers are `_` (chassis prefix),
    // `#` (date), `&` (engine), `%` (model), `$` (SA codes).
    expect(tokenizeFa('E46_#0306&N6SW%0354$167$1CA$205$832$L7BA')).toEqual([
      'E46',
      '#0306',
      'N6SW',
      '0354',
      '167',
      '1CA',
      '205',
      '832',
      'L7BA',
    ]);
  });

  it('handles the chassis prefix with no underscore (rare older FA shape)', () => {
    expect(tokenizeFa('E46#0306$167')).toEqual(['E46', '#0306', '167']);
  });
});
