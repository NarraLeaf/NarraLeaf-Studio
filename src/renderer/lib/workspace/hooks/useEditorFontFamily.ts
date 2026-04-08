import { useEffect, useRef, useState } from "react";
import {
    getBuiltinEditorFontCssFamily,
    isBuiltinEditorFontAssetId,
} from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIEditorFontFaceService } from "@/lib/workspace/services/ui-editor/UIEditorFontFaceService";

export type EditorFontFamilyState = {
    cssFamily: string | null;
    loading: boolean;
    error: string | null;
};

/**
 * Loads a project font asset into document.fonts for editor preview; ref-counted via UIEditorFontFaceService.
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
            setState({
                cssFamily: null,
                loading: false,
                error: "Workspace not ready",
            });
            return;
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
