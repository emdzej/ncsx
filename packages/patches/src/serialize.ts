/**
 * Serialize a `PatchFile` back to YAML.
 *
 * Output is tuned for hand-editing and review:
 *
 * - Top-level metadata first (schema, title, description, author,
 *   keywords, chassis), then `modules:`.
 * - `description` always uses literal-block (`|`) style so multi-line
 *   strings stay readable. Single-line descriptions still get `|`
 *   for consistency.
 * - `keywords` uses flow style (`[a, b, c]`) — short lists are
 *   easier to scan inline.
 * - `edits` keys preserve insertion order. Callers control the order
 *   they pass in; we don't sort.
 * - Two-space indent. LF line endings (writers can re-encode if
 *   they need CRLF).
 */

import { Document, Scalar, isMap, isScalar, isSeq } from 'yaml';
import type { PatchFile } from './schema.js';

export function serializePatch(patch: PatchFile): string {
  const doc = new Document(patch);
  if (isMap(doc.contents)) {
    for (const item of doc.contents.items) {
      if (!isScalar(item.key)) continue;
      const key = String(item.key.value);
      if (key === 'description' && isScalar(item.value)) {
        (item.value as Scalar).type = Scalar.BLOCK_LITERAL;
      }
      if (key === 'keywords' && isSeq(item.value)) {
        item.value.flow = true;
      }
      if (key === 'modules' && isSeq(item.value)) {
        for (const m of item.value.items) {
          if (!isMap(m)) continue;
          for (const mItem of m.items) {
            if (!isScalar(mItem.key)) continue;
            const mKey = String(mItem.key.value);
            if (mKey === 'description' && isScalar(mItem.value)) {
              (mItem.value as Scalar).type = Scalar.BLOCK_LITERAL;
            }
            if (mKey === 'coding_indexes' && isSeq(mItem.value)) {
              mItem.value.flow = true;
            }
          }
        }
      }
    }
  }
  return doc.toString({
    indent: 2,
    lineWidth: 0,
    minContentWidth: 0,
  });
}
