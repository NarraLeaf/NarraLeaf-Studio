import { useCallback, useEffect, useMemo, useState } from "react";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { setActiveProjectFonts } from "@shared/typography/projectFonts";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import { getInterface } from "@/lib/app/bridge";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WindowAppType } from "@shared/types/window";
import type { DevModeBundle, DevModeEntry } from "@shared/types/devMode";
import type { UISurface } from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";

/**
 * A story the main process has asked this window to start, in place of whatever it is playing.
 *
 * The story editor's row play control pressed while this window is already open. It arrives just
 * before the bundle it was compiled against, and `token` is what makes acting on it exactly once
 * decidable by the app that acts.
 */
export type DevModeLaunchRequest = {
    token: number;
    storyId: string;
    sceneId: string;
    startBlockId?: string;
    snapshotId?: string;
    /**
     * The bundle revision this window was showing when the request arrived, or null when it was
     * showing none.
     *
     * The instruction and the bundle it belongs to are two messages, and two messages are two React
     * commits: acting in the first of them would start the story against the documents the author
     * has just edited out of date, and the reload that then carried the new ones would take the run
     * straight back over it. So the request waits here until the app is showing something else.
     */
    afterRevision: number | null;
};

type DevModeState = {
    entry: DevModeEntry | null;
    projectPath: string | null;
    bundle: DevModeBundle | null;
    launchRequest: DevModeLaunchRequest | null;
    sessionError: string | null;
};

type UseDevModePayloadResult = {
    bundle: DevModeBundle | null;
    entry: DevModeEntry | null;
    launchRequest: DevModeLaunchRequest | null;
    projectPath: string | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
    sessionError: string | null;
    clearSessionError: () => void;
};

export function useDevModePayload(): UseDevModePayloadResult {
    const [state, setState] = useState<DevModeState>({
        entry: null,
        projectPath: null,
        bundle: null,
        launchRequest: null,
        sessionError: null,
    });
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
                    projectPath: result.data.projectPath,
                }));
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        const payloadToken = getInterface().devMode.onPayloadUpdate(({ bundle }) => {
            /**
             * Dev Mode is the third host of the active brand palette, and it has to publish one.
             *
             * The other two are obvious about it - the editor pushes from `BrandService`, the shipped
             * game from its pack - but this window is its own renderer entry with no workspace
             * services in it, so nothing here had been publishing at all and every `nlbrand:` link
             * in the bundle resolved against the built-in seeds. A project colour the author added
             * simply had no entry, so it painted nothing: a character accent, a widget fill and a
             * surface background would each be right in the editor beside it and wrong here.
             *
             * Published before `setState`, for the reason `GameRuntimeApp` gives at its own call:
             * surfaces resolve their colours while they render, so an effect would paint the first
             * frame against the seeds and jump one commit later.
             */
            setActiveBrandPalette(bundle.brand ?? BUILTIN_BRAND_COLORS);
            // Same channel, same timing, same reason: a text widget resolves its font family
            // while it renders, so an effect would set the first frame in the host's own
            // typeface and swap to the project's one commit later.
            setActiveProjectFonts(bundle.fonts ?? []);
            // Same timing, same reason: a save node resolves its pins as it runs, so publishing in
            // an effect would let the first graph of a session see a schema with no fields in it.
            setActiveSaveSchemaFields(bundle.ui.saveSchema ?? []);
            setState(prev => ({
                ...prev,
                bundle,
                sessionError: null,
            }));
        });
        const reloadToken = getInterface().devMode.onControlReload(() => {
            void tryRollbackStoryState();
        });
        /**
         * Held rather than acted on, and held beside the bundle it belongs to.
         *
         * The main process sends this immediately before the recompiled payload, so both land in one
         * React commit and the app downstream sees the instruction and the documents together. Acting
         * here would start the story against the bundle this window is still holding, which is the
         * one edit the author just made out of date.
         */
        const startToken = getInterface().devMode.onControlStartStory(request => {
            setState(prev => ({ ...prev, launchRequest: { ...request, afterRevision: prev.bundle?.revision ?? null } }));
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
            startToken.cancel();
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
        launchRequest: state.launchRequest,
        projectPath: state.projectPath,
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
