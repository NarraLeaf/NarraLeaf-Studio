import { useCallback, useEffect, useMemo, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WindowAppType } from "@shared/types/window";
import type { DevModeBundle, DevModeEntry } from "@shared/types/devMode";
import type { UISurface } from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";

type DevModeState = {
    entry: DevModeEntry | null;
    bundle: DevModeBundle | null;
    sessionError: string | null;
};

type UseDevModePayloadResult = {
    bundle: DevModeBundle | null;
    entry: DevModeEntry | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
    sessionError: string | null;
    clearSessionError: () => void;
};

export function useDevModePayload(): UseDevModePayloadResult {
    const [state, setState] = useState<DevModeState>({ entry: null, bundle: null, sessionError: null });
    const rendererRegistry = useMemo(() => new ElementRendererRegistry(BuiltinElementRenderers), []);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        let active = true;
        getInterface()
            .getWindowProps<WindowAppType.DevMode>()
            .then(result => {
                if (!active || !result.success) {
                    return;
                }
                setState(prev => ({
                    ...prev,
                    entry: result.data.entry,
                }));
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const payloadToken = getInterface().devMode.onPayloadUpdate(({ bundle }) => {
            setState(prev => ({
                ...prev,
                bundle,
                sessionError: null,
            }));
        });
        const reloadToken = getInterface().devMode.onControlReload(() => {
            void tryRollbackStoryState();
        });
        const errorToken = getInterface().devMode.onControlError(({ message }) => {
            setState(prev => ({
                ...prev,
                sessionError: message,
            }));
        });
        return () => {
            payloadToken.cancel();
            reloadToken.cancel();
            errorToken.cancel();
        };
    }, []);

    const clearSessionError = useCallback(() => {
        setState(prev => ({ ...prev, sessionError: null }));
    }, []);

    const surfaceId = useMemo(() => {
        if (state.entry?.kind === "surface") {
            return state.entry.surfaceId;
        }
        return MAIN_APP_SURFACE_ID;
    }, [state.entry]);

    const surface = useMemo(() => {
        if (!state.bundle) {
            return null;
        }
        return state.bundle.ui.uidoc.surfaces.find(surf => surf.id === surfaceId) ?? null;
    }, [state.bundle, surfaceId]);

    const handleAspectUpdate = useCallback((metrics: { scale: number }) => {
        setScale(prev => (prev === metrics.scale ? prev : metrics.scale));
    }, []);

    return {
        bundle: state.bundle,
        entry: state.entry,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError: state.sessionError,
        clearSessionError,
    };
}

async function tryRollbackStoryState(): Promise<void> {
    return;
}
