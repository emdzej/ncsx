# @emdzej/ncsx-inpax-cabi-provider

The **CABI/CDH bridge** — implements the 80+ `CDH*` functions NCSEXPER's
`A_*.ipo` dispatchers call. Lets the [`inpax`](https://github.com/emdzej/inpax)
IPO interpreter run BMW's own coding scripts unchanged.

In NCSEXPER.EXE these functions are statically linked C code that the IPO calls
via the `0x0D CALLE` opcode — they own the cabd-parameter store, the binbuf
scratchpad, the slot table for `C_S_LESEN` / `C_S_SCHREIBEN`, the FA byte walker,
and the EDIABAS dispatch surface. We re-implement them on top of an `EdiabasLike`
instance so the IPO runs in the browser identically to how it runs under NCS
Expert.

Signatures from `CABI.H`. Behaviour Ghidra-verified per
[`docs/assumptions.md`](../../docs/assumptions.md).

## Usage

```ts
import { CabiProvider } from "@emdzej/ncsx-inpax-cabi-provider";

const cabi = new CabiProvider({
  ediabas,                                // EdiabasLike
  chassis,                                // loaded Chassis bundle
  currentSgName: "KMB",
  currentCabd: "A_KMB46",
  currentCbd: "C08",                       // .Cxx variant
  currentCodierBaureihe: "E46",
  fa: identity.fa ?? null,                 // optional — IPO's FA walker reads this
});

// 1. Wire the CABI slot table into your inpax VM.
import { buildCabiSystemFunctions } from "./your-syscall-overrides";
const systemFunctions = buildCabiSystemFunctions(cabi, { defaultSgbd: "C_KMB46" });

const vm = new VM(ipo, { runtime, systemFunctions });

// 2. Drive the IPO's `cabimain` dispatcher.
await vm.runStartup();
await cabi.CDHSetCabdPar("JOBNAME", "CODIERDATEN_LESEN");
await vm.execute("cabimain", { pushString: "CODIERDATEN_LESEN" });

// 3. Read back what the IPO published.
const status = cabi.lastJobStatus;          // "OKAY" / "ERROR_*"
const sets = cabi.lastJobSets;              // raw EDIABAS result sets
const cabdPars = cabi.allCabdPars();        // every CDHSetCabdPar write
```

`apps/ncsx-web/src/lib/runtime.svelte.ts` is the reference wiring — it builds the
99-entry syscall slot table from `NCSEXPER_CABI_SLOTS` and dispatches each one
into the right `CabiProvider` method.

## What's implemented

| Group | Coverage |
|---|---|
| EDIABAS bridge | `CDHapiInit/End`, `CDHapiJob`, `CDHapiJobData`, `CDHapiResultText/Int/Digital/Analog/Sets`, `CDHapiCheckJobStatus`, `CDHapiResultBinary` — load-bearing for every read/write. |
| Slot table | `CDHSetDataOrg`, `CDHSetNettoData`, `CDHGetApiJobData`, `CDHBinBufToNettoData` — the read/write packet builder. NCSEXPER's `MakeHeader` (FUN_00443ec0) layout, word-mode + byte-mode, payload length / wordCount / wireAddr math all match. |
| BinBuf | `CDHBinBufCreate/Delete`, `CDHBinBufWriteByte/Word`, `CDHBinBufReadByte/Word`, `CDHBinBufToStr`. |
| CABD pars | `CDHSetCabdPar`, `CDHGetCabdPar`, `CDHSetCabdWordPar`, `CDHGetCabdWordPar`. Per-dispatch scratchpad (NCSEXPER clears at the start of every job per `FUN_00402c70` / `FUN_0044b880`). |
| System data | `CDHSetSystemData`, `CDHGetSystemData` — host-seeded values the IPO reads (`FAHRGESTELL_NR`, …). |
| FA walker | `CDHGetFaVersion`, `CDHGetAnzahlFaElemente`, `CDHGetFaElement` — tokenises the FA string the constructor was given and serves it back per index. |
| Error scratchpad | `CDHSetError`, `CDHTestError`, `CDHResetError` — IPO surfaces recoverable errors here, host reads via `getLastCdhError()`. |
| ZCS / FSW lookup | `CDHGetFswPswFromZcs`, `CDHGetFswPswFromCvt`, `CDHGetBaureiheFromZcs` — currently throw `CdhNotImplementedError`. ZCS decoding via the chassis `<BR>ZST.*` tables is planned but not yet wired. |
| Authentication | `CDHCallAuthenticate`, `CDHAuthGetRandom` — stubs. Requires BMW seed/key tables (not shipped). |

The slot table is **cross-validated 68/68 against the 334k empirical CALL sys
observations** from the 915 CABI IPOs in `NCSEXPER/SGDAT` — see
[`docs/ncsexper-syscall-table.md`](../../docs/ncsexper-syscall-table.md).

## Diagnostic logging

Every load-bearing call logs its round-trip to the console:

```
[CDHapiJob] → ecu=C_KMB46 job=IDENT params(0)=[]
[CDHapiJob] ← job=IDENT JOB_STATUS=OKAY sets=1 set[0]{JOB_STATUS="OKAY", ID_COD_INDEX=8, …}
[CDHGetApiJobData] startAddr=0x20 maxData=12 → maxRecords=12 (WB=2)
[CDHapiJobData] ecu=C_KMB46 job=C_S_LESEN bufHandle=1 buf.size=38 bytes=0102…
[CDHapiJobData] ← job=C_S_LESEN JOB_STATUS=OKAY sets=1 set[0]{CODIER_DATEN=<bin:…>, JOB_STATUS="OKAY"}
[CDHapiResultText] FAHRGESTELL_NR[set=1] → "PM10277"
[CDHSetCabdPar] FAHRGESTELL_NR = "PM10277"
```

That makes it possible to diff against NCSEXPER's `ABLAUF.TRC` when something
unexpected fails.

## Exports

```ts
export { CabiProvider, CdhNotImplementedError };
export type { CdhContext, CdhResult };
export * from "./error-codes";   // COAPI_OK, COAPI_ERROR, COAPI_DIABAS_ERROR, …
export {
  NCSEXPER_CABI_SLOTS,
  getCabiSlot,
  type CabiSlot,
  type CabiParam,
  type CabiCategory,
};
```

## Consumers

- `apps/ncsx-web/src/lib/runtime.svelte.ts` — builds the system-function table
  + drives `cabimain`.
- `apps/ncsx-web/src/lib/process-ecu.ts` — the orchestrators
  (`processEcu` / `processReadCoding` / `processWriteCoding` / `processListJobs` /
  `processRunJob`).
