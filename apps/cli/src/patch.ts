/**
 * `ncsx patch` — subcommand group for working with patch files.
 *
 * Three subcommands today:
 *   - from-man: convert one NCSEXPER `.MAN` snapshot to a
 *     `.ncsxpatch.yaml` document. Needs `--chassis` + `--module`
 *     since the MAN format doesn't carry that context.
 *   - to-man: convert a `.ncsxpatch.yaml` back into one `.MAN`
 *     per module. Each module is emitted as `<module>.MAN` under
 *     the output directory.
 *   - info: print a summary of either file format. Auto-detects
 *     by extension; falls back to content sniffing on ambiguous
 *     inputs (no extension, `.txt`, etc.).
 */

import { Command } from 'commander';
import { runFromMan } from './patch-from-man.js';
import { runToMan } from './patch-to-man.js';
import { runInfo } from './patch-info.js';

export function registerPatchCommand(program: Command): void {
  const patch = program
    .command('patch')
    .description('Convert + inspect .ncsxpatch.yaml ↔ .MAN files.');

  patch
    .command('from-man')
    .description('Convert an NCSEXPER .MAN snapshot to a .ncsxpatch.yaml document.')
    .argument('<input>', 'path to a .MAN file (e.g. WORK/FSW_PSW.MAN)')
    .requiredOption('--chassis <code>', 'canonical chassis code (E46, E60, F30, …)')
    .requiredOption('--module <name>', 'SGFAM short name the patch targets (LCM, GM5, KOMBI, …)')
    .option('--title <text>', 'patch title (defaults to <module> on <chassis>)')
    .option('--description <text>', 'long-form description')
    .option('--author <name>', 'author identifier')
    .option('--keywords <list>', 'comma-separated tags', commaSeparated)
    .option('-o, --output <path>', 'output .ncsxpatch.yaml path (default: stdout)')
    .action(runFromMan);

  patch
    .command('to-man')
    .description('Convert a .ncsxpatch.yaml document to one .MAN file per module.')
    .argument('<input>', 'path to a .ncsxpatch.yaml file')
    .option('-o, --output-dir <dir>', 'output directory for .MAN files (default: ./)', './')
    .option('--prefix <text>', 'filename prefix (default: empty — files are <module>.MAN)')
    .option('--stdout', 'print all modules to stdout (separated by ---), ignore --output-dir', false)
    .action(runToMan);

  patch
    .command('info')
    .description('Print a summary of a patch file (.ncsxpatch.yaml or .MAN).')
    .argument('<file>', 'path to a .ncsxpatch.yaml or .MAN file')
    .option('--json', 'machine-readable JSON instead of the human-rendered view', false)
    .action(runInfo);
}

function commaSeparated(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}
