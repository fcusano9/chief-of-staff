/** Vite's `?raw` import: the file's text. Used to bundle outlook.ps1. */
declare module '*?raw' {
  const text: string
  export default text
}
