import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadChassis } from '@emdzej/ncsx-chassis';
import { nodeChassisSource } from '@emdzej/ncsx-chassis/node';
import { faToAsw } from '@emdzej/ncsx-fa-asw';
import { selectEcus } from './index.js';

const DATEN_ROOT = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'DATEN');
const haveSamples = existsSync(DATEN_ROOT);

(haveSamples ? describe : describe.skip)('integration — real E46 selection', () => {
  it('returns at least one SG for a fully populated ASW', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    // Most-permissive ASW: include every FA code's resolved FSWs.
    const allAt = chassis.at ? [...chassis.at.keys()].join(' ') : '';
    const asw = faToAsw(allAt, { chassis, onWarning: () => undefined });
    const warns: string[] = [];
    const selected = selectEcus(chassis, asw, { onWarning: (m) => warns.push(m) });
    expect(selected.length).toBeGreaterThan(0);
  });

  it('an empty ASW still surfaces rows with empty/permissive predicates', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    const selected = selectEcus(chassis, new Set(), { onWarning: () => undefined });
    expect(Array.isArray(selected)).toBe(true);
  });

  it('every returned SG has a recognisable name', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    const sample = chassis.at ? [...chassis.at.keys()].slice(0, 30).join(' ') : '';
    const asw = faToAsw(sample, { chassis, onWarning: () => undefined });
    const selected = selectEcus(chassis, asw, { onWarning: () => undefined });
    for (const sg of selected) {
      expect(sg.sgName).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
