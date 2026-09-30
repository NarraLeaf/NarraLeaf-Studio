/**
 * Which content types a renderer executes rather than displays, and what a refused one is served as.
 *
 * The list is the set of types a page turns into running code without any script of its own having
 * to act first: the JavaScript MIME types (a module `import()` or a `<script src>` succeeds only on
 * one of them), WebAssembly (`instantiateStreaming` checks the type), and HTML (a frame or a
 * navigation renders it, scripts included). Images, audio, fonts, JSON and plain text stay as they
 * are - a renderer displays or parses those, and turning them inert would break a distrusted
 * project's asset panel for no gain.
 *
 * SVG is deliberately not here. As an `<img>` it runs nothing, and that is how the interface uses
 * it; as a document it would, but reaching that state takes a frame or a navigation, both of which
 * every Studio window already refuses.
 */
const EXECUTABLE_CONTENT_TYPES = [
    /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/i,
    /^text\/(?:jscript|livescript|javascript1\.\d)$/i,
    /^application\/wasm$/i,
    /^text\/html$/i,
    /^application\/xhtml\+xml$/i,
];

export function isExecutableContentType(contentType: string): boolean {
    const bare = contentType.split(";")[0]!.trim();
    return EXECUTABLE_CONTENT_TYPES.some(pattern => pattern.test(bare));
}

/** What a refused executable file is served as: readable, and nothing a page will run. */
export const INERT_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * Whether the window a grant belongs to may run code the project supplied.
 *
 * Answered per request rather than per grant so that revoking a project's trust in Settings takes
 * effect on the next fetch, not on the next launch. `undefined` is a grant nobody owns, and it
 * answers no: the question has no window to ask about, and code nobody vouched for is not run on
 * that account.
 */
export interface ProjectCodePolicy {
    mayRunProjectCode(ownerWebContentsId: number | undefined): boolean;
}
