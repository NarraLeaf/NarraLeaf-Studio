/**
 * The one place a shipped game registers a project font, and the one place it names one.
 *
 * # Why this is a module and not two functions in two files
 *
 * There were two. The boot preload registered every font in the project's stack under a family name
 * it derived from the asset id, and the hook that sets a widget's `font-family` derived the same
 * name with a byte-identical function of its own and kept its own record of what it had loaded.
 * Neither could see the other's, so the preload's work was invisible to its only consumer: every
 * text widget loaded the typeface a second time, and - because that record was written only after
 * `load()` resolved - every text widget that mounted in the same commit loaded it again in parallel.
 * Measured on a shipped build with a 9.7 MB font: three `FontFace` objects on the title screen, and
 * eight after one page change. Each one holds its own copy of the bytes.
 *
 * So the family name and the record of what has been registered live together, and the load is
 * shared: a second caller for a font already in flight gets the first caller's promise.
 *
 * Comments in English per project convention.
 */

/** Asset ids whose face is registered on the document, and the family it went in under. */
const registered = new Map<string, string>();

/** Loads that have started and not settled, so concurrent callers share one fetch. */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * The CSS family a font asset is registered under.
 *
 * Derived from the id rather than read out of the file, because the shipped game has no font parser
 * and two fonts may well declare the same internal family name. This is also why an asset **set** is
 * refused in a font slot (see `@shared/build/uiAssetSlots`): one id has to mean one face.
 */
export function runtimeFontCssFamily(assetId: string): string {
    return `nlRuntimeFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

/**
 * The family this font is already registered under, or null when it has not been loaded yet.
 *
 * The question a render asks: it has to write a `font-family` synchronously, and a face the boot
 * preload has already put on the document is one it can name in that first paint rather than after
 * a load of its own resolves.
 */
export function registeredRuntimeFontCssFamily(assetId: string): string | null {
    return registered.get(assetId) ?? null;
}

/**
 * Register a font asset's face, once per asset id for the life of the page.
 *
 * Resolves with the family to write, or **null** where the environment has no `FontFace` to register
 * with - there the bytes are still fetched (which is all a warm-up can do) but nothing can be named.
 * Rejects when the bytes cannot be had, which is what makes a font count as failed in the boot
 * preload's report.
 */
export function loadRuntimeFontFace(assetId: string, url: string): Promise<string | null> {
    const already = registered.get(assetId);
    if (already) {
        return Promise.resolve(already);
    }
    const pending = inFlight.get(assetId);
    if (pending) {
        return pending;
    }
    const load = registerFace(assetId, url).finally(() => {
        inFlight.delete(assetId);
    });
    inFlight.set(assetId, load);
    return load;
}

async function registerFace(assetId: string, url: string): Promise<string | null> {
    if (typeof FontFace === "undefined" || typeof document === "undefined") {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return null;
    }
    const cssFamily = runtimeFontCssFamily(assetId);
    const face = await new FontFace(cssFamily, `url("${url.replace(/"/g, "\\\"")}")`).load();
    document.fonts.add(face);
    registered.set(assetId, cssFamily);
    return cssFamily;
}

/** Forget everything registered. For tests, which share one module instance across cases. */
export function resetRuntimeFontFacesForTest(): void {
    registered.clear();
    inFlight.clear();
}
