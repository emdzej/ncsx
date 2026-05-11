# @emdzej/ncsx-fa-asw

Converts a user-facing **FA** (Auftrag — order/option string) into the **ASW bit set** the
[`@emdzej/ncsx-predicate`](../predicate/) evaluator consumes when matching
`AUFTRAGSAUSDRUCK` rows in `<BR>SGET.000`.

Spec: [`../../docs/ecu-selection.md` §3.3](../../docs/ecu-selection.md#33-step-3--fa--zcs--asw).

## Mental model

Each FA token is a 4-digit short-code (SA code, option code). The token's bytes are how the
predicate's `S<id-lo><id-hi>` opcode encodes the same SA code on the wire — `0902` ↔ `S 02 09`.
The resulting ASW set is a `Set<number>` keyed by those `u16` SA IDs.

## Quick start

```ts
import { faToAsw } from '@emdzej/ncsx-fa-asw';
import { evalAuftragsausdruck } from '@emdzej/ncsx-predicate';

const asw = faToAsw('$0902 $0524 $0205');
// asw = Set([0x0902, 0x0524, 0x0205])

evalAuftragsausdruck(predicateBytes, asw);
```

With a chassis (for AT.M00-driven Zwang/forced-inclusion expansion):

```ts
import { loadChassis, nodeChassisSource } from '@emdzej/ncsx-chassis';
import { faToAsw } from '@emdzej/ncsx-fa-asw';

const chassis = await loadChassis(nodeChassisSource('…/DATEN'), 'E46');
const asw = faToAsw('$0902', { chassis }); // also pulls in any Zwang codes attached to 0902
```

## What this *doesn't* do (yet)

- ZCS → ASW (use a future `zcs-asw` package — needs the per-module ZCS decoder).
- FSW-name → ASW: the predicate's `S<id>` opcode references SA codes by their 4-hex u16
  encoding, not FSW IDs. If you want to test "is FSW SWA active?", use the chassis's ZST index
  to find the FSW's parent SA codes and look those up instead.
