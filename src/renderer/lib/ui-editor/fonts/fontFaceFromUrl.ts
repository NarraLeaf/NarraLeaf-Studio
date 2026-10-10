/**
 * A project font, loaded in a game window from the URL that window has for it.
 *
 * # Why the bytes are fetched first
 *
 * Handing `FontFace` the URL (`url("nlgame://asset/...")`, `url(app://fs/...)`) is the one way of
 * loading a font that nothing else in Studio uses. The editor, the font preview and the version
 * history all read the bytes themselves and register the face from those, and those are the paths
 * that draw the author's font. A shipped game and Dev Mode were the only two that gave the browser's
 * font loader a custom-scheme URL - and they are exactly the two in which a project font fell back
 * to the system face, for every file tried, with nothing said anywhere.
 *
 * A font request is not an ordinary one. The loader asks in CORS mode, the asset scheme answers from
 * another host than the document's (`nlgame://asset` under `nlgame://runtime`; `app://fs` under a
 * `file://` Dev Mode shell), and a face that does not load leaves no trace a game can see: the
 * promise rejects with a bare `NetworkError` and the text quietly takes the next family in its list.
 * `fetch` is the route the game already reads assets through - a model's manifest, the warm-up's
 * probe - so the font now arrives the same way and is registered from its bytes, which is what the
 * editor does with the same file.
 *
 * It also splits the one failure into two that say different things: the bytes could not be had
 * (the URL, the grant, the transport), or they were had and the browser would not take them as a
 * font (the file itself). {@link FontFaceLoadError.stage} is which, for whoever reports it.
 *
 * Comments in English per project convention.
 */

export type FontFaceLoadStage = "read" | "decode";

/** A face that could not be registered, and which half of the work refused it. */
export class FontFaceLoadError extends Error {
    constructor(
        readonly stage: FontFaceLoadStage,
        message: string,
    ) {
        super(message);
        this.name = "FontFaceLoadError";
    }
}

/** The pieces this needs from the page, so a test can stand in for the browser. */
export type FontFaceEnvironment = {
    fetch: (url: string) => Promise<Pick<Response, "ok" | "status" | "arrayBuffer">>;
    createFontFace: (family: string, source: ArrayBuffer) => Pick<FontFace, "load">;
};

function pageEnvironment(): FontFaceEnvironment {
    return {
        fetch: url => fetch(url),
        createFontFace: (family, source) => new FontFace(family, source),
    };
}

function reasonOf(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return String(error);
}

/**
 * Fetch a font's bytes from `url` and build a loaded `FontFace` from them under `family`.
 *
 * The face is returned loaded but **not** added to the document: the callers keep their own record
 * of what is registered, and adding is the step that record is written beside.
 */
export async function loadFontFaceFromUrl(
    family: string,
    url: string,
    environment: FontFaceEnvironment = pageEnvironment(),
): Promise<FontFace> {
    let bytes: ArrayBuffer;
    try {
        const response = await environment.fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        bytes = await response.arrayBuffer();
    } catch (error) {
        throw new FontFaceLoadError("read", `could not be read (${reasonOf(error)})`);
    }
    if (bytes.byteLength === 0) {
        throw new FontFaceLoadError("read", "could not be read (the file is empty)");
    }
    try {
        return (await environment.createFontFace(family, bytes).load()) as FontFace;
    } catch (error) {
        throw new FontFaceLoadError("decode", `is not a font this browser can draw (${reasonOf(error)})`);
    }
}
