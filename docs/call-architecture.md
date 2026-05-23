# NCS Expert call architecture — IPO ↔ CABI ↔ EDIABAS

The end-to-end flow when NCSEXPER reads a value from an SG is genuinely weird,
took a long thread of ghidra + IPO disassembly to pin down, and underlies
every load-bearing assumption ncsx makes. This is the picture.

> All function addresses below are in `NCSEXPER.EXE` (verified via ghidra MCP).
> When you add behaviour or contest a claim, run
> `mcp__ghidra__decompile_function_by_address` and update the address — that's
> the AGENTS.md rule.

---

## 1. The four layers

```
┌────────────────────────────────────────────────────────────────────┐
│ NCSEXPER.EXE (MFC C++ + statically linked CDH + IPO interpreter)   │
│                                                                    │
│  ┌────────────────────────┐    ┌──────────────────────────────┐   │
│  │ MFC UI                  │    │ COAPI helpers                │   │
│  │  - main dialog          │    │  - coapiReadFgNr  0x0042e430 │   │
│  │  - Choose ECU modal     │    │  - coapiReadAuftrag 0x0042f800│  │
│  │  - Change Job modal     │    │  - coapiReadZcs   0x0042b6e0 │   │
│  │  - Process car          │    │  - …                          │   │
│  └────────────────────────┘    └──────────────────────────────┘   │
│            ▲                              │                        │
│            │ MFC click handlers           │ each helper:           │
│            │                              │   1. set JOBNAME       │
│            └──── user clicks ─────────────┘   2. run IPO via       │
│                                               FUN_00433a70         │
│                                               3. apiResultText     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Embedded IPO interpreter (FUN_00441070 = scheduler)          │ │
│  │ runs the per-CABD A_<cabd>.ipo bytecode                      │ │
│  │                                                              │ │
│  │   cabimain(JOBNAME) {                                        │ │
│  │     switch(JOBNAME) {                                        │ │
│  │       case "FGNR_LESEN":     FgnrLesen();                    │ │
│  │       case "FA_READ":        AuftragLesen();                 │ │
│  │       case "ZCS_LESEN":      ZcsLesen();                     │ │
│  │       case "CODIERDATEN_LESEN": Lesen();                     │ │
│  │       case "SG_CODIEREN":    Cod();                          │ │
│  │       …                                                       │ │
│  │     }                                                         │ │
│  │   }                                                           │ │
│  │                                                              │ │
│  │   FgnrLesen() calls CDH bridge via CALLE opcode 0x0D:        │ │
│  │     CDHapiJob(SGBD, "C_FG_LESEN", "", "")                    │ │
│  │     CDHapiResultText("FAHRGESTELL_NR", 1, "")                │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                          ▲                                         │
│                          │ CALLE 0x0D → name-keyed symbol table    │
│                          ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ CDH / CABI surface — 80+ functions statically linked here.   │ │
│  │  - CDHapiJob          0x0042??  → forwards to api32.dll      │ │
│  │  - CDHapiResultText   0x0042??  → forwards to api32.dll      │ │
│  │  - CDHGetCabdName     0x00432500 (trivial getter)            │ │
│  │  - CDHGetCodierBaureihe 0x005afc60                            │ │
│  │  - …                                                          │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ standard EDIABAS API
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ api32.dll                                                          │
│   - apiJob(SGBD, JOB, params, parameters)                         │
│   - apiResultText(name, &result, &error)                           │
│   - apiInit / apiEnd                                               │
│   - loads SGBD .prg into the BEST/2 interpreter                    │
│   - drives the cable (K-line / D-CAN / ENET) per the SGBD's        │
│     declared protocol                                              │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                              SGBD .prg (BEST/2 bytecode)
                                  │
                                  ▼
                                 ECU
```

---

## 2. The journey of one VIN read

Concrete walkthrough — user clicks "Read ECU" in NCSEXPER with the AKMB
module selected on E46. Each step is what actually happens, verified.

```
1. MFC click handler        (NCSEXPER.EXE C++)
   ↓
2. coapiReadFgNr(SG="AKMB")  ← FUN_0042e430
   ↓
3. FUN_0042ac90 builds the IPO file path from SGAUSWAHL row
   → "A_AKMB46.IPO" (CABD basename from SGAUSWAHL.CABD)
   ↓
4. FUN_00433a70("FGNR_LESEN", "A_AKMB46", 1)   ← the "set JOBNAME + run IPO" wrapper
   │
   ├── FUN_00434a80("JOBNAME", "FGNR_LESEN")    sets the JOBNAME global the IPO reads
   ├── FUN_004324d0("A_AKMB46")                  loads the IPO if not already loaded
   ├── FUN_00441070(0)                           runs the IPO scheduler
   │   │
   │   ▼
   │   IPO interpreter runs A_AKMB46.IPO::cabimain
   │   │
   │   ├── reads JOBNAME = "FGNR_LESEN"
   │   ├── switch matches case "FGNR_LESEN" → calls FgnrLesen()
   │   │
   │   ▼
   │   FgnrLesen() does:
   │   ├── PEMProtokollAusgabe("FgnrLesen")        sys 0x33 (PEM report)
   │   ├── TestCDHFehler(...)                      user-defined helper
   │   │
   │   ├── CDHapiJob("???", "C_FG_LESEN", "", "")  ← **the actual EDIABAS call**
   │   │   │                                        sys CALLE → CDHapiJob in NCSEXPER.EXE
   │   │   │                                        →→→ api32.dll::apiJob(...)
   │   │   │                                        →→→ KOMBI46R.PRG runs C_FG_LESEN
   │   │   │                                        →→→ K-line wire transfer to ECU
   │   │   │                                        →→→ ECU responds with VIN
   │   │   │                                        →→→ api32.dll stores result fields
   │   │   ▼
   │   │   results are now in api32.dll's state, keyed by name
   │   │
   │   ├── PEMSGZ_Kopfzeile("FAHRGESTELL_NR", ...) sys (PEM report header)
   │   └── return from FgnrLesen
   │
   ├── return from cabimain
   ▼
5. Back in coapiReadFgNr's C code, FUN_00433a70 returned
   ↓
6. FUN_0044b570("FAHRGESTELL_NR", &local_40, &error)
   ← apiResultText DIRECTLY from NCSEXPER's C code into api32.dll's state
   ← the IPO's CDHapiJob populated this; the IPO has already exited
   ↓
7. local_40 now holds the VIN string. Validate length (17), copy to caller.
```

**Two punchlines:**

1. **The same EDIABAS state is shared by the IPO and NCSEXPER's C code** — api32.dll
   keeps the last job's result fields in its own memory. The IPO writes them
   via apiJob; NCSEXPER's COAPI reads them via apiResultText after the IPO
   returns. There's no "callback" because there's no separate process.

2. **The IPO doesn't decide which EDIABAS job to call by name from the
   outside.** The host sets JOBNAME globally, then enters the IPO. The IPO's
   `cabimain` dispatches by JOBNAME to a handler. The handler translates the
   contract job name (`FGNR_LESEN`) into the SGBD-specific name (`C_FG_LESEN`)
   and calls apiJob with that. **This per-CABD mapping is the whole reason the
   IPO layer exists**: every CABD module ships its own A_*.ipo with the right
   mappings baked in.

---

## 3. Per-CABD job-name translation table

The IPO is the translation layer. For E46/AKMB (CABD `A_AKMB46`, SGBD
`KOMBI46R.PRG`), the disassembly of `A_KMB46.ipo::cabimain` reveals:

| IPO contract `JOBNAME` | SGBD job called | Result fields read |
|---|---|---|
| `FGNR_LESEN` | `C_FG_LESEN` | `FAHRGESTELL_NR` |
| `FA_READ` | `C_FA_LESEN` (likely; not yet disassembled) | `FA_STREAM` |
| `ZCS_LESEN` | `C_ZCS_LESEN` | `GM_SCHLUESSEL`, `SA_SCHLUESSEL`, `VN_SCHLUESSEL` |
| `CODIERDATEN_LESEN` | `C_S_LESEN` | `CODIER_DATEN`, `CODIERINDEX` |
| `SG_CODIEREN` | `C_S_SCHREIBEN` | `CODIERDATUM`, `CODIERUNG_ERFOLGT` |
| `TEILBEREICH_CODIEREN` | (uses `C_S_AUFTRAG` + `C_S_SCHREIBEN`) | … |
| `FGNR_SCHREIBEN` | (uses `C_FG_LESEN` for verify + checksum write) | … |
| `SG_IDENT` | `IDENT` (passes through) | … |
| `CODIERINDEX_LESEN` | (uses `C_FG_LESEN` indirectly via `scriptchange`) | `CODIERINDEX` |

The exact mapping **differs per CABD**. `B_*.ipo` files (for brake modules)
use `B_S_LESEN` / `B_S_SCHREIBEN`. `D_*.ipo` (diagnose-group dispatchers) have
yet another set. **This is why ncsx must run the IPO to get the mapping
right** — there's no static table to consume.

---

## 4. CABI / CDH function classes

```
┌─────────────────────────────────────────────────────────────────┐
│ CDHapi*    — proxies to api32.dll                                │
│  CDHapiInit / CDHapiEnd / CDHapiJob                             │
│  CDHapiResultText / Int / Digital / Analog / Binary / Sets       │
│  CDHapiCheckJobStatus                                           │
│  CDHapiJobData / GetApiJobData / GetApiJobByteData / Reset…    │
├─────────────────────────────────────────────────────────────────┤
│ CDHGet*    — host-context getters                                │
│  CDHGetCabdName / CDHGetSgbdName / CDHGetCodierBaureihe          │
│  CDHGetSystemData / CDHGetCabdPar / CDHGetCabdWordPar           │
│  CDHGetFaVersion / CDHGetFaElement / CDHGetAnzahlFaElemente    │
│  CDHGetVmZcsProgName / CDHGetVmGerName                          │
│  CDHGetBaureiheFromZcs / CDHGetFswPswFromZcs / -FromCvt        │
│  CDHGetFswPswFromNettoData                                     │
│  CDHGetNettoDataFromCbd / CDHGetNettoMaskFromCbd               │
│  CDHGetFswDataFromCbd / CDHGetFswPswDataFromCbd / -Grp…       │
├─────────────────────────────────────────────────────────────────┤
│ CDHSet*    — host-state mutators                                 │
│  CDHSetSgName / CDHSetBaureihe / CDHSetCbdName                   │
│  CDHSetSystemData / CDHSetCabdPar / CDHSetCabdWordPar           │
│  CDHSetDataOrg / CDHSetReturnVal / CDHSetError                  │
│  CDHSetNettoData / CDHSetNettoMaskData                          │
├─────────────────────────────────────────────────────────────────┤
│ CDH*Fsw / Psw / Grp  — coding mutations (the Cod handler hot path)│
│  CDHActivateFsw / CDHInactivateFsw                              │
│  CDHActivateGrp / CDHInactivateGrp                              │
│  CDHActivateAllFsw / CDHInactivateAllFsw                        │
│  CDHChangePsw                                                   │
│  CDHSaveFswPswList / CDHRestoreFswPswList                       │
│  CDHSaveTmpFswPswList / CDHRestoreTmpFswPswList                 │
├─────────────────────────────────────────────────────────────────┤
│ CDHBinBuf* — handle-based binary buffer API for SGBDs that take │
│              binary parameters (e.g. raw netto write).           │
│  Create / Delete / WriteByte / WriteWord / ReadByte / ReadWord   │
│  ToStr / ToNettoData / Append / Copy                             │
├─────────────────────────────────────────────────────────────────┤
│ CDHAuth*   — SG seed/key authentication (for protected SGs)     │
│  CDHCallAuthenticate / CDHAuthGetRandom                         │
├─────────────────────────────────────────────────────────────────┤
│ CDHId*     — identity verification (runs before coding writes)  │
│  CDHCheckIdent / CDHCheckIdent2 / CDHIdReady                     │
├─────────────────────────────────────────────────────────────────┤
│ CDH*Error  — error state                                         │
│  CDHTestError / CDHResetError / CDHSetError                     │
├─────────────────────────────────────────────────────────────────┤
│ CDHInt*    — interpreter-mode control (internal)                 │
│  CDHIntInit / CDHIntSetMode / CDHIntSetScriptFile / CDHIntTrigger│
└─────────────────────────────────────────────────────────────────┘
```

The full canonical signatures are in `NCSEXPER/SGDAT/CABI.H`.
TypeScript-typed equivalents live in
`packages/inpax-cabi-provider/src/provider.ts`.

---

## 5. How ncsx mirrors this

```
┌────────────────────────────────────────────────────────────────────┐
│ ncsx-web (Svelte 5)                                                │
│                                                                    │
│  ┌────────────────────────┐    ┌──────────────────────────────┐   │
│  │ Svelte UI               │    │ Orchestration (TypeScript)   │   │
│  │  - IdentityPanel        │    │  - identity.readVin/readFa   │   │
│  │  - FunctionTree         │◄──►│  - runtime.startNcsRuntime   │   │
│  │  - SettingsDialog       │    │  - coder.planCoding          │   │
│  └────────────────────────┘    └──────────────────────────────┘   │
│            ▲                              │                        │
│            │ user click                   │ each orchestrator op:  │
│            │                              │   1. setContext        │
│            └─────────────────────────────►│   2. set JOBNAME       │
│                                           │   3. vm.executeBlock   │
│                                           │      (cabimain)        │
│                                           │   4. read result       │
│                                           │      via               │
│                                           │      CabiProvider or   │
│                                           │      EdiabasXProvider  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ @emdzej/inpax-interpreter VM                                 │ │
│  │  - loaded with parsed A_<cabd>.ipo                           │ │
│  │  - dispatches CALL sys / CALL user opcodes through:          │ │
│  │    ┌─────────────────────────────────────────────────────┐   │ │
│  │    │ Provider chain                                       │   │ │
│  │    │  - WebUIProvider         (no-op for batch IPOs)      │   │ │
│  │    │  - EdiabasXProvider      ← apiJob, apiResultText     │   │ │
│  │    │  - CabiProvider          ← CDH* functions            │   │ │
│  │    │  - BrowserNativeImports  ← INI lookups               │   │ │
│  │    │  - Null{Pem,Print,Sim,Sps,Dtm}                       │   │ │
│  │    └─────────────────────────────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                          │                                         │
│                          ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ @emdzej/ediabasx-ediabas (Ediabas class)                     │ │
│  │  - executeJob(jobName, opts) → result sets                   │ │
│  │  - loadSgbd(name) → byte-level .prg load via FS Access API   │ │
│  │  - state shared with EdiabasXProvider via `instance`         │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ @emdzej/ediabasx-interface-serial
                                  ▼
                              SerialInterface + WebSerialTransport
                                  │
                                  ▼
                              K+DCAN cable / OBD-II port / ECU
```

---

## 6. The result fetch — same trick as NCSEXPER

When the IPO runs `cabimain(JOBNAME='FGNR_LESEN')`:

1. The IPO's `FgnrLesen` handler calls `CDHapiJob` (our `CabiProvider`).
2. Our `CDHapiJob` delegates to `ediabas.executeJob(SGBD, 'C_FG_LESEN')`.
3. Result fields land in **two stashes simultaneously**:
   - `EdiabasXProvider.lastResults` (the inpax-side state, accessible to the
     IPO via further CDHapi* calls).
   - `CabiProvider.lastJob.sets` (the mirror we keep — identical content).
4. The IPO continues and may call `CDHapiResultText("FAHRGESTELL_NR", 1, "")`
   to read the result from inside the script.
5. The IPO returns from `cabimain`.
6. Our orchestrator code reads the same `FAHRGESTELL_NR` field from
   `EdiabasXProvider.lastResults` (or by calling `cabiProvider.findResult`)
   — the same trick NCSEXPER's COAPI uses to fetch values from api32.dll
   after the IPO exits.

No callback wiring needed; everything is shared state.

---

## 7. What this means for `packages/wire`

`packages/wire`'s `readCoding` / `applyCodingPlan` / `readVin` etc. call
`ediabas.executeJob('SG_CODIEREN', …)` with the **contract** name. For SGBDs
whose actual job names match the contract (most modern F-series SGBDs), this
works directly. For SGBDs that need per-CABD mapping (E46 era — `KOMBI46R`
uses `C_S_SCHREIBEN`, not `SG_CODIEREN`), the direct path will return
`IFH-0009 ERROR_NR_JOB_NOT_FOUND` and we have to route via the IPO instead.

`packages/wire` is the **fast path** (no IPO interpreter spin-up, no CABI
provider) for SGBDs that don't need translation. The IPO-runtime path
(`apps/web/src/lib/runtime.svelte.ts`) is the **canonical path** that
matches NCSEXPER's behaviour and handles every SGBD correctly.

Both can coexist. The eventual user-visible behaviour:

- For first-class flows (Read ECU / Write ECU on a connected SG), use the
  IPO runtime — NCS-faithful.
- For diagnostic introspection (read coding bytes without running auth /
  state machines), the direct `wire` path is fine.

---

## 8. Open architectural questions (as of 2026-05-19)

- **Does inpax-interpreter dispatch CALLE by ID or by name?** The IPO
  bytecode references CDH functions by name via the constant pool; the
  CALLE opcode (0x0D) reads that string. Inpax's `BrowserNativeImportProvider`
  handles CALLE lookups, but is currently scoped to INI files — needs
  extending to also dispatch CDH* names against our `CabiProvider`. Tracked
  in the runtime TODO.

- **Does NCSEXPER's interpreter share inpax's syscall ID table for the
  non-CALLE opcodes (`CALL sys`)?** `A_KMB46.ipo::FgnrLesen` does
  `CALL sys 0x000D`. Inpax's disassembler annotates 0x000D as `exitwindows`
  (INPA UI), but the operand stack at the call site looks like an apiJob
  signature (SGBD, JOB, params, parameters). Likely NCSEXPER's interpreter
  has a different table for slot 0x0D. **Needs ghidra trace** of how
  NCSEXPER dispatches sys opcode 0x0D before we can run real IPOs end-to-end.

- **When does `JOBNAME` get set on the inpax VM?** Our orchestrator wants
  to set it as a global before `vm.executeBlock(cabimain)`. Need to confirm
  inpax's VM API has a setter for IPO globals; otherwise we patch the
  constant pool or push it as a frame arg.

These are tracked under task #50 (Inpax full integration). Closing them is
how we move from "scaffold compiles" to "Read FA works end-to-end".
