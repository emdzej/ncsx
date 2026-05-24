export { loadChassis } from './loader.js';
export { loadBrRef, resolveChassisCode } from './br-ref.js';
export { CabdLoader, CabdNotFoundError, type CabdModule } from './cabd-loader.js';
export { indexSgfam, indexZst, indexAt, findSgsByFlag, type ZstIndex } from './indexes.js';
export { indexSwt, loadSwtFile, type SwtTable } from './swt.js';
export { inMemoryChassisSource } from './source-memory.js';
export type { ChassisSource } from './source.js';
export type { Chassis, ChassisWarning, LoadChassisOptions } from './types.js';

// Logger-category catalogue — consumed by host apps to build Settings
// UI without hardcoding category names. Pairs with bimmerz-logger's
// `LogCategory` type from 0.1.2+.
export { LOG_CATEGORIES } from './log-categories.js';
