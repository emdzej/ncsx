export { CabiProvider, CdhNotImplementedError } from './provider.js';
export type { CdhContext, CdhResult } from './types.js';
export * from './error-codes.js';
export {
  NCSEXPER_SYSCALL_TABLE,
  getNcsexperSyscall,
  getDivergentSlots,
  type NcsexperSyscallEntry,
  type SyscallVerification,
} from './ncsexper-syscalls.js';
