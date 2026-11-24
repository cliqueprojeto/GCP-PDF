/** Only PDF.js asks for a package location: its fonts, character maps and decoders ship with the interface. */
export function createRequire(_from: unknown) {
  const require = (id: string) => { throw new Error(`Módulo indisponível no Android: ${id}`); };
  require.resolve = (id: string) => {
    if (id === 'pdfjs-dist/package.json') return '/app/www/pdfjs/package.json';
    throw new Error(`Módulo indisponível no Android: ${id}`);
  };
  return require;
}
export default {createRequire};
