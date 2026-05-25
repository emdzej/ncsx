/**
 * `ncsx patch to-man` — read a `.ncsxpatch.yaml` document, emit one
 * `.MAN` file per module (or all of them to stdout with `--stdout`).
 *
 * Per-file format mirrors what NCSEXPER + NCSdummy expect: CRLF line
 * endings, FSW lines sorted alphabetically. The shared writer is
 * `@emdzej/ncsx-trace`'s `writeFswPswSelections`, fed by
 * `@emdzej/ncsx-patches`' `patchToManSelections`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { parsePatch, patchToManSelections } from '@emdzej/ncsx-patches';
import { writeFswPswSelections } from '@emdzej/ncsx-trace';

export interface ToManOptions {
  outputDir?: string;
  prefix?: string;
  stdout?: boolean;
}

export function runToMan(input: string, opts: ToManOptions): void {
  const text = readFileSync(input, 'utf-8');
  const patch = parsePatch(text);
  const selectionsByModule = patchToManSelections(patch);

  const moduleNames = [...selectionsByModule.keys()];
  if (moduleNames.length === 0) {
    process.stderr.write(chalk.yellow('warning: patch has no modules — nothing to write.\n'));
    process.exit(1);
  }

  if (opts.stdout) {
    let first = true;
    for (const [mod, selections] of selectionsByModule) {
      if (!first) process.stdout.write('---\n');
      process.stdout.write(`# ${mod}\n`);
      process.stdout.write(writeFswPswSelections(selections, { lineEnding: '\r\n', sort: true }));
      first = false;
    }
    return;
  }

  const dir = opts.outputDir ?? './';
  const prefix = opts.prefix ?? '';
  for (const [mod, selections] of selectionsByModule) {
    const filename = `${prefix}${mod}.MAN`;
    const path = join(dir, filename);
    const body = writeFswPswSelections(selections, { lineEnding: '\r\n', sort: true });
    writeFileSync(path, body, 'utf-8');
    process.stderr.write(
      chalk.green('✓ wrote ') + path + chalk.dim(` (${selections.length} edits)\n`),
    );
  }
}
