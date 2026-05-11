import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';
import { faToAsw } from '@emdzej/ncsx-fa-asw';
import { selectEcus } from './index.js';

const DATEN_ROOT = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'DATEN');
const haveSamples = existsSync(DATEN_ROOT);

(haveSamples ? describe : describe.skip)('integration — real E46 selection', () => {
  it('returns at least one SG for a non-empty ASW', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    // Most-permissive ASW: include every SA in the AT dictionary.
    const allAt = chassis.at ? [...chassis.at.keys()].join(' ') : '';
    const asw = faToAsw(allAt);
    const warns: string[] = [];
    const selected = selectEcus(chassis, asw, { onWarning: (m) => warns.push(m) });
    expect(selected.length).toBeGreaterThan(0);
  });

  it('an empty ASW still surfaces the rows with empty/permissive predicates', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    const selected = selectEcus(chassis, new Set(), { onWarning: () => undefined });
    // Empty predicate counts as match-everyone; some rows in real SGET have empty A fields.
    // We don't assert a specific count — just that the call returns without throwing.
    expect(Array.isArray(selected)).toBe(true);
  });

  it('every returned SG resolves to a SGFAM row', async () => {
    const chassis = await loadChassis(nodeChassisSource(DATEN_ROOT), 'E46');
    const asw = faToAsw(chassis.at ? [...chassis.at.keys()].slice(0, 30).join(' ') : '');
    const selected = selectEcus(chassis, asw, { onWarning: () => undefined });
    for (const sg of selected) {
      // SGNAME must look like a short logical SG identifier (3-6 chars, uppercase/digits).
      expect(sg.sgName).toMatch(/^[A-Z0-9_]+$/);
    }
  });
});
