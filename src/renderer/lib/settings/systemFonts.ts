import { sanitizeFontFamilyName } from "./editorFontOptions";

/**
 * The fonts installed on this computer, read through Chromium's Local Font Access API
 * (`window.queryLocalFonts`).
 *
 * There is no Electron main-process equivalent worth the trouble: enumerating installed families
 * off the renderer means one shell-out per platform (`fc-list`, PowerShell, `system_profiler`),
 * each with its own parsing and its own failure modes, to arrive at the list Chromium already has
 * indexed for its own font matching. What that convenience costs is two conditions the caller has to
 * respect — see {@link loadSystemFontFamilies}.
 */

export interface SystemFontFamily {
    /** The CSS family name, exactly as Chromium reports it — this is what gets stored. */
    family: string;
    /**
     * Other names the same family answers to: the localized full names its faces carry, plus their
     * PostScript names. Search matches against these too, because a Chinese user looks for 苹方,
     * not for "PingFang SC" — the family name is Latin for most CJK faces.
     */
    aliases: string[];
}

export type SystemFontsResult =
    | { status: "ok"; families: SystemFontFamily[] }
    /** No Local Font Access API in this runtime (an older Chromium, or a non-desktop build). */
    | { status: "unsupported" }
    /** The API is there and refused: permission denied, or the window was not visible. */
    | { status: "denied" }
    | { status: "failed"; message: string };

/** Minimal shape of a `FontData` entry; the DOM lib does not ship this API's types yet. */
interface LocalFontData {
    family: string;
    fullName: string;
    postscriptName: string;
    style: string;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

/**
 * Cached only on success. A refusal is usually about the moment (the window was behind another
 * one, the user activation had expired) rather than about the machine, so it stays retryable.
 */
let cached: SystemFontFamily[] | null = null;

function collator(): Intl.Collator {
    return new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
}

/** Group faces into families, keeping every distinct name a family can be searched by. */
export function groupFontFaces(faces: readonly LocalFontData[]): SystemFontFamily[] {
    const byFamily = new Map<string, Set<string>>();
    for (const face of faces) {
        const family = sanitizeFontFamilyName(face?.family);
        if (!family) {
            continue;
        }
        let aliases = byFamily.get(family);
        if (!aliases) {
            aliases = new Set<string>();
            byFamily.set(family, aliases);
        }
        for (const alias of [face.fullName, face.postscriptName]) {
            // Only names that add something: a full name of "Georgia Bold" for family "Georgia" is
            // already found by typing "georgia", and listing it would just grow every row's payload.
            if (typeof alias === "string" && alias && !alias.toLowerCase().includes(family.toLowerCase())) {
                aliases.add(alias);
            }
        }
    }
    const compare = collator();
    return [...byFamily.entries()]
        .map(([family, aliases]) => ({ family, aliases: [...aliases].sort(compare.compare) }))
        .sort((a, b) => compare.compare(a.family, b.family));
}

/**
 * Read the installed font families.
 *
 * **Call this from inside the click that opens the picker.** `queryLocalFonts()` needs transient
 * user activation and a visible window, and both are properties of the moment, not of the app:
 * awaiting anything first can outlive the activation, and a call made while the Settings window sits
 * behind another one is refused outright. The picker therefore fires this from its trigger's own
 * handler and renders whatever comes back.
 *
 * Never throws — every failure is a result the caller can render, because a machine that will not
 * list its fonts still has to leave the presets pickable.
 */
export async function loadSystemFontFamilies(): Promise<SystemFontsResult> {
    if (cached) {
        return { status: "ok", families: cached };
    }
    const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
    if (typeof query !== "function") {
        return { status: "unsupported" };
    }
    try {
        const faces = await query.call(window);
        const families = groupFontFaces(faces ?? []);
        cached = families;
        return { status: "ok", families };
    } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "SecurityError" || name === "NotAllowedError") {
            return { status: "denied" };
        }
        return { status: "failed", message: error instanceof Error ? error.message : String(error) };
    }
}

/** Whether the API exists at all — lets the picker offer the presets without pretending to more. */
export function isSystemFontAccessSupported(): boolean {
    return typeof (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts === "function";
}

/** Test seam: drops the cached list so the next load re-queries. */
export function clearSystemFontCache(): void {
    cached = null;
}
