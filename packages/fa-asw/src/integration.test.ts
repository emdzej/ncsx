import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';
import { faToAsw } from './index.js';

const DATEN_ROOT = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'DATEN');
const haveSamples = existsSync(DATEN_ROOT);

(haveSamples ? describe : describe.skip)('integration — real E46 chassis', () => {
  it('FA tokens that the AT dictionary documents trigger no warnings', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    // SAs 0205, 0502, 0524 are all documented in the shipped AT.
    const warns: string[] = [];
    const asw = faToAsw('0205 0502 0524', {
      chassis,
      onWarning: (w) => warns.push(w.kind),
    });
    expect(warns.filter((w) => w === 'unknown-code')).toEqual([]);
    expect(asw.has(0x0205)).toBe(true);
    expect(asw.has(0x0502)).toBe(true);
    expect(asw.has(0x0524)).toBe(true);
  });

  it('Zwang codes from AT.M00 are auto-included', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    const asw = faToAsw('', { chassis });
    // E46AT.M00 ships with Z entries like `#0904`, `#0305`, `#0905`, `#0306`. They must all
    // appear in the ASW even though the user typed nothing.
    if (chassis.atM00) {
      const expected = chassis.atM00.entries
        .filter((e) => e.category === 'Z')
        .map((e) => parseInt(e.code.replace(/^#/, ''), 16))
        .filter((n) => !Number.isNaN(n));
      for (const id of expected) {
        expect(asw.has(id)).toBe(true);
      }
    }
  });
});
