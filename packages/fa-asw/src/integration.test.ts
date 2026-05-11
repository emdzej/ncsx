import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';
import { faToAsw } from './index.js';

const DATEN_ROOT = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'DATEN');
const haveSamples = existsSync(DATEN_ROOT);

(haveSamples ? describe : describe.skip)('integration — real E46 FA → ASW', () => {
  it('loads chassis with SWTASW table populated', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    expect(chassis.swtAsw).toBeDefined();
    expect(chassis.swtAsw!.byKeyword.size).toBeGreaterThan(50);
    // From earlier RE: COUP = 0x0016, TOUR = 0x001E
    expect(chassis.swtAsw!.byKeyword.get('COUP')).toBe(0x0016);
    expect(chassis.swtAsw!.byKeyword.get('TOUR')).toBe(0x001e);
  });

  it('BL91 (Coupe M3 LL) FA → ASW includes COUP', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    const asw = faToAsw('BL91', { chassis, includeZwang: false });
    // BL91 record activates `E46 COUP S54B32 LL NEBELSCHEINW GESCHW_REG KM_TACHO DEUTSCH …`
    const coupId = chassis.swtAsw!.byKeyword.get('COUP');
    expect(coupId).toBeDefined();
    expect(asw.has(coupId!)).toBe(true);
  });

  it('predicate (TOUR | (COUP & US) | PU99) gates on US-Coupe FA', async () => {
    const { evalAuftragsausdruck } = await import('@emdzej/ncsx-predicate');
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    // E46SGET.000 MRS2 row: !( S 0x001E | S 0x0016 + S 0x0029 | S 0x005E )
    // Reading: ! ( TOUR , COUP + US , PU99 ) — OR binds looser than AND.
    const predicateBytes = Uint8Array.from([
      0x21,                         // !
      0x28,                         // (
      0x53, 0x1e, 0x00,             //   S 0x001E (TOUR)
      0x2c,                         //   ,
      0x53, 0x16, 0x00,             //   S 0x0016 (COUP)
      0x2b,                         //   +
      0x53, 0x29, 0x00,             //   S 0x0029 (US)
      0x2c,                         //   ,
      0x53, 0x5e, 0x00,             //   S 0x005E (PU99)
      0x29,                         // )
    ]);
    // BL93 + V0302 is a US Coupe; predicate inner evaluates true; outer ! → false.
    const usCoupeAsw = faToAsw('BL93', { chassis, includeZwang: false });
    expect(usCoupeAsw.has(0x0016)).toBe(true); // COUP
    const usId = chassis.swtAsw!.byKeyword.get('US');
    if (usId !== undefined) expect(usCoupeAsw.has(usId)).toBe(true);
    expect(evalAuftragsausdruck(predicateBytes, usCoupeAsw)).toBe(false);
  });
});
