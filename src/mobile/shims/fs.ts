import * as promises from './fs-promises';
import {constants, statSync} from './fs-promises';
export {constants, promises, statSync};
export function existsSync(path: string): boolean { try { statSync(path); return true; } catch { return false; } }
export function accessSync(path: string) { statSync(path); }
export default {existsSync, accessSync, statSync, constants, promises};
