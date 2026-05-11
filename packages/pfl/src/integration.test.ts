import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parsePfl } from './parser.js';
import { serializePfl } from './serializer.js';

const PFL_DIR = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'PFL');
const shipped = [
  '01_Default.pfl',
  'Car Key Memory.pfl',
  'Expertenmodus.pfl',
  'Expertmodus (offen).pfl',
  'Expertmodus (Werkseinstellung).pfl',
  'ZCS bei nderung schreiben.pfl',
  'NCSDUMMY4.PFL',
];

const haveSamples = existsSync(PFL_DIR);

(haveSamples ? describe : describe.skip)('integration — shipped PFL profiles', () => {
  for (const name of shipped) {
    const path = join(PFL_DIR, name);
    if (!existsSync(path)) continue;

    it(`parses ${name} without throwing`, () => {
      const raw = readFileSync(path, 'latin1');
      const profile = parsePfl(raw);
      expect(profile.header.formatVersion).toBe('3.0');
      expect(profile.header.bezeichnung).not.toBe('');
      // Pruefsumme is always a 4-hex string in shipped profiles.
      expect(profile.header.pruefsumme).toMatch(/^[0-9A-Fa-f]{4}$/);
    });

    it(`round-trips ${name} (parse → serialize → parse → same model)`, () => {
      const raw = readFileSync(path, 'latin1');
      const parsed = parsePfl(raw);
      const out = serializePfl(parsed);
      const reparsed = parsePfl(out);
      expect(reparsed).toEqual(parsed);
    });
  }

  it('Expertenmodus.pfl has full coding workflow enabled', () => {
    const path = join(PFL_DIR, 'Expertenmodus.pfl');
    if (!existsSync(path)) return;
    const profile = parsePfl(readFileSync(path, 'latin1'));
    expect(profile.coding.fktSgCodieren).toBe(true);
    expect(profile.coding.fktFzgCodieren).toBe(true);
    expect(profile.coding.fktKernfunktionen).toBe(true);
    expect(profile.coding.zcsutLesen).toBe(true);
  });

  it('Default profile is read-only-ish (no per-car coding)', () => {
    const path = join(PFL_DIR, '01_Default.pfl');
    if (!existsSync(path)) return;
    const profile = parsePfl(readFileSync(path, 'latin1'));
    expect(profile.coding.fktFzgCodieren).toBe(false);
    expect(profile.coding.fktKernfunktionen).toBe(false);
  });
});
