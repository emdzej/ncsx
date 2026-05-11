# @emdzej/ncsx-coder

End-to-end coding orchestrator. Given:

- a **chassis bundle** (`@emdzej/ncsx-chassis`),
- a user-supplied **FA** (`@emdzej/ncsx-fa-asw`),
- a list of **FSW/PSW edits** (numeric `fsw` id + raw `psw` value, optionally pinned to one SG),

produces a `CodingPlan[]` — one entry per ECU that needs coding, with the resolved CABD rule
set, the mutated netto byte buffer, and the EDIABAS job name to invoke (typically
`SG_CODIEREN` / `CODIERDATEN_SCHREIBEN`).

Spec: [`../../docs/coding-flow.md`](../../docs/coding-flow.md).

## Quick start

```ts
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';
import { planCoding } from '@emdzej/ncsx-coder';

const chassis = await loadChassis(nodeChassisSource('…/DATEN'), 'E46');

const plans = await planCoding({
  chassis,
  fa: '0205 0502 0524',
  edits: [
    { sgName: 'KMB', fsw: 0x025F, psw: 0x01 }, // KEYCARDREADER = eingebaut
  ],
});

for (const plan of plans) {
  console.log(plan.sgName, plan.sgbd, plan.jobName, plan.netto.length, 'bytes');
  // Hand plan.netto to apiJob(plan.sgbd, plan.jobName, hexEncode(plan.netto), '')
}
```

## What it does

1. Converts FA → ASW (`faToAsw`).
2. Walks SGAUSWAHL_* (`selectEcus`) to pick in-scope SGs.
3. For each SG (or one if the edit pins `sgName`):
   - Lazily loads the CABD `.Cxx` file via `chassis.cabd.forSg`.
   - Indexes `PARZUWEISUNG_FSW` rows by FSW id.
   - For each edit targeting this SG, encodes the PSW value into the netto buffer via
     `@emdzej/ncsx-cabd`'s `encodeField`.
4. Returns one `CodingPlan` per affected SG with the final netto byte buffer.

## What it doesn't do (yet)

- **Read ECU first.** Production NCSEXPER calls `CODIERDATEN_LESEN` to fetch the current
  netto, then splices edits on top. The orchestrator currently starts from a zero-filled or
  ANLIEFERZUSTAND-derived buffer. Pass `initialNetto` if you already read from the bus.
- **FSW/PSW name resolution.** `fsw` must be the numeric u16 id; `psw` must be the raw value.
  Once we decode the SWTFSW / SWTPSW tables (or whatever NCSEXPER uses) we'll add a
  by-name overload.
- **Wire transfer.** The plan is data; sending it to the ECU is the caller's job (typically
  via [`@emdzej/ediabasx`](../../../ediabasx/) once the wire is glued in).
