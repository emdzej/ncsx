# @emdzej/ncsx-translations

CSV parser + label formatter for NCSDummy's community-maintained `Translations.csv` — the
flat dictionary that turns `wert_01` into `Value 01`, `aktiv` into `Enabled`, `GPS_UHR`
into `Use time from GPS`, and ~26,000 other BMW coding keywords into English.

The CSV ships next to `NcsDummy.exe`. It's a single global lookup applied to every FSW,
PSW, group description, and FA-token across all chassis — not scoped by chassis or
module. The file is community-maintained; the header rows preserve the contributor
list and last-modified date.

See [`../../docs/ncsdummy-analysis.md`](../../docs/ncsdummy-analysis.md) for how this
fits into the broader NCSDummy rendering pipeline.

## Install

```bash
pnpm add @emdzej/ncsx-translations
# or in the ncsx monorepo:
"@emdzej/ncsx-translations": "workspace:*"
```

## Quick start

```ts
import { parseTranslationsCsv, formatLabel } from '@emdzej/ncsx-translations';

const csv = await fetch('/translations.csv').then((r) => r.text());
const file = parseTranslationsCsv(csv);

console.log(file.lastModified);           // Date(2019-09-19) or null
console.log(file.contributors);           // ['revtor', 'IcemanBHE', …]
console.log(file.entries.get('wert_01')); // 'Value 01'

// Render a row label the same way NCSDummy does:
formatLabel('wert_01', file.entries);     // 'wert_01  -  Value 01'
formatLabel('NEVERHEARDOF', file.entries); // 'NEVERHEARDOF'
```

## Format

NCSDummy's CSV is ad-hoc — not RFC 4180. The parser is a faithful port of the
character-by-character loop in `Classes/Translations/TranslationFileReader.cs`:

| Token         | Rule                                                          |
|---------------|---------------------------------------------------------------|
| `,` or `;`    | Unquoted cell separator. Inside quoted fields they're literal |
| `"…"`         | Quote-delimit a field. `""` (doubled quote) is one literal `"` |
| Empty body    | Empty rows are skipped                                        |
| Empty translation | Keyword/translation rows with an empty translation are dropped — NCSDummy never adds them to the lookup |
| `CONTRIBUTORS,"a,b,c,…"` | Stashed into `file.contributors` (split on commas)  |
| `LASTMODIFIED,YYYYMMDD`  | Stashed into `file.lastModified` (UTC midnight)     |

## API

| Export                              | Purpose                                        |
|-------------------------------------|------------------------------------------------|
| `parseTranslationsCsv(text)`        | `text → TranslationFile` (entries + meta)      |
| `formatLabel(keyword, translations)` | `"keyword  -  translation"` (NCSDummy style)  |
| `splitLabel(keyword, translations)` | `{ keyword, translation: string \| null }` — for HTML where keyword and translation render as separate spans |
| `TranslationFile`                   | The parsed-file type                           |

## Related

- The CSV itself ships with NCSDummy at
  `/path/to/BMW SOFTWARE/NCS Dummy/Translations.csv` — community-maintained, attribution
  preserved in the `CONTRIBUTORS` row.
- [`@emdzej/ncsx-function-list`](../function-list/) — the catalog this annotates.
- [`@emdzej/ncsx-options`](../options/) — the parallel order-options layer (CVT-driven).
