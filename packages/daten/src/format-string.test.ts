import { describe, it, expect } from 'vitest';
import { parseFormatString } from './format-string.js';

describe('parseFormatString', () => {
  it('parses plain scalars', () => {
    expect(parseFormatString('BWLSA')).toEqual([
      { kind: 'scalar', scalar: 'B' },
      { kind: 'scalar', scalar: 'W' },
      { kind: 'scalar', scalar: 'L' },
      { kind: 'scalar', scalar: 'S' },
      { kind: 'scalar', scalar: 'A' },
    ]);
  });

  it('parses optional {X}', () => {
    expect(parseFormatString('{L}W')).toEqual([
      { kind: 'optional', scalar: 'L' },
      { kind: 'scalar', scalar: 'W' },
    ]);
  });

  it('parses plain collection (X)', () => {
    expect(parseFormatString('(B)')).toEqual([{ kind: 'collection', scalar: 'B' }]);
  });

  // Bug 3 fix
  it('parses non-empty list X(X) distinct from collection', () => {
    expect(parseFormatString('S(S)')).toEqual([{ kind: 'non-empty-list', scalar: 'S' }]);
  });

  // Bug 2 fix — range list
  it('parses range list XX(XX) as one entry, not three', () => {
    expect(parseFormatString('WW(WW)')).toEqual([{ kind: 'range-list', scalar: 'W' }]);
  });

  it('parses a real PARZUWEISUNG_FSW format', () => {
    expect(parseFormatString('{L}LWW{B}(B){B}{B}')).toEqual([
      { kind: 'optional', scalar: 'L' },
      { kind: 'scalar', scalar: 'L' },
      { kind: 'scalar', scalar: 'W' },
      { kind: 'scalar', scalar: 'W' },
      { kind: 'optional', scalar: 'B' },
      { kind: 'collection', scalar: 'B' },
      { kind: 'optional', scalar: 'B' },
      { kind: 'optional', scalar: 'B' },
    ]);
  });

  // Mixed-scalar X Y (X Y) is not a recognised pattern: parser emits scalars + warning.
  it('does not treat mismatched WS(WS) as a range list', () => {
    const warns: string[] = [];
    const shapes = parseFormatString('WS(WS)', (m) => warns.push(m));
    // The first two scalars decode cleanly; the `(WS)` is malformed (close is not ')') and warns.
    expect(shapes.slice(0, 2)).toEqual([
      { kind: 'scalar', scalar: 'W' },
      { kind: 'scalar', scalar: 'S' },
    ]);
    expect(warns.some((w) => /malformed collection/.test(w))).toBe(true);
  });

  // Bug 4 fix — truncated optional warns but doesn't desync.
  it('warns on truncated optional {X (no closing brace)', () => {
    const warns: string[] = [];
    const shapes = parseFormatString('A{B}{', (m) => warns.push(m));
    expect(shapes).toEqual([
      { kind: 'scalar', scalar: 'A' },
      { kind: 'optional', scalar: 'B' },
    ]);
    expect(warns.length).toBe(1);
    expect(warns[0]).toMatch(/malformed optional/);
  });
});
