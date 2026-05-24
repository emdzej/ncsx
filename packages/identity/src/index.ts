export { readVin, padFgnrToVin, type VinReadResult, type PaddedVin } from './vin.js';
export { readFa, type FaReadResult } from './fa.js';
export { readZcs, type ZcsRead, type ZcsReadResult } from './zcs.js';
export {
  formatFahrgestellNr,
  formatGm,
  formatSa,
  formatVn,
  mod36Checksum,
  stripGmCheck,
  stripSaCheck,
  stripVnCheck,
} from './m36-checksum.js';
export type { IdentityReadResult } from './types.js';
