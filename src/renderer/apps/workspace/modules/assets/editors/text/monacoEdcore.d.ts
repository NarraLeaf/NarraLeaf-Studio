/**
 * `monaco-editor/esm/vs/editor/edcore.main` is imported for its side effects only - it registers
 * the editor contributions (find, folding, bracket matching, the context menu) that the bare
 * `editor.api` entry leaves out. monaco-editor ships no `.d.ts` for it, and there is nothing to
 * write one for: its exports are the same objects `editor.api` already types, and `studioMonaco.ts`
 * takes the API from there.
 */
declare module "monaco-editor/esm/vs/editor/edcore.main.js";
