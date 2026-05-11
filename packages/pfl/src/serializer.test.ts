import { describe, expect, it } from 'vitest';
import { parsePfl } from './parser.js';
import { serializePfl } from './serializer.js';

describe('serializePfl', () => {
  it('produces the canonical section order', () => {
    const minimal = `[HEADER]
ProfilFormatVersion=3.0
ProfilBezeichnung=Test
ProfilKommentar=
ProfilTag=
ProfilMonat=
ProfilJahr=
ProfilPruefsumme=1234

[FGNR_ZCS]
FgNrEingabeModus=1

[ASW]
[FSWPSW]
[NETTODATEN]
[SGET]
[CODING]
[INDIVID]
[VERIFIKATION]
[APPLIKATION]
AppKennung=SERIE
`;
    const profile = parsePfl(minimal);
    const out = serializePfl(profile);
    // Section headers appear in canonical order.
    const headers = out.match(/^\[[A-Z_]+\]$/gm) ?? [];
    expect(headers).toEqual([
      '[HEADER]',
      '[FGNR_ZCS]',
      '[ASW]',
      '[FSWPSW]',
      '[NETTODATEN]',
      '[SGET]',
      '[CODING]',
      '[INDIVID]',
      '[VERIFIKATION]',
      '[APPLIKATION]',
    ]);
  });

  it('preserves ProfilPruefsumme byte-stable', () => {
    const original = `[HEADER]
ProfilFormatVersion=3.0
ProfilBezeichnung=X
ProfilKommentar=
ProfilTag=
ProfilMonat=
ProfilJahr=
ProfilPruefsumme=BEEF

[APPLIKATION]
AppKennung=SERIE
`;
    const profile = parsePfl(original);
    const out = serializePfl(profile);
    expect(out).toMatch(/ProfilPruefsumme=BEEF/);
  });

  it('round-trips an Expertenmodus-style profile', () => {
    const full = `[HEADER]
ProfilFormatVersion=3.0
ProfilBezeichnung=Expertenmodus 2.0
ProfilKommentar=Codierprofil
ProfilTag=
ProfilMonat=
ProfilJahr=
ProfilPruefsumme=0079

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
FswPswLesenModus=1
FswPswTrace=1
FswPswManipulieren=1
FswPswLeseDatei=

[NETTODATEN]
NettoDatenLesenModus=1
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
    const parsed = parsePfl(full);
    const out = serializePfl(parsed);
    // Reparse the serialised form — same result.
    const reparsed = parsePfl(out);
    expect(reparsed).toEqual(parsed);
    // And the serialised form matches byte-for-byte (modulo trailing newline conventions).
    expect(out.trim().split('\n')).toEqual(full.trim().split('\n'));
  });
});
