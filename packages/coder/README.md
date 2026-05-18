# @emdzej/ncsx-coder

End-to-end **coding orchestrator**. Takes a chassis bundle, a user FA, and a list of
FSW/PSW edits, and produces a `CodingPlan[]` — one entry per SG that needs coding, each
with the encoded netto buffer ready to ship to `apiJob(sgbd, 'SG_CODIEREN', hex(netto),
'')`.

This is the single entry point higher-level tools (CLI, web app, automation) reach for
when they want to translate "user said: change KEYCARDREADER to eingebaut" into "bytes go
on the wire here".

Spec: [`../../docs/coding-flow.md`](../../docs/coding-flow.md).

## What it does

```
FA string ──→ faToAsw ──→ AswSet ──→ selectEcus ──→ in-scope SGs
                                                          │
                                                          ▼
                            per-SG edits ──→ load CABD ──→ encodeField → netto bytes
                                                          │
                                                          ▼
                                                   CodingPlan { sgbd, jobName, netto, … }
```

1. **`faToAsw(fa, { chassis })`** — convert the FA string into the ASW bit set.
2. **`selectEcus(chassis, asw)`** — pick in-scope SGs by walking `SGAUSWAHL_*`.
3. **For each selected SG**, group the edits that target it:
   - if `edit.sgName` is set, only that SG;
   - otherwise, any SG whose CABD has a matching FSW id.
4. **For each (SG, edits) pair**, lazily load the CABD `.Cxx` file, find the
   `PARZUWEISUNG_FSW` row for each FSW id, build a `CabdRule`, encode the PSW value into
   the SG's netto buffer.
5. **Return** one `CodingPlan` per SG with the final netto byte buffer.

## Install

```bash
pnpm add @emdzej/ncsx-coder
# or:
"@emdzej/ncsx-coder": "workspace:*"
```

## Quick start

```ts
import { loadChassis } from '@emdzej/ncsx-chassis';
import { nodeChassisSource } from '@emdzej/ncsx-chassis/node';
import { planCoding } from '@emdzej/ncsx-coder';

const chassis = await loadChassis(nodeChassisSource('…/DATEN'), 'E46');

const plans = await planCoding({
  chassis,
  fa: '0205 0502 0524',
  edits: [
    // Numeric FSW + PSW for now — name→id resolution is the next planned addition.
    { sgName: 'KMB', fsw: 0x025F, psw: 0x01 }, // KEYCARDREADER = eingebaut
  ],
});

for (const plan of plans) {
  console.log(plan.sgName, plan.sgbd, plan.jobName, plan.netto.length, 'bytes');
  // Hand plan.netto to apiJob(plan.sgbd, plan.jobName, hexEncode(plan.netto), '')
}
```

## API

```ts
planCoding(options: PlanCodingOptions): Promise<CodingPlan[]>

interface PlanCodingOptions {
  chassis: Chassis;             // from @emdzej/ncsx-chassis
  fa: string;                   // user-supplied FA string
  edits: CodingEdit[];
  jobName?: string;             // default 'SG_CODIEREN'
  initialNetto?: Map<string, Uint8Array>;  // per-SG starting buffers (from CODIERDATEN_LESEN)
  codingIndex?: Map<string, number>;       // per-SG CI override for CABD .Cxx selection
  onWarning?: (msg: string) => void;
}

interface CodingEdit {
  fsw: number;       // u16 FSW id from PARZUWEISUNG_FSW
  psw: number;       // raw PSW value bytes interpreted as a number (currently)
  sgName?: string;   // pin to one SG; otherwise applies to all SGs that declare this FSW
  index?: number;    // if multiple FSW rows match, pin by INDEX
  blocknr?: number;  // if multiple match, pin by BLOCKNR
}

interface CodingPlan {
  sgName: string;
  sgbd: string;      // EDIABAS SGBD file name (e.g. 'KMBI_E60')
  cabd: string;      // CABD module name (e.g. 'A_KMBI_E60')
  jobName: string;   // e.g. 'SG_CODIEREN'
  netto: Uint8Array; // bytes to flash to this SG
  applied: AppliedEdit[];
  skipped: { edit: CodingEdit; reason: string }[];
  source: SelectionSource;  // which SGAUSWAHL_* block surfaced this SG
}
```

## Initial netto buffer

By default, each SG's plan starts from a zero-filled buffer sized to fit every
`PARZUWEISUNG_FSW` row's `WORTADR+BYTEADR`. If you want to flash a **delta** on top of the
ECU's current coding, pass `initialNetto.get(sgName)` for each SG — typically the bytes
you just read with `CODIERDATEN_LESEN`.

## What it doesn't do (yet)

- **Read ECU first.** Production NCSEXPER calls `CODIERDATEN_LESEN` for each SG to fetch
  the current coding, then splices edits on top. The orchestrator currently expects you to
  pre-fetch and pass via `initialNetto`.
- **FSW/PSW name resolution.** `fsw` must be the numeric u16 id; `psw` must be the raw
  value. `chassis.swtFsw` / `chassis.swtPsw` give you the lookups; a thin name-resolver
  helper is the next planned addition (see `STATUS.md` resume entry points).
- **Wire transfer.** The plan is data; sending it to the ECU is the caller's job —
  typically [`@emdzej/ediabasx`](../../../ediabasx/) calling
  `apiJob(plan.sgbd, plan.jobName, hex(plan.netto), '')`.

## Related

- [`@emdzej/ncsx-chassis`](../chassis/) — supplies the chassis bundle this consumes.
- [`@emdzej/ncsx-fa-asw`](../fa-asw/) + [`@emdzej/ncsx-ecu-select`](../ecu-select/) —
  used internally to pick SGs.
- [`@emdzej/ncsx-cabd`](../cabd/) — per-edit encoding.
- [`@emdzej/ncsx-trace`](../trace/) — for the same edits as TRC/MAN files.
- Spec: [`../../docs/coding-flow.md`](../../docs/coding-flow.md).
