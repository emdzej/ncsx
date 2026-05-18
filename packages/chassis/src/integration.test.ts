import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadChassis } from './loader.js';
import { nodeChassisSource } from './source-node.js';

const DATEN_ROOT = join(homedir(), 'Downloads', 'inpa', 'NCSEXPER', 'DATEN');
const haveSamples = existsSync(DATEN_ROOT);

(haveSamples ? describe : describe.skip)('integration — real DATEN tree', () => {
  it('loads E46 end-to-end and finds SGFAM rows + ZST records', async () => {
    const src = nodeChassisSource(DATEN_ROOT);
    const chassis = await loadChassis(src, 'E46');
    expect(chassis.code).toBe('E46');
    expect(chassis.dir).toBe('e46');
    // SGFAM should have lots of SGs.
    expect(chassis.sgfam.size).toBeGreaterThan(20);
    const ews = chassis.sgfam.get('EWS');
    expect(ews?.cabd).toBe('A_EWS3');
    // ZST should be loaded and indexed.
    expect(chassis.zst).toBeDefined();
    expect(chassis.zst!.file.records.length).toBeGreaterThan(50);
    // AT dictionary by FA code.
    expect(chassis.at).toBeDefined();
    const w502 = chassis.at!.get('502');
    expect(w502?.fsws).toContain('SWA');
  });

  it('lazily loads a real CABD .Cxx file via listModules + openModule', async () => {
    const src = nodeChassisSource(DATEN_ROOT);
    const chassis = await loadChassis(src, 'E46');
    const modules = await chassis.cabd.listModules();
    // E46 ships at least EWS (.C81 in practice).
    const ews = modules.find((m) => m.moduleName.toUpperCase() === 'EWS');
    if (!ews || ews.codingIndexes.length === 0) return; // shipped install may not have one
    const ci = ews.codingIndexes[0]!;
    const file = await chassis.cabd.openModule(ews.moduleName, ci);
    expect(file.blocks.length).toBeGreaterThan(0);
    // Should be cached on repeat call.
    expect(await chassis.cabd.openModule(ews.moduleName, ci)).toBe(file);
  });
});
