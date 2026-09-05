import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { loadRuntimeFontFace, registeredRuntimeFontCssFamily } from "../runtimeFontFaces";
import {
    getActiveProjectFontIds,
    resolveFontStackIds,
    subscribeActiveProjectFonts,
} from "@shared/typography/projectFonts";

export type EditorFontFamilyState = {
    cssFamily: string | null;
    loading: boolean;
    error: string | null;
};

const BUILTIN_FONT_ID_PREFIX = "builtin:font:";
const BUILTIN_FONT_CSS: Record<string, string> = {
    [`${BUILTIN_FONT_ID_PREFIX}system-ui`]:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    [`${BUILTIN_FONT_ID_PREFIX}sans-serif`]: "sans-serif",
    [`${BUILTIN_FONT_ID_PREFIX}serif`]: "serif",
    [`${BUILTIN_FONT_ID_PREFIX}monospace`]: "monospace",
    [`${BUILTIN_FONT_ID_PREFIX}arial`]: "Arial, Helvetica, sans-serif",
    [`${BUILTIN_FONT_ID_PREFIX}times`]: '"Times New Roman", Times, serif',
    [`${BUILTIN_FONT_ID_PREFIX}georgia`]: "Georgia, 'Times New Roman', serif",
    [`${BUILTIN_FONT_ID_PREFIX}courier`]: '"Courier New", Courier, monospace',
    [`${BUILTIN_FONT_ID_PREFIX}verdana`]: "Verdana, Geneva, sans-serif",
    [`${BUILTIN_FONT_ID_PREFIX}trebuchet`]: '"Trebuchet MS", sans-serif',
    [`${BUILTIN_FONT_ID_PREFIX}consolas`]: 'Consolas, "Courier New", monospace',
};

/** Signature parity with the editor hook this shim replaces; see that file. */
export type EditorFontFamilyOptions = {
    followProjectDefault?: boolean;
};

/** One resolved rung of the stack: the family to write, or why there is not one. */
type ResolvedFont = { assetId: string; cssFamily: string | null; error: string | null };

/** What a widget with no font to write reads. One object, so a re-publish of it changes nothing. */
const NO_FONT_STATE: EditorFontFamilyState = { cssFamily: null, loading: false, error: null };

/** The whole stack as one `font-family`, with `error` speaking for the chosen font alone. */
function toFontState(resolved: ResolvedFont[], primaryId: string): EditorFontFamilyState {
    const families = resolved
        .map(entry => entry.cssFamily)
        .filter((css): css is string => Boolean(css));
    const primary = resolved.find(entry => entry.assetId === primaryId);
    return {
        cssFamily: families.length > 0 ? families.join(", ") : null,
        loading: false,
        error: primary?.error ?? null,
    };
}

function sameFontState(a: EditorFontFamilyState, b: EditorFontFamilyState): boolean {
    return a.cssFamily === b.cssFamily && a.loading === b.loading && a.error === b.error;
}

/** The stack as it can be answered with no load at all, or null when some rung needs its bytes. */
function resolveStackWithoutLoading(
    ids: readonly string[],
    assetId: string | null,
): EditorFontFamilyState | null {
    if (ids.length === 0) {
        return NO_FONT_STATE;
    }
    const settled = ids.map(resolveWithoutLoading);
    if (!settled.every((entry): entry is ResolvedFont => entry !== null)) {
        return null;
    }
    return toFontState(settled, typeof assetId === "string" ? assetId.trim() : "");
}

/**
 * The shipped game's half of the editor hook of the same name - see that file for what the returned
 * list is and why every rung of it is loaded rather than only the first.
 *
 * Same contract, different route to the bytes: the pack's own asset URLs, and a family name derived
 * from the asset id. The project's default font stack is published from the pack by `GameRuntimeApp`
 * exactly as the brand palette is, so a game and the editor beside it resolve the same fonts.
 */
export function useEditorFontFamily(
    assetId: string | null,
    options?: EditorFontFamilyOptions,
): EditorFontFamilyState {
    const followProjectDefault = options?.followProjectDefault !== false;
    const projectFontIds = useSyncExternalStore(
        subscribeActiveProjectFonts,
        getActiveProjectFontIds,
        getActiveProjectFontIds,
    );
    // `projectFontIds` is a dependency rather than dead weight: `resolveFontStackIds` reads the
    // published stack, whose identity changes exactly when it is republished.
    const stackIds = useMemo(
        () => (followProjectDefault ? resolveFontStackIds(assetId) : oneFontOnly(assetId)),
        [assetId, projectFontIds, followProjectDefault],
    );
    // Keyed on, not read from - see the editor hook of the same name.
    const stackKey = stackIds.join("|");

    /**
     * Resolved before the first paint, not after it.
     *
     * Effects run after the browser has painted, so a hook that started at `cssFamily: null` set the
     * widget in a fallback face for one frame even when the font was already on the document - which
     * after the boot preload is every font the project declares. The initialiser runs once, on mount,
     * and the effect below still answers every later change.
     */
    const [state, setState] = useState<EditorFontFamilyState>(
        () => resolveStackWithoutLoading(stackIds, assetId) ?? NO_FONT_STATE,
    );

    useEffect(() => {
        const ids = stackIds;
        const primaryId = typeof assetId === "string" ? assetId.trim() : "";

        if (ids.length === 0) {
            setState(prev => (sameFontState(prev, NO_FONT_STATE) ? prev : NO_FONT_STATE));
            return;
        }

        // Nothing published when the answer has not moved: `publish` builds a fresh object every
        // time, and handing React a new one is a re-render of the widget for an identical family.
        const publish = (resolved: ResolvedFont[]): void => {
            const next = toFontState(resolved, primaryId);
            setState(prev => (sameFontState(prev, next) ? prev : next));
        };

        const settled = ids.map(resolveWithoutLoading);
        if (settled.every((entry): entry is ResolvedFont => entry !== null)) {
            publish(settled);
            return;
        }

        let cancelled = false;
        setState(prev => ({ ...prev, loading: true, error: null }));

        void Promise.all(ids.map(async (id, index): Promise<ResolvedFont> => {
            const already = settled[index];
            if (already) {
                return already;
            }
            const url = resolveGameRuntimeAssetUrl(id);
            if (!url) {
                return { assetId: id, cssFamily: null, error: `Runtime font not found: ${id}` };
            }
            try {
                // Shared with the boot preload rather than loaded here: this used to build a second
                // `FontFace` for a face the preload had already put on the document, and a third and
                // a fourth for every widget that mounted in the same commit. See `runtimeFontFaces`.
                const cssFamily = await loadRuntimeFontFace(id, url);
                return { assetId: id, cssFamily, error: null };
            } catch (err) {
                return {
                    assetId: id,
                    cssFamily: null,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        })).then(resolved => {
            if (!cancelled) {
                publish(resolved);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [stackKey, assetId]);

    return state;
}

/** The chosen font alone, for a caller that has opted out of the project stack. */
function oneFontOnly(assetId: string | null): string[] {
    const id = typeof assetId === "string" ? assetId.trim() : "";
    return id ? [id] : [];
}

/**
 * A built-in stack, or a face already registered this session. Null when the bytes are still needed.
 *
 * The second arm is what makes the boot preload worth doing: by the time the first surface renders,
 * every font in the project's stack is already on the document, so the first paint writes the real
 * family instead of falling back and swapping a frame later.
 */
function resolveWithoutLoading(assetId: string): ResolvedFont | null {
    const builtin = BUILTIN_FONT_CSS[assetId];
    if (builtin) {
        return { assetId, cssFamily: builtin, error: null };
    }
    const registered = registeredRuntimeFontCssFamily(assetId);
    return registered ? { assetId, cssFamily: registered, error: null } : null;
}
