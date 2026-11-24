export function promisify<T>(fn: (...args: any[]) => void) {
  return (...args: unknown[]) => new Promise<T>((resolve, reject) => fn(...args, (error: unknown, value: T) => error ? reject(error) : resolve(value)));
}
export const TextEncoder_ = TextEncoder, TextDecoder_ = TextDecoder;
export function inspect(value: unknown) { try { return JSON.stringify(value); } catch { return String(value); } }
export default {promisify, inspect};
