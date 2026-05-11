import { describe, expect, it } from 'vitest';
import { parsePfl } from './parser.js';
import { PflWarning } from './types.js';

const SAMPLE = `[HEADER]
ProfilFormatVersion=3.0
ProfilBezeichnung=Test Profil
ProfilKommentar=A comment
ProfilTag=
ProfilMonat=
ProfilJahr=
ProfilPruefsumme=0058

[FGNR_ZCS]
FgNrEingabeModus=1
ChecksummeBerechnen=1
LoeschenVorEingabe=0
FktZcsEingeben=1
FktZcsAusSteuerdatei=1
FktZcsAusFahrzeug=1
FktBrAuswahl=1

[ASW]
AswLesenModus=1
AswTrace=1
AswLeseDatei=

[FSWPSW]
FswPswLesenModus=2
FswPswTrace=1
FswPswManipulieren=1
FswPswLeseDatei=

[NETTODATEN]
NettoDatenLesenModus=3
NettoDatenTrace=1
NettoDatenLeseDatei=

[SGET]
SgetLesen=1
FktSgAuswahl=1
FktSgetEingeben=0

[CODING]
ZcsutLesen=1
ZcsSchreibenModus=3
ZcsVorCodierungLoeschen=0
ZcsNurAktuellesSg=0
FktSgCodieren=1
FktFzgCodieren=1
FktCodierJobAendern=1
FktSgAuslesen=1
KonvertierenFswPsw=1
FktKernfunktionen=1
SpezialJobName=
SgCodFktText=
FzgCodFktText=
CiFromSg=0

[INDIVID]
CheckIndividTrace=1
FktIndivid=1
FktKernfunktionen=1

[VERIFIKATION]
CodierungEin=0
VfpEin=0
ZutEin=0
SteuerFileName=

[APPLIKATION]
AppKennung=SERIE
`;

describe('parsePfl — happy path', () => {
  it('parses [HEADER] strings', () => {
    const p = parsePfl(SAMPLE);
    expect(p.header.formatVersion).toBe('3.0');
    expect(p.header.bezeichnung).toBe('Test Profil');
    expect(p.header.kommentar).toBe('A comment');
    expect(p.header.pruefsumme).toBe('0058');
  });

  it('parses [FGNR_ZCS] flags', () => {
    const p = parsePfl(SAMPLE);
    expect(p.fgnrZcs.fgNrEingabeModus).toBe(1);
    expect(p.fgnrZcs.checksummeBerechnen).toBe(true);
    expect(p.fgnrZcs.loeschenVorEingabe).toBe(false);
    expect(p.fgnrZcs.fktZcsEingeben).toBe(true);
    expect(p.fgnrZcs.fktBrAuswahl).toBe(true);
  });

  it('parses Lesemodus values at the extreme of their ranges', () => {
    const p = parsePfl(SAMPLE);
    expect(p.asw.lesenModus).toBe(1);
    expect(p.fswPsw.lesenModus).toBe(2);
    expect(p.nettodaten.lesenModus).toBe(3);
    expect(p.coding.zcsSchreibenModus).toBe(3);
  });

  it('parses [CODING] flags and strings', () => {
    const p = parsePfl(SAMPLE);
    expect(p.coding.fktSgCodieren).toBe(true);
    expect(p.coding.fktFzgCodieren).toBe(true);
    expect(p.coding.spezialJobName).toBe('');
    expect(p.coding.ciFromSg).toBe(false);
  });

  it('parses [APPLIKATION]', () => {
    const p = parsePfl(SAMPLE);
    expect(p.applikation.appKennung).toBe('SERIE');
  });
});

describe('parsePfl — Lesemodus bounds', () => {
  it('warns on AswLesenModus out of [0..2] and clamps to default', () => {
    const corrupt = SAMPLE.replace('AswLesenModus=1', 'AswLesenModus=5');
    const warns: PflWarning[] = [];
    const p = parsePfl(corrupt, { onWarning: (w) => warns.push(w) });
    expect(p.asw.lesenModus).toBe(0); // default
    expect(warns.some((w) => w.kind === 'out-of-range' && w.key === 'AswLesenModus')).toBe(true);
  });

  it('warns on NettoDatenLesenModus out of [0..3]', () => {
    const corrupt = SAMPLE.replace('NettoDatenLesenModus=3', 'NettoDatenLesenModus=99');
    const warns: PflWarning[] = [];
    const p = parsePfl(corrupt, { onWarning: (w) => warns.push(w) });
    expect(p.nettodaten.lesenModus).toBe(0);
    expect(warns.some((w) => w.key === 'NettoDatenLesenModus')).toBe(true);
  });

  it('warns on ZcsSchreibenModus=0 (range is 1..3)', () => {
    const corrupt = SAMPLE.replace('ZcsSchreibenModus=3', 'ZcsSchreibenModus=0');
    const warns: PflWarning[] = [];
    const p = parsePfl(corrupt, { onWarning: (w) => warns.push(w) });
    expect(p.coding.zcsSchreibenModus).toBe(1); // default
    expect(warns.some((w) => w.key === 'ZcsSchreibenModus')).toBe(true);
  });

  it('warns on FgNrEingabeModus out of {1,2}', () => {
    const corrupt = SAMPLE.replace('FgNrEingabeModus=1', 'FgNrEingabeModus=3');
    const warns: PflWarning[] = [];
    parsePfl(corrupt, { onWarning: (w) => warns.push(w) });
    expect(warns.some((w) => w.key === 'FgNrEingabeModus')).toBe(true);
  });

  it('throws in strict mode on out-of-range value', () => {
    const corrupt = SAMPLE.replace('AswLesenModus=1', 'AswLesenModus=5');
    expect(() => parsePfl(corrupt, { strict: true })).toThrow(/AswLesenModus/);
  });
});

describe('parsePfl — boolean robustness', () => {
  it('warns on non-0/1 boolean and falls back to default', () => {
    const corrupt = SAMPLE.replace('ChecksummeBerechnen=1', 'ChecksummeBerechnen=yes');
    const warns: PflWarning[] = [];
    const p = parsePfl(corrupt, { onWarning: (w) => warns.push(w) });
    expect(p.fgnrZcs.checksummeBerechnen).toBe(false);
    expect(warns.some((w) => w.kind === 'malformed' && w.key === 'ChecksummeBerechnen')).toBe(true);
  });
});

describe('parsePfl — preserves ProfilPruefsumme verbatim', () => {
  it('keeps an arbitrary 4-hex tag through parse', () => {
    const custom = SAMPLE.replace('ProfilPruefsumme=0058', 'ProfilPruefsumme=DEAD');
    const p = parsePfl(custom);
    expect(p.header.pruefsumme).toBe('DEAD');
  });
});
