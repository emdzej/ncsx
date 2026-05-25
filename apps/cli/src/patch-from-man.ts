/**
 * `ncsx patch from-man` — read a `.MAN` file, build a
 * `.ncsxpatch.yaml` document, write or stream it.
 *
 * Pure orchestration: file I/O + chalk-coloured warnings. The
 * actual conversion lives in `@emdzej/ncsx-patches`'
 * `patchFromManSelections`, fed by `@emdzej/ncsx-trace`'s
 * `parseFswPswTrace`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { parseFswPswTrace } from '@emdzej/ncsx-trace';
import { patchFromManSelections, serializePatch } from '@emdzej/ncsx-patches';

export interface FromManOptions {
  chassis: string;
  module: string;
  title?: string;
  description?: string;
  author?: string;
  keywords?: string[];
  output?: string;
}

export function runFromMan(input: string, opts: FromManOptions): void {
  const text = readFileSync(input, 'utf-8');
  const selections = parseFswPswTrace(text);

  if (selections.length === 0) {
    process.stderr.write(
      chalk.yellow('warning: .MAN file contains zero FSW entries — patch would be empty.\n'),
    );
    process.exit(1);
  }

  const { patch, warnings } = patchFromManSelections(selections, {
    chassis: opts.chassis,
    module: opts.module,
    title: opts.title,
    description: opts.description,
    author: opts.author,
    keywords: opts.keywords,
  });

  for (const w of warnings) {
    if (w.kind === 'multi-psw-flattened') {
      process.stderr.write(
        chalk.yellow(
          `warning: FSW ${chalk.cyan(w.fsw)} had multiple PSWs — kept ${chalk.green(w.kept)}, dropped ${chalk.dim(w.dropped.join(', '))}\n`,
        ),
      );
    } else {
      process.stderr.write(
        chalk.yellow(`warning: FSW ${chalk.cyan(w.fsw)} has no PSW — skipped\n`),
      );
    }
  }

  const yaml = serializePatch(patch);

  if (opts.output) {
    writeFileSync(opts.output, yaml, 'utf-8');
    const editCount = Object.keys(patch.modules[0]!.edits).length;
    process.stderr.write(
      chalk.green('✓ wrote ') + opts.output + chalk.dim(` (${editCount} edits)\n`),
    );
  } else {
    process.stdout.write(yaml);
  }
}
