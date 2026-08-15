// Loaded only from the dynamic `import()` in `NarralangScriptView`, never at module scope of
// anything a test can reach: `studioMonaco` reads `window` while its own body runs, so a static
// import chain into this file fails a node-environment suite at collection.
import {
    monaco,
    STUDIO_MONACO_THEME,
    WORKER_FREE_EDITOR_OPTIONS,
    defineStudioMonacoTheme,
    watchStudioMonacoTheme,
} from "../../assets/editors/text/studioMonaco";
import { NARRALANG_DEFAULT_DIALECT, type NarralangDialect } from "@/lib/story/narralang/narralangDialect";
import { tokenizeNarralangLine } from "@/lib/story/narralang/narralangHighlight";

export { monaco, STUDIO_MONACO_THEME, WORKER_FREE_EDITOR_OPTIONS, defineStudioMonacoTheme, watchStudioMonacoTheme };

export const NARRALANG_LANGUAGE_ID = "narralang";

/**
 * The tokenizer's state, which is nothing.
 *
 * A NarraLang line means what it says on its own - the printer produces one row per line and nothing
 * carries over - so there is a single shared instance rather than one per line. That is also the
 * safety property: Monaco threads the end state of one line into the start of the next, and a state
 * that failed to unwind at a line ending would tint everything below it.
 */
const NO_STATE: monaco.languages.IState = {
    clone: () => NO_STATE,
    equals: () => true,
};

let languageRegistered = false;
let installedDialect: NarralangDialect | null = null;
let installedTokens: monaco.IDisposable | null = null;

/**
 * Teach Monaco to colour NarraLang, and hand back the language id to open a model with.
 *
 * The grammar is not a grammar: it is {@link tokenizeNarralangLine} run over the dialect the script
 * was printed with, so the colours cannot disagree with the words. Keyed on the dialect *value* and
 * not merely on the id - a project that swaps the table has to repaint, and marking the language
 * installed forever would pin every window to whichever table happened to open the first script.
 *
 * Monaco's language list is global and additive, so the registration guard has to live here rather
 * than at the call site, which is a React effect that runs per tab.
 */
export function installNarralangLanguage(dialect: NarralangDialect = NARRALANG_DEFAULT_DIALECT): string {
    if (!languageRegistered) {
        monaco.languages.register({
            id: NARRALANG_LANGUAGE_ID,
            extensions: [".nl"],
            aliases: ["NarraLang", "narralang"],
        });
        languageRegistered = true;
    }
    if (installedDialect === dialect) {
        return NARRALANG_LANGUAGE_ID;
    }
    installedTokens?.dispose();
    // A plain tokens provider, deliberately: it runs on the main thread, which is the whole bargain
    // this window's Monaco is built around (see `WORKER_FREE_EDITOR_OPTIONS`).
    installedTokens = monaco.languages.setTokensProvider(NARRALANG_LANGUAGE_ID, {
        getInitialState: () => NO_STATE,
        tokenize: (line) => ({
            tokens: tokenizeNarralangLine(line, dialect).map(token => ({
                startIndex: token.start,
                scopes: token.scope,
            })),
            endState: NO_STATE,
        }),
    });
    installedDialect = dialect;
    return NARRALANG_LANGUAGE_ID;
}
