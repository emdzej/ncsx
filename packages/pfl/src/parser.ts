import { parse as parseIni, type IniFile } from '@emdzej/inpax-ini-parser';
import type {
  ParsePflOptions,
  PflProfile,
  PflWarning,
} from './types.js';

type SectionRecord = Record<string, string | string[] | undefined>;

const defaultProfile = (): PflProfile => ({
  header: {
    formatVersion: '3.0',
    bezeichnung: '',
    kommentar: '',
    tag: '',
    monat: '',
    jahr: '',
    pruefsumme: '0000',
  },
  fgnrZcs: {
    fgNrEingabeModus: 1,
    checksummeBerechnen: false,
    loeschenVorEingabe: false,
    fktZcsEingeben: false,
    fktZcsAusSteuerdatei: false,
    fktZcsAusFahrzeug: false,
    fktBrAuswahl: false,
  },
  asw: { lesenModus: 0, trace: false, leseDatei: '' },
  fswPsw: { lesenModus: 0, trace: false, manipulieren: false, leseDatei: '' },
  nettodaten: { lesenModus: 0, trace: false, leseDatei: '' },
  sget: { sgetLesen: false, fktSgAuswahl: false, fktSgetEingeben: false },
  coding: {
    zcsutLesen: false,
    zcsSchreibenModus: 1,
    zcsVorCodierungLoeschen: false,
    zcsNurAktuellesSg: false,
    fktSgCodieren: false,
    fktFzgCodieren: false,
    fktCodierJobAendern: false,
    fktSgAuslesen: false,
    konvertierenFswPsw: false,
    fktKernfunktionen: false,
    spezialJobName: '',
    sgCodFktText: '',
    fzgCodFktText: '',
    ciFromSg: false,
  },
  individ: { checkIndividTrace: false, fktIndivid: false, fktKernfunktionen: false },
  verifikation: { codierungEin: false, vfpEin: false, zutEin: false, steuerFileName: '' },
  applikation: { appKennung: 'SERIE' },
});

const firstValue = (raw: string | string[] | undefined): string | undefined =>
  Array.isArray(raw) ? raw[0] : raw;

const readString = (section: SectionRecord | undefined, key: string, fallback = ''): string => {
  const v = firstValue(section?.[key]);
  return v ?? fallback;
};

const readBool = (
  section: SectionRecord | undefined,
  sectionName: string,
  key: string,
  fallback: boolean,
  warn: (w: PflWarning) => void,
): boolean => {
  const raw = firstValue(section?.[key]);
  if (raw === undefined || raw === '') return fallback;
  if (raw === '0') return false;
  if (raw === '1') return true;
  warn({
    kind: 'malformed',
    section: sectionName,
    key,
    message: `expected '0' or '1', got '${raw}'`,
  });
  return fallback;
};

const readInt = (
  section: SectionRecord | undefined,
  sectionName: string,
  key: string,
  fallback: number,
  range: { min: number; max: number } | null,
  opts: { strict: boolean; warn: (w: PflWarning) => void },
): number => {
  const raw = firstValue(section?.[key]);
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    opts.warn({
      kind: 'malformed',
      section: sectionName,
      key,
      message: `expected integer, got '${raw}'`,
    });
    return fallback;
  }
  if (range && (parsed < range.min || parsed > range.max)) {
    const msg = `value ${parsed} out of allowed range [${range.min}, ${range.max}]`;
    opts.warn({ kind: 'out-of-range', section: sectionName, key, message: msg });
    if (opts.strict) throw new Error(`[${sectionName}] ${key}: ${msg}`);
    return fallback;
  }
  return parsed;
};

/**
 * Parse a `.pfl` profile string into the typed model. Encoding is ISO-8859-1; pass the file
 * contents decoded as Latin-1 (or use a Buffer's `latin1` toString).
 */
export function parsePfl(content: string, options: ParsePflOptions = {}): PflProfile {
  const { strict = false, onWarning } = options;
  const warn = (w: PflWarning): void => {
    if (onWarning) onWarning(w);
  };

  const ini = parseIni(content) as IniFile;
  const profile = defaultProfile();

  const HEADER = ini.HEADER as SectionRecord | undefined;
  const FGNR = ini.FGNR_ZCS as SectionRecord | undefined;
  const ASW = ini.ASW as SectionRecord | undefined;
  const FSWPSW = ini.FSWPSW as SectionRecord | undefined;
  const NETTO = ini.NETTODATEN as SectionRecord | undefined;
  const SGET = ini.SGET as SectionRecord | undefined;
  const CODING = ini.CODING as SectionRecord | undefined;
  const INDIVID = ini.INDIVID as SectionRecord | undefined;
  const VERIF = ini.VERIFIKATION as SectionRecord | undefined;
  const APPL = ini.APPLIKATION as SectionRecord | undefined;

  // [HEADER]
  profile.header.formatVersion = readString(HEADER, 'ProfilFormatVersion', '3.0');
  profile.header.bezeichnung = readString(HEADER, 'ProfilBezeichnung');
  profile.header.kommentar = readString(HEADER, 'ProfilKommentar');
  profile.header.tag = readString(HEADER, 'ProfilTag');
  profile.header.monat = readString(HEADER, 'ProfilMonat');
  profile.header.jahr = readString(HEADER, 'ProfilJahr');
  profile.header.pruefsumme = readString(HEADER, 'ProfilPruefsumme', '0000');

  // [FGNR_ZCS]
  profile.fgnrZcs.fgNrEingabeModus = readInt(FGNR, 'FGNR_ZCS', 'FgNrEingabeModus', 1, { min: 1, max: 2 }, { strict, warn });
  profile.fgnrZcs.checksummeBerechnen = readBool(FGNR, 'FGNR_ZCS', 'ChecksummeBerechnen', false, warn);
  profile.fgnrZcs.loeschenVorEingabe = readBool(FGNR, 'FGNR_ZCS', 'LoeschenVorEingabe', false, warn);
  profile.fgnrZcs.fktZcsEingeben = readBool(FGNR, 'FGNR_ZCS', 'FktZcsEingeben', false, warn);
  profile.fgnrZcs.fktZcsAusSteuerdatei = readBool(FGNR, 'FGNR_ZCS', 'FktZcsAusSteuerdatei', false, warn);
  profile.fgnrZcs.fktZcsAusFahrzeug = readBool(FGNR, 'FGNR_ZCS', 'FktZcsAusFahrzeug', false, warn);
  profile.fgnrZcs.fktBrAuswahl = readBool(FGNR, 'FGNR_ZCS', 'FktBrAuswahl', false, warn);

  // [ASW]
  profile.asw.lesenModus = readInt(ASW, 'ASW', 'AswLesenModus', 0, { min: 0, max: 2 }, { strict, warn });
  profile.asw.trace = readBool(ASW, 'ASW', 'AswTrace', false, warn);
  profile.asw.leseDatei = readString(ASW, 'AswLeseDatei');

  // [FSWPSW]
  profile.fswPsw.lesenModus = readInt(FSWPSW, 'FSWPSW', 'FswPswLesenModus', 0, { min: 0, max: 2 }, { strict, warn });
  profile.fswPsw.trace = readBool(FSWPSW, 'FSWPSW', 'FswPswTrace', false, warn);
  profile.fswPsw.manipulieren = readBool(FSWPSW, 'FSWPSW', 'FswPswManipulieren', false, warn);
  profile.fswPsw.leseDatei = readString(FSWPSW, 'FswPswLeseDatei');

  // [NETTODATEN]
  profile.nettodaten.lesenModus = readInt(NETTO, 'NETTODATEN', 'NettoDatenLesenModus', 0, { min: 0, max: 3 }, { strict, warn });
  profile.nettodaten.trace = readBool(NETTO, 'NETTODATEN', 'NettoDatenTrace', false, warn);
  profile.nettodaten.leseDatei = readString(NETTO, 'NettoDatenLeseDatei');

  // [SGET]
  profile.sget.sgetLesen = readBool(SGET, 'SGET', 'SgetLesen', false, warn);
  profile.sget.fktSgAuswahl = readBool(SGET, 'SGET', 'FktSgAuswahl', false, warn);
  profile.sget.fktSgetEingeben = readBool(SGET, 'SGET', 'FktSgetEingeben', false, warn);

  // [CODING]
  profile.coding.zcsutLesen = readBool(CODING, 'CODING', 'ZcsutLesen', false, warn);
  profile.coding.zcsSchreibenModus = readInt(CODING, 'CODING', 'ZcsSchreibenModus', 1, { min: 1, max: 3 }, { strict, warn });
  profile.coding.zcsVorCodierungLoeschen = readBool(CODING, 'CODING', 'ZcsVorCodierungLoeschen', false, warn);
  profile.coding.zcsNurAktuellesSg = readBool(CODING, 'CODING', 'ZcsNurAktuellesSg', false, warn);
  profile.coding.fktSgCodieren = readBool(CODING, 'CODING', 'FktSgCodieren', false, warn);
  profile.coding.fktFzgCodieren = readBool(CODING, 'CODING', 'FktFzgCodieren', false, warn);
  profile.coding.fktCodierJobAendern = readBool(CODING, 'CODING', 'FktCodierJobAendern', false, warn);
  profile.coding.fktSgAuslesen = readBool(CODING, 'CODING', 'FktSgAuslesen', false, warn);
  profile.coding.konvertierenFswPsw = readBool(CODING, 'CODING', 'KonvertierenFswPsw', false, warn);
  profile.coding.fktKernfunktionen = readBool(CODING, 'CODING', 'FktKernfunktionen', false, warn);
  profile.coding.spezialJobName = readString(CODING, 'SpezialJobName');
  profile.coding.sgCodFktText = readString(CODING, 'SgCodFktText');
  profile.coding.fzgCodFktText = readString(CODING, 'FzgCodFktText');
  profile.coding.ciFromSg = readBool(CODING, 'CODING', 'CiFromSg', false, warn);

  // [INDIVID]
  profile.individ.checkIndividTrace = readBool(INDIVID, 'INDIVID', 'CheckIndividTrace', false, warn);
  profile.individ.fktIndivid = readBool(INDIVID, 'INDIVID', 'FktIndivid', false, warn);
  profile.individ.fktKernfunktionen = readBool(INDIVID, 'INDIVID', 'FktKernfunktionen', false, warn);

  // [VERIFIKATION]
  profile.verifikation.codierungEin = readBool(VERIF, 'VERIFIKATION', 'CodierungEin', false, warn);
  profile.verifikation.vfpEin = readBool(VERIF, 'VERIFIKATION', 'VfpEin', false, warn);
  profile.verifikation.zutEin = readBool(VERIF, 'VERIFIKATION', 'ZutEin', false, warn);
  profile.verifikation.steuerFileName = readString(VERIF, 'SteuerFileName');

  // [APPLIKATION]
  profile.applikation.appKennung = readString(APPL, 'AppKennung', 'SERIE');

  return profile;
}
