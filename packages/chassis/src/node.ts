// Node-only entry point. Imports `node:fs/promises` / `node:path`, so don't pull this
// from a browser bundle — use the default entry plus your own ChassisSource adapter
// (see `apps/ncsx-web/src/lib/fs-chassis-source.ts` for a File System Access example).
export { nodeChassisSource } from './source-node.js';
