import { describe, expect, it } from 'vitest';
import { xorFoldCrc } from '@emdzej/ncsx-daten';
import { inMemoryChassisSource, loadChassis } from '@emdzej/ncsx-chassis';
import { planCoding } from './index.js';

// ---------------------- frame-building helpers ----------------------

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function frame(type: number, payload: ArrayLike<number>): Uint8Array {
  const size = payload.length;
  const head = Uint8Array.from([size, type & 0xff, (type >> 8) & 0xff, ...Array.from(payload)]);
  const crc = xorFoldCrc(head);
  return Uint8Array.from([...head, crc]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const SIG1 = frame(0x0100, [0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x63]);
const SIG2 = frame(0x0200, [0x02]);
const DIV = frame(0xff00, []);

// ---------------------- minimal BR_REF.DAT ----------------------

function buildBrRef(codes: string[]): Uint8Array {
  return concat(
    SIG1,
    SIG2,
    frame(0x0300, [0x01, 0x00, ...ascii('BR_ZEILE'), 0x00]),
    frame(0x0400, [...ascii('S'), 0x00]),
    frame(0x0500, [...ascii('CODE'), 0x00]),
    DIV,
    ...codes.map((c) => frame(0x0001, [...ascii(c), 0x00])),
  );
}

// ---------------------- minimal <BR>SGET.000 ----------------------

/**
 * Build a <BR>SGET.000 with one SGAUSWAHL_SGBD row for `sgName`/`cabd`/`sgbd`. The row has an
 * empty AUFTRAGSAUSDRUCK (so it matches every FA) and a null INDEX.
 *
 * SGAUSWAHL_SGBD format: SSSSSA{B} → SGNAME, CBD, CABD, SGBD, UMRSG, AUFTRAGSAUSDRUCK, INDEX
 */
function buildSget(sgName: string, cbd: string, cabd: string, sgbd: string): Uint8Array {
  const rowPayload = [
    ...ascii(sgName), 0x00,
    ...ascii(cbd), 0x00,
    ...ascii(cabd), 0x00,
    ...ascii(sgbd), 0x00,
    ...ascii('X'), 0x00, // UMRSG
    0x00,                 // AUFTRAGSAUSDRUCK length-prefix = 0
    0x00,                 // INDEX optional flag = absent
  ];
  return concat(
    SIG1,
    SIG2,
    frame(0x0300, [0x00, 0x00, ...ascii('DATEINAME'), 0x00]),
    frame(0x0400, [...ascii('S'), 0x00]),
    frame(0x0500, [...ascii('NAME'), 0x00]),
    frame(0x0300, [0x03, 0x00, ...ascii('SGAUSWAHL_SGBD'), 0x00]),
    frame(0x0400, [...ascii('SSSSSA{B}'), 0x00]),
    frame(
      0x0500,
      [...ascii('SGNAME,CBD,CABD,SGBD,UMRSG,AUFTRAGSAUSDRUCK,INDEX'), 0x00],
    ),
    DIV,
    frame(0x0003, rowPayload),
  );
}

// ---------------------- minimal CABD .Cxx ----------------------

/**
 * Build a CABD `.Cxx` containing one PARZUWEISUNG_FSW row:
 *   { WORTADR=4, BYTEADR=1, FSW=0x025F, MASKE=[0xFF], EINHEIT='h' }
 *
 * Format: "{L}LWW{B}(B){B}{B}" → BLOCKNR, WORTADR, BYTEADR, FSW, INDEX, MASKE, EINHEIT, INDIVID
 */
function buildSimpleCabd(): Uint8Array {
  const rowPayload = [
    0x00,                         // BLOCKNR — optional absent
    0x04, 0x00, 0x00, 0x00,       // WORTADR = 0x00000004 (L)
    0x01, 0x00,                   // BYTEADR = 0x0001 (W)
    0x5f, 0x02,                   // FSW = 0x025F (W)
    0x00,                         // INDEX — optional absent
    0x01, 0x00, 0xff,             // MASKE = collection of 1 byte = [0xFF]
    0x01, 0x68,                   // EINHEIT — optional present, 'h'
    0x00,                         // INDIVID — optional absent
  ];

  return concat(
    SIG1,
    SIG2,
    frame(0x0300, [0x12, 0x00, ...ascii('PARZUWEISUNG_FSW'), 0x00]),
    frame(0x0400, [...ascii('{L}LWW{B}(B){B}{B}'), 0x00]),
    frame(0x0500, [...ascii('BLOCKNR,WORTADR,BYTEADR,FSW,INDEX,MASKE,EINHEIT,INDIVID'), 0x00]),
    DIV,
    frame(0x0012, rowPayload),
  );
}

// ---------------------- chassis fixture ----------------------

const SGFAM = `S TST A_TST C_TST 0 0
`;

function buildFixture(): Map<string, Uint8Array> {
  return new Map<string, Uint8Array>([
    ['BR_REF.DAT', buildBrRef(['E46'])],
    ['e46/E46DST.000', concat(SIG1, SIG2, DIV)],
    ['e46/E46SGET.000', buildSget('TST', 'C01', 'A_TST', 'C_TST')],
    ['e46/E46SGFAM.DAT', Uint8Array.from(ascii(SGFAM))],
    ['e46/A_TST.C07', buildSimpleCabd()],
  ]);
}

// ---------------------- tests ----------------------

describe('planCoding — happy path', () => {
  it('produces a CodingPlan with the FSW value spliced into netto', async () => {
    const chassis = await loadChassis(inMemoryChassisSource(buildFixture()), 'E46');
    const plans = await planCoding({
      chassis,
      fa: '',
      edits: [{ fsw: 0x025f, psw: 0x42 }],
      codingIndex: new Map([['TST', 0x07]]),
    });

    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    expect(plan.sgName).toBe('TST');
    expect(plan.sgbd).toBe('C_TST');
    expect(plan.cabd).toBe('A_TST');
    expect(plan.jobName).toBe('SG_CODIEREN');
    expect(plan.applied).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
    expect(plan.netto.length).toBeGreaterThanOrEqual(5);
    expect(plan.netto[4]).toBe(0x42);
  });

  it('uses a supplied initial netto buffer', async () => {
    const chassis = await loadChassis(inMemoryChassisSource(buildFixture()), 'E46');
    const initial = Uint8Array.from([0x11, 0x22, 0x33, 0x44, 0x00, 0x66, 0x77, 0x88]);
    const plans = await planCoding({
      chassis,
      fa: '',
      edits: [{ fsw: 0x025f, psw: 0x99 }],
      codingIndex: new Map([['TST', 0x07]]),
      initialNetto: new Map([['TST', initial]]),
    });
    expect(Array.from(plans[0]!.netto)).toEqual([0x11, 0x22, 0x33, 0x44, 0x99, 0x66, 0x77, 0x88]);
  });

  it('honours a custom job name', async () => {
    const chassis = await loadChassis(inMemoryChassisSource(buildFixture()), 'E46');
    const plans = await planCoding({
      chassis,
      fa: '',
      edits: [{ fsw: 0x025f, psw: 0x01 }],
      codingIndex: new Map([['TST', 0x07]]),
      jobName: 'SG_CODIEREN_OHNE_CI',
    });
    expect(plans[0]!.jobName).toBe('SG_CODIEREN_OHNE_CI');
  });
});

describe('planCoding — pinning edits by sgName', () => {
  it('only applies an edit to the named SG', async () => {
    const chassis = await loadChassis(inMemoryChassisSource(buildFixture()), 'E46');
    const plans = await planCoding({
      chassis,
      fa: '',
      edits: [{ sgName: 'OTHER', fsw: 0x025f, psw: 0x42 }],
      codingIndex: new Map([['TST', 0x07]]),
    });
    expect(plans).toEqual([]);
  });
});

describe('planCoding — skipped edits', () => {
  it('records unknown-FSW edits in plan.skipped', async () => {
    const chassis = await loadChassis(inMemoryChassisSource(buildFixture()), 'E46');
    const plans = await planCoding({
      chassis,
      fa: '',
      edits: [{ fsw: 0xdead, psw: 0x42 }],
      codingIndex: new Map([['TST', 0x07]]),
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.skipped).toHaveLength(1);
    expect(plans[0]!.skipped[0]!.reason).toMatch(/not in CABD/);
    expect(plans[0]!.applied).toEqual([]);
  });
});

describe('planCoding — multiple SGs', () => {
  it('routes each edit to its matching SG by FSW id', async () => {
    // Fixture: two SGs each with one FSW.
    const SGFAM_2 = `S TST A_TST C_TST 0 0
S OTH A_OTH C_OTH 0 0
`;
    const files = new Map<string, Uint8Array>([
      ['BR_REF.DAT', buildBrRef(['E46'])],
      ['e46/E46DST.000', concat(SIG1, SIG2, DIV)],
      [
        'e46/E46SGET.000',
        concat(
          // Two rows, identical format
          SIG1,
          SIG2,
          frame(0x0300, [0x00, 0x00, ...ascii('DATEINAME'), 0x00]),
          frame(0x0400, [...ascii('S'), 0x00]),
          frame(0x0500, [...ascii('NAME'), 0x00]),
          frame(0x0300, [0x03, 0x00, ...ascii('SGAUSWAHL_SGBD'), 0x00]),
          frame(0x0400, [...ascii('SSSSSA{B}'), 0x00]),
          frame(0x0500, [...ascii('SGNAME,CBD,CABD,SGBD,UMRSG,AUFTRAGSAUSDRUCK,INDEX'), 0x00]),
          DIV,
          frame(0x0003, [
            ...ascii('TST'), 0x00,
            ...ascii('C01'), 0x00,
            ...ascii('A_TST'), 0x00,
            ...ascii('C_TST'), 0x00,
            ...ascii('X'), 0x00,
            0x00, 0x00,
          ]),
          frame(0x0003, [
            ...ascii('OTH'), 0x00,
            ...ascii('C01'), 0x00,
            ...ascii('A_OTH'), 0x00,
            ...ascii('C_OTH'), 0x00,
            ...ascii('X'), 0x00,
            0x00, 0x00,
          ]),
        ),
      ],
      ['e46/E46SGFAM.DAT', Uint8Array.from(ascii(SGFAM_2))],
      ['e46/A_TST.C07', buildSimpleCabd()],
      ['e46/A_OTH.C07', buildSimpleCabd()],
    ]);

    const chassis = await loadChassis(inMemoryChassisSource(files), 'E46');
    const plans = await planCoding({
      chassis,
      fa: '',
      edits: [
        { sgName: 'TST', fsw: 0x025f, psw: 0x01 },
        { sgName: 'OTH', fsw: 0x025f, psw: 0x02 },
      ],
      codingIndex: new Map([['TST', 0x07], ['OTH', 0x07]]),
    });
    expect(plans.map((p) => p.sgName).sort()).toEqual(['OTH', 'TST']);
    const tst = plans.find((p) => p.sgName === 'TST')!;
    const oth = plans.find((p) => p.sgName === 'OTH')!;
    expect(tst.netto[4]).toBe(0x01);
    expect(oth.netto[4]).toBe(0x02);
  });
});
