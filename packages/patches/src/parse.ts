/**
 * Parse a `.ncsxpatch.yaml` document. Surface schema violations as a
 * single `PatchSchemaError` whose `issues` carries the full zod
 * issue list — UI can render the first one or pop a list.
 */

import { parse as parseYaml } from 'yaml';
import { PatchFileSchema, PatchSchemaError, type PatchFile } from './schema.js';

export function parsePatch(text: string): PatchFile {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new PatchSchemaError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const result = PatchFileSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
    throw new PatchSchemaError(
      `Invalid patch${where}: ${first?.message ?? 'unknown'}`,
      result.error.issues,
    );
  }
  return result.data;
}
