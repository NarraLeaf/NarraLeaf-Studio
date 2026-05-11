import { useEffect, useRef, useState } from "react";
import {
    getBuiltinEditorFontCssFamily,
    isBuiltinEditorFontAssetId,
} from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIEditorFontFaceService } from "@/lib/workspace/services/ui-editor/UIEditorFontFaceService";
import { getInterface } from "@/lib/app/bridge";

export type EditorFontFamilyState = {
    cssFamily: string | null;
    loading: boolean;
    error: string | null;
};

function devModeCssFamilyForAssetId(assetId: string): string {
    return `nlDevFont_${assetId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

const devModeFontCache = new Map<string, { cssFamily: string; fontFace: FontFace }>();

/**
 * Loads a project font asset into document.fonts for editor preview; ref-counted via UIEditorFontFaceService.
 * In Dev Mode (no workspace context), falls back to resolving fonts via IPC.
 */
export function useEditorFontFamily(assetId: string | null): EditorFontFamilyState {
    let workspace: ReturnType<typeof useWorkspace> | null = null;
    try {
        workspace = useWorkspace();
    } catch {
        workspace = null;
    }
    const context = workspace?.context ?? null;

    const [state, setState] = useState<EditorFontFamilyState>({
        cssFamily: null,
        loading: false,
        error: null,
    });
    const acquiredRef = useRef(false);

    useEffect(() => {
        acquiredRef.current = false;
        if (!assetId) {
            setState({ cssFamily: null, loading: false, error: null });
            return;
        }

        if (isBuiltinEditorFontAssetId(assetId)) {
            const css = getBuiltinEditorFontCssFamily(assetId);
            if (css) {
                setState({ cssFamily: css, loading: false, error: null });
            } else {
                setState({
                    cssFamily: null,
                    loading: false,
                    error: "Unknown built-in font",
                });
            }
            return;
        }

        if (!context) {
            if (workspace) {
                setState({
                    cssFamily: null,
                    loading: false,
                    error: "Workspace not ready",
                });
                return;
            }

            const cached = devModeFontCache.get(assetId);
            if (cached) {
                setState({ cssFamily: cached.cssFamily, loading: false, error: null });
                return;
            }

            let cancelled = false;
            setState(prev => ({ ...prev, loading: true, error: null }));

            (async () => {
                try {
                    const result = await getInterface().devMode.resolveImageAssetUrl(assetId);
                    if (cancelled) {
                        return;
                    }
                    if (!result.success || !result.data?.url) {
                        setState({ cssFamily: null, loading: false, error: result.error ?? "Font asset not found" });
                        return;
                    }

                    const cssFamily = devModeCssFamilyForAssetId(assetId);
                    const fontFace = new FontFace(cssFamily, `url(${result.data.url})`);
                    await fontFace.load();
                    if (cancelled) {
                        return;
                    }
                    document.fonts.add(fontFace);
                    devModeFontCache.set(assetId, { cssFamily, fontFace });
                    setState({ cssFamily, loading: false, error: null });
                } catch (err) {
                    if (cancelled) {
                        return;
                    }
                    setState({
                        cssFamily: null,
                        loading: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            })();

            return () => {
                cancelled = true;
            };
        }

        const svc = context.services.get<UIEditorFontFaceService>(Services.UIEditorFontFace);
        let cancelled = false;
        setState({ cssFamily: null, loading: true, error: null });

        void svc.acquire(assetId).then(result => {
            if (cancelled) {
                if (result.ok) {
                    svc.release(assetId);
                }
                return;
            }
            if (result.ok) {
                acquiredRef.current = true;
                setState({ cssFamily: result.cssFamily, loading: false, error: null });
            } else {
                setState({
                    cssFamily: null,
                    loading: false,
                    error: result.error,
                });
            }
        });

        return () => {
            cancelled = true;
            if (acquiredRef.current) {
                svc.release(assetId);
                acquiredRef.current = false;
            }
        };
    }, [assetId, context]);

    return state;
}
