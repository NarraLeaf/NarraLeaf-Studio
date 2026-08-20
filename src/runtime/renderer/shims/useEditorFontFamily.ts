import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
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

const fontCache = new Map<string, { cssFamily: string; fontFace: FontFace }>();

/** Signature parity with the editor hook this shim replaces; see that file. */
export type EditorFontFamilyOptions = {
    followProjectDefault?: boolean;
};

/** One resolved rung of the stack: the family to write, or why there is not one. */
type ResolvedFont = { assetId: string; cssFamily: string | null; error: string | null };

function cssFamilyForAssetId(assetId: string): string {
    return `nlRuntimeFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
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

    const [state, setState] = useState<EditorFontFamilyState>({
        cssFamily: null,
        loading: false,
        error: null,
    });

    useEffect(() => {
        const ids = stackIds;
        const primaryId = typeof assetId === "string" ? assetId.trim() : "";

        if (ids.length === 0) {
            setState({ cssFamily: null, loading: false, error: null });
            return;
        }

        const publish = (resolved: ResolvedFont[]): void => {
            const families = resolved
                .map(entry => entry.cssFamily)
                .filter((css): css is string => Boolean(css));
            const primary = resolved.find(entry => entry.assetId === primaryId);
            setState({
                cssFamily: families.length > 0 ? families.join(", ") : null,
                loading: false,
                error: primary?.error ?? null,
            });
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
            const cssFamily = cssFamilyForAssetId(id);
            try {
                const loaded = await new FontFace(cssFamily, `url("${url.replace(/"/g, '\\"')}")`).load();
                document.fonts.add(loaded);
                fontCache.set(id, { cssFamily, fontFace: loaded });
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

/** A built-in stack, or a face already registered this session. Null when the bytes are still needed. */
function resolveWithoutLoading(assetId: string): ResolvedFont | null {
    const builtin = BUILTIN_FONT_CSS[assetId];
    if (builtin) {
        return { assetId, cssFamily: builtin, error: null };
    }
    const cached = fontCache.get(assetId);
    return cached ? { assetId, cssFamily: cached.cssFamily, error: null } : null;
}
