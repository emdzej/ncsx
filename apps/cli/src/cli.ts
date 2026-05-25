#!/usr/bin/env node
/**
 * `ncsx` — command-line companion to @emdzej/ncsx-web.
 *
 * v1 surface (intentionally small):
 *   ncsx patch from-man    .MAN → .ncsxpatch.yaml
 *   ncsx patch to-man      .ncsxpatch.yaml → one .MAN per module
 *   ncsx patch info        Summary of either file format
 *
 * Future commands live under their own group (`ncsx code …`,
 * `ncsx daten …`). The CLI stays a thin orchestration layer over
 * the ncsx-* packages; no business logic lives here.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerPatchCommand } from './patch.js';

const program = new Command();

program
  .name('ncsx')
  .description(
    `Command-line companion to ncsx-web.\n\nWorks with the same data formats: ${chalk.cyan('.ncsxpatch.yaml')} patch documents and NCSEXPER ${chalk.cyan('.MAN')} files.`,
  )
  .version('0.1.0');

registerPatchCommand(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(chalk.red(`fatal: ${message}\n`));
  process.exit(1);
});
