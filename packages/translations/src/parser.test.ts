import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseTranslationsCsv } from './parser.js';
import { formatLabel, splitLabel } from './format.js';

describe('parseTranslationsCsv', () => {
  it('parses a tiny CSV body', () => {
    const text = [
      'CONTRIBUTORS,"alice,bob,carol"',
      'LASTMODIFIED,20190919',
      '',
      'wert_01,Value 01',
      'aktiv,Enabled',
      'nicht_aktiv,Not enabled',
    ].join('\n');
    const file = parseTranslationsCsv(text);
    expect(file.entries.size).toBe(3);
    expect(file.entries.get('wert_01')).toBe('Value 01');
    expect(file.entries.get('aktiv')).toBe('Enabled');
    expect(file.contributors).toEqual(['alice', 'bob', 'carol']);
    expect(file.lastModified?.toISOString().slice(0, 10)).toBe('2019-09-19');
  });

  it('drops rows with empty translation', () => {
    const file = parseTranslationsCsv('keyword,\nother,realvalue\n');
    expect(file.entries.has('keyword')).toBe(false);
    expect(file.entries.get('other')).toBe('realvalue');
  });

  it('honours quoted fields with embedded commas', () => {
    const file = parseTranslationsCsv('04bh,"Check ""Trailer tow bar"" notification, urgent"\n');
    expect(file.entries.get('04bh')).toBe('Check "Trailer tow bar" notification, urgent');
  });

  it('accepts `;` as an alternate separator', () => {
    const file = parseTranslationsCsv('foo;bar\n');
    expect(file.entries.get('foo')).toBe('bar');
  });

  it('handles CRLF line endings', () => {
    const file = parseTranslationsCsv('foo,bar\r\nbaz,qux\r\n');
    expect(file.entries.get('foo')).toBe('bar');
    expect(file.entries.get('baz')).toBe('qux');
  });

  it('returns null lastModified for malformed date row', () => {
    const file = parseTranslationsCsv('LASTMODIFIED,not-a-date\nfoo,bar\n');
    expect(file.lastModified).toBeNull();
    expect(file.entries.get('foo')).toBe('bar');
  });

  it('trims trailing whitespace on translation', () => {
    const file = parseTranslationsCsv('foo,bar   \n');
    expect(file.entries.get('foo')).toBe('bar');
  });
});

describe('formatLabel', () => {
  const map = new Map([
    ['wert_01', 'Value 01'],
    ['aktiv', 'Enabled'],
  ]);

  it('joins keyword and translation with two-space-dash-two-space', () => {
    expect(formatLabel('wert_01', map)).toBe('wert_01  -  Value 01');
  });

  it('returns just the keyword when no translation', () => {
    expect(formatLabel('UNKNOWN', map)).toBe('UNKNOWN');
  });

  it('handles undefined map', () => {
    expect(formatLabel('aktiv', undefined)).toBe('aktiv');
  });

  it('returns just keyword when translation is empty string', () => {
    expect(formatLabel('foo', new Map([['foo', '']]))).toBe('foo');
  });
});

describe('splitLabel', () => {
  const map = new Map([['aktiv', 'Enabled']]);

  it('returns keyword + translation pair', () => {
    expect(splitLabel('aktiv', map)).toEqual({ keyword: 'aktiv', translation: 'Enabled' });
  });

  it('returns null translation when missing', () => {
    expect(splitLabel('UNKNOWN', map)).toEqual({ keyword: 'UNKNOWN', translation: null });
  });
});

const REAL_CSV_PATH = '/Users/mjaskols/Downloads/inpa/BMW SOFTWARE/NCS Dummy/Translations.csv';
const haveRealCsv = existsSync(REAL_CSV_PATH);

(haveRealCsv ? describe : describe.skip)('integration — real Translations.csv', () => {
  it('parses the shipped NCSDummy CSV and resolves known keywords', () => {
    const file = parseTranslationsCsv(readFileSync(REAL_CSV_PATH, 'utf8'));
    expect(file.entries.size).toBeGreaterThan(10000);
    expect(file.entries.get('wert_01')).toBe('Value 01');
    expect(file.entries.get('aktiv')).toBe('Enabled');
    expect(file.entries.get('nicht_aktiv')).toBe('Not enabled');
    expect(file.entries.get('GPS_UHR')).toBe('Use time from GPS');
    expect(file.contributors.length).toBeGreaterThan(0);
    expect(file.lastModified).not.toBeNull();
  });
});
