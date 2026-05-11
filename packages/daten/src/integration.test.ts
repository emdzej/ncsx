import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseDatenFile } from './reader.js';

const NCSEXPER_DIR = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER');
const BR_REF = join(NCSEXPER_DIR, 'DATEN', 'BR_REF.DAT');
const E46_SGET = join(NCSEXPER_DIR, 'DATEN', 'E46', 'E46SGET.000');
const E46_SGVT = join(NCSEXPER_DIR, 'DATEN', 'E46', 'E46SGVT.000');
const E46_DST = join(NCSEXPER_DIR, 'DATEN', 'E46', 'E46DST.000');
const E46_AUSBL = join(NCSEXPER_DIR, 'DATEN', 'E46', 'E46AUSBL.H00');

const haveSamples = existsSync(BR_REF);

(haveSamples ? describe : describe.skip)('integration — real DATEN files', () => {
  it('parses BR_REF.DAT without throwing', () => {
    const buf = readFileSync(BR_REF);
    const file = parseDatenFile(buf);
    // Expect at least one signature and one block.
    expect(file.signatures.length).toBeGreaterThan(0);
    expect(file.blocks.length).toBeGreaterThan(0);
    // BR_ZEILE block is the well-known one.
    const brZeile = file.blocks.find((b) => b.name === 'BR_ZEILE');
    expect(brZeile).toBeDefined();
    expect(brZeile!.rows.length).toBeGreaterThan(0);
  });

  it('BR_REF.DAT lists known chassis', () => {
    const file = parseDatenFile(readFileSync(BR_REF));
    const brZeile = file.blocks.find((b) => b.name === 'BR_ZEILE')!;
    const allValues = brZeile.rows.flatMap((r) => Object.values(r));
    const stringValues = allValues.filter((v): v is string => typeof v === 'string');
    // The shipped BR_REF.DAT lists E31, E32, E33, E34, E36, E38, E39, E46, E52, E53, R40, R50, L20, L30.
    expect(stringValues).toEqual(expect.arrayContaining(['E36', 'E46']));
  });

  it('parses E46SGET.000 (heavy use of the A length-prefixed field)', () => {
    if (!existsSync(E46_SGET)) return;
    const file = parseDatenFile(readFileSync(E46_SGET));
    expect(file.blocks.length).toBeGreaterThan(0);
    const blockNames = file.blocks.map((b) => b.name);
    expect(blockNames).toEqual(
      expect.arrayContaining(['SGAUSWAHL_VM', 'SGAUSWAHL_SGBD', 'SGAUSWAHL_VMSGBD']),
    );
    // SGAUSWAHL_SGBD is the most populated for E46.
    const sgbd = file.blocks.find((b) => b.name === 'SGAUSWAHL_SGBD')!;
    expect(sgbd.rows.length).toBeGreaterThan(50);
    expect(sgbd.rows[0]).toHaveProperty('AUFTRAGSAUSDRUCK');
  });

  it('parses E46SGVT.000', () => {
    if (!existsSync(E46_SGVT)) return;
    const file = parseDatenFile(readFileSync(E46_SGVT));
    expect(file.blocks.length).toBeGreaterThan(0);
  });

  it('parses E46DST.000 (data-station index — SGFAM/ASW/ASW2)', () => {
    if (!existsSync(E46_DST)) return;
    const file = parseDatenFile(readFileSync(E46_DST));
    expect(file.blocks.length).toBeGreaterThan(0);
    const blockNames = file.blocks.map((b) => b.name);
    expect(blockNames).toEqual(expect.arrayContaining(['SGFAM', 'ASW']));
    const sgfam = file.blocks.find((b) => b.name === 'SGFAM')!;
    expect(sgfam.rows.length).toBeGreaterThan(0);
  });

  it('parses E46AUSBL.H00 (small Ausblendliste)', () => {
    if (!existsSync(E46_AUSBL)) return;
    const file = parseDatenFile(readFileSync(E46_AUSBL));
    expect(file.blocks.length).toBeGreaterThan(0);
  });
});
