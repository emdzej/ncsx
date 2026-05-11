import { parseDatenFile, type DatenFile } from '@emdzej/ncsx-daten';
import {
  parseAt,
  parseAtM00,
  parseAtZus,
  parseSgfam,
  parseZst,
  type AtFile,
} from '@emdzej/ncsx-text-tables';
import { loadBrRef, resolveChassisCode } from './br-ref.js';
import { CabdLoader } from './cabd-loader.js';
import { indexAt, indexSgfam, indexZst } from './indexes.js';
import type { ChassisSource } from './source.js';
import type { Chassis, ChassisWarning, LoadChassisOptions } from './types.js';

const decodeLatin1 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
};

interface ChassisLayout {
  dir: string;
  dst: string;
  sget: string;
  sgvt: string;
  zcsut: string;
  cvt: string;
  sgfam: string;
  zst: string;
  at: string;
  atM00: string;
  atZus: string;
}

const layoutFor = (chassis: string): ChassisLayout => {
  const lower = chassis.toLowerCase();
  const upper = chassis.toUpperCase();
  return {
    dir: lower,
    dst: `${lower}/${upper}DST.000`,
    sget: `${lower}/${upper}SGET.000`,
    sgvt: `${lower}/${upper}SGVT.000`,
    zcsut: `${lower}/${upper}ZCSUT.000`,
    cvt: `${lower}/${upper}CVT.000`,
    sgfam: `${lower}/${upper}SGFAM.DAT`,
    zst: `${lower}/${upper}ZST.000`,
    at: `${lower}/${upper}AT.000`,
    atM00: `${lower}/${upper}AT.M00`,
    atZus: `${lower}/${upper}AT.ZUS`,
  };
};

async function readOptionalDaten(
  source: ChassisSource,
  path: string,
  onWarning: (w: ChassisWarning) => void,
): Promise<DatenFile | undefined> {
  if (!(await source.exists(path))) {
    onWarning({ kind: 'missing-optional', file: path, message: 'file not found' });
    return undefined;
  }
  try {
    return parseDatenFile(await source.read(path));
  } catch (err) {
    onWarning({
      kind: 'parse-failure',
      file: path,
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

async function readOptionalText<T>(
  source: ChassisSource,
  path: string,
  parser: (text: string) => T,
  onWarning: (w: ChassisWarning) => void,
): Promise<T | undefined> {
  if (!(await source.exists(path))) {
    onWarning({ kind: 'missing-optional', file: path, message: 'file not found' });
    return undefined;
  }
  try {
    return parser(decodeLatin1(await source.read(path)));
  } catch (err) {
    onWarning({
      kind: 'parse-failure',
      file: path,
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * Load a complete chassis bundle from a {@link ChassisSource}.
 *
 * - `BR_REF.DAT` is opened (and aliasing applied) to canonicalise the chassis code.
 * - The five chassis binary tables (DST/SGET/SGVT/ZCSUT/CVT) are read in parallel.
 * - The text companions (SGFAM/ZST/AT/AT.M00/AT.ZUS) are read in parallel.
 * - CABD `.Cxx` files are **not** preloaded; use `chassis.cabd.forSg(sgName, ci?)`.
 *
 * Missing optional files (anything except `DST.000`) emit a warning and leave the matching
 * field `undefined`. Missing `BR_REF.DAT` or `DST.000` throw.
 */
export async function loadChassis(
  source: ChassisSource,
  requestedCode: string,
  options: LoadChassisOptions = {},
): Promise<Chassis> {
  const onWarning = options.onWarning ?? ((): void => {});

  const brRef = await loadBrRef(source);
  const code = resolveChassisCode(brRef, requestedCode);
  const layout = layoutFor(code);

  if (!(await source.exists(layout.dst))) {
    throw new Error(`chassis ${code}: ${layout.dst} not found`);
  }

  const [dstBytes, sget, sgvt, zcsut, cvt] = await Promise.all([
    source.read(layout.dst),
    readOptionalDaten(source, layout.sget, onWarning),
    readOptionalDaten(source, layout.sgvt, onWarning),
    readOptionalDaten(source, layout.zcsut, onWarning),
    readOptionalDaten(source, layout.cvt, onWarning),
  ]);
  const dst = parseDatenFile(dstBytes);

  const [sgfamFile, zstFile, atFile, atM00File, atZusFile] = await Promise.all([
    readOptionalText(source, layout.sgfam, parseSgfam, onWarning),
    readOptionalText(source, layout.zst, parseZst, onWarning),
    readOptionalText(source, layout.at, parseAt, onWarning),
    readOptionalText(source, layout.atM00, parseAtM00, onWarning),
    readOptionalText(source, layout.atZus, parseAtZus, onWarning),
  ]);

  const sgfam = sgfamFile ? indexSgfam(sgfamFile.rows) : new Map();
  const zst = zstFile ? indexZst(zstFile) : undefined;
  const atIndex = atFile ? indexAt(atFile.records) : undefined;
  const atRaw: AtFile | undefined = atFile;
  const atZus: AtFile | undefined = atZusFile;

  const cabd = new CabdLoader(source, layout.dir, sgfam);

  return {
    code,
    requestedCode,
    dir: layout.dir,
    brRef,
    dst,
    sget: sget ?? emptyDaten(),
    sgvt: sgvt ?? emptyDaten(),
    zcsut: zcsut ?? emptyDaten(),
    cvt: cvt ?? emptyDaten(),
    sgfam,
    zst,
    at: atIndex,
    atRaw,
    atM00: atM00File,
    atZus,
    cabd,
  };
}

const emptyDaten = (): DatenFile => ({ signatures: [], blocks: [] });
