import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSgfam } from './sgfam.js';
import { parseAt } from './at.js';
import { parseAtM00 } from './at-m00.js';
import { parseZst } from './zst.js';

const DATEN_E46 = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'DATEN', 'E46');
const haveSamples = existsSync(DATEN_E46);

(haveSamples ? describe : describe.skip)('integration — shipped E46 text tables', () => {
  it('parses E46SGFAM.DAT and includes EWS + KMB', () => {
    const path = join(DATEN_E46, 'E46SGFAM.DAT');
    if (!existsSync(path)) return;
    const { rows, unparsed } = parseSgfam(readFileSync(path, 'latin1'));
    expect(rows.length).toBeGreaterThan(20);
    expect(unparsed).toEqual([]);
    const ews = rows.find((r) => r.sgName === 'EWS');
    expect(ews).toBeDefined();
    expect(ews!.cabd).toBe('A_EWS3');
    expect(ews!.sgbd).toBe('C_EWS3');
    expect(ews!.zcs).toBe(1);
    const kmb = rows.find((r) => r.sgName === 'KMB');
    expect(kmb!.cabd).toBe('A_KMB46');
  });

  it('parses E46AT.M00 and recognises Z/E/W categories', () => {
    const path = join(DATEN_E46, 'E46AT.M00');
    if (!existsSync(path)) return;
    const file = parseAtM00(readFileSync(path, 'latin1'));
    expect(file.filename).toBe('E46AT.M00');
    expect(file.entries.length).toBeGreaterThan(50);
    const cats = new Set(file.entries.map((e) => e.category));
    expect(cats.has('Z')).toBe(true);
    expect(cats.has('E')).toBe(true);
    expect(cats.has('W')).toBe(true);
  });

  it('parses E46AT.000 and finds W-records for 488 and 502', () => {
    const path = join(DATEN_E46, 'E46AT.000');
    if (!existsSync(path)) return;
    const file = parseAt(readFileSync(path, 'latin1'));
    const wRecords = file.records.filter((r) => r.category === 'W');
    expect(wRecords.length).toBeGreaterThan(50);
    const w502 = wRecords.find((r) => r.code === '502');
    expect(w502).toBeDefined();
    expect(w502!.fsws).toContain('SWA');
  });

  it('parses E46ZST.000 header and many SA-bit rows', () => {
    const path = join(DATEN_E46, 'E46ZST.000');
    if (!existsSync(path)) return;
    const file = parseZst(readFileSync(path, 'latin1'));
    expect(file.header.tabelle).toBe('E46ZST.000');
    expect(file.records.length).toBeGreaterThan(50);
    // Every record should have a 16-hex-char SA mask.
    expect(file.records.every((r) => /^[0-9A-Fa-f]{16}$/.test(r.saMask))).toBe(true);
    // At least some have a non-empty FSW.
    expect(file.records.some((r) => r.fsw !== '')).toBe(true);
  });
});
