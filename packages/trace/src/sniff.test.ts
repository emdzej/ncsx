import { describe, expect, it } from 'vitest';
import { sniffTraceFormat } from './sniff.js';

describe('sniffTraceFormat', () => {
  it('detects FSW/PSW', () => {
    expect(sniffTraceFormat('GPS_UHR\n\taktiv\n')).toBe('fsw-psw');
  });

  it('detects Nettodata byte mode', () => {
    expect(sniffTraceFormat('B 00000100,0001,08\n')).toBe('nettodata');
  });

  it('detects Nettodata word mode', () => {
    expect(sniffTraceFormat('B 00000100,0001,1234\n')).toBe('nettodata');
  });

  it('returns null for empty input', () => {
    expect(sniffTraceFormat('')).toBeNull();
    expect(sniffTraceFormat('\n\n\n')).toBeNull();
  });

  it('returns null for unrecognised input', () => {
    expect(sniffTraceFormat('hello world\n')).toBeNull();
  });
});
