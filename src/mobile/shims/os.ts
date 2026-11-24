import {nativeInfo} from '../native';
export const EOL = '\n';
export function tmpdir() { return nativeInfo().cache; }
export function homedir() { return nativeInfo().files; }
export function platform() { return 'android'; }
export function arch() { return (globalThis as unknown as {process: {arch: string}}).process.arch; }
export function cpus() { return Array.from({length: navigator.hardwareConcurrency || 4}, () => ({model: 'cpu', speed: 0})); }
export function totalmem() { return ((navigator as unknown as {deviceMemory?: number}).deviceMemory ?? 4) * 1024 ** 3; }
export function hostname() { return 'android'; }
export default {EOL, tmpdir, homedir, platform, arch, cpus, totalmem, hostname};
