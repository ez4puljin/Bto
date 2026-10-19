/** A file's text through Vite's `?raw` (worker.test.ts reads the installed MapLibre worker). */
declare module '*?raw' {
  const text: string;
  export default text;
}
