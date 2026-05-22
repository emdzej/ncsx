# @emdzej/ncsx-wire

Shared type contracts for talking to EDIABAS — re-exported by every ncsx package that
needs a minimal `Ediabas`-shape without pulling in `@emdzej/ediabasx-ediabas` directly.

```ts
export interface EdiabasLike {
  loadSgbd(filename: string): Promise<void>;
  executeJob(
    jobName: string,
    options?: { params?: string[]; timeout?: number },
  ): Promise<EdiabasJobResultLike[][]>;
  isConnected(): boolean;
}

export interface EdiabasJobResultLike {
  name: string;
  type: string;
  value: unknown;
}
```

## History

The package used to host wire-direct helpers (`readCoding`, `applyCodingPlan`,
`readCodingIndex`, `identify`) that ran each EDIABAS job through `apiJob` directly,
bypassing the per-CABD `A_*.ipo` dispatcher. Those covered the early bring-up but
silently skipped the IPO's auth gates, multi-step write protocols, and checksum
recalculation steps — see [`docs/ipo-usage.md`](../../docs/ipo-usage.md) for why
that matters.

Both flows now route through the IPO instead:

- **Read** — `processReadCoding` in
  `apps/ncsx-web/src/lib/process-ecu.ts` → `cabimain("CODIERDATEN_LESEN")`.
- **Write** — `processWriteCoding` in the same file →
  `cabimain("SG_CODIEREN")`.

Both use `@emdzej/ncsx-inpax-cabi-provider`'s real BinBuf + slot-table machinery so
the SGBD's `C_S_LESEN` / `C_S_SCHREIBEN` calls see the request packet NCSEXPER
would have built. The wire-direct helpers were removed once the IPO path covered the
same surface; only the shared types stayed.

## Consumers

- `@emdzej/ncsx-identity` — `EdiabasLike` parameter for FA / ZCS / VIN readers.
- `@emdzej/ncsx-inpax-cabi-provider` — `EdiabasLike` in `CdhContext.ediabas`.
