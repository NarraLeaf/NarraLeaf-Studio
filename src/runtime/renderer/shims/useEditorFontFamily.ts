import { useEffect, useState } from "react";
import { resolveGameRuntimeAssetUrl } from "@/lib/ui-editor/runtime/gameRuntimeBridge";

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

function cssFamilyForAssetId(assetId: string): string {
    return `nlRuntimeFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

export function useEditorFontFamily(assetId: string | null): EditorFontFamilyState {
    const [state, setState] = useState<EditorFontFamilyState>({
        cssFamily: null,
        loading: false,
        error: null,
    });

    useEffect(() => {
        if (!assetId) {
            setState({ cssFamily: null, loading: false, error: null });
            return;
        }
        const builtin = BUILTIN_FONT_CSS[assetId];
        if (builtin) {
            setState({ cssFamily: builtin, loading: false, error: null });
            return;
        }
        const cached = fontCache.get(assetId);
        if (cached) {
            setState({ cssFamily: cached.cssFamily, loading: false, error: null });
            return;
        }
        const url = resolveGameRuntimeAssetUrl(assetId);
        if (!url) {
            setState({ cssFamily: null, loading: false, error: `Runtime font not found: ${assetId}` });
            return;
        }

        let cancelled = false;
        setState(prev => ({ ...prev, loading: true, error: null }));
        const cssFamily = cssFamilyForAssetId(assetId);
        const fontFace = new FontFace(cssFamily, `url("${url.replace(/"/g, '\\"')}")`);
        void fontFace.load()
            .then(loaded => {
                if (cancelled) {
                    return;
                }
                document.fonts.add(loaded);
                fontCache.set(assetId, { cssFamily, fontFace: loaded });
                setState({ cssFamily, loading: false, error: null });
            })
            .catch(err => {
                if (cancelled) {
                    return;
                }
                setState({
                    cssFamily: null,
                    loading: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [assetId]);

    return state;
}
