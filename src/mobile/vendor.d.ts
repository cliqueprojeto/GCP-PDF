/** The browser build of Tesseract (same API as the package entry), used by the Android adapter. */
declare module 'tesseract.js/dist/tesseract.esm.min.js' {
  const Tesseract: typeof import('tesseract.js');
  export default Tesseract;
}
