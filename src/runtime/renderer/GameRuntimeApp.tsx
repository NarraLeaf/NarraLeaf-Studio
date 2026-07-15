import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle } from "@shared/types/devMode";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { UISurface } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { GameApp } from "@/lib/ui-editor/runtime/app/GameApp";
import type { GameAppFrameContext, GameAppHost, GameAppSaveStore } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { StageViewportFrame } from "@/lib/ui-editor/runtime/app/StageViewportFrame";
import { loadRuntimePlugins } from "@/lib/ui-editor/runtime/plugins/loadRuntimePlugins";
import {
    preloadRuntimePackAssets,
    type RuntimeSurfacePreloadResult,
} from "./surfaceResourcePreload";

function findSurface(bundle: DevModeBundle, surfaceId: string | undefined): UISurface | null {
    if (surfaceId) {
        const surface = bundle.ui.uidoc.surfaces.find(item => item.id === surfaceId);
        if (surface) {
            return surface;
        }
    }
    return bundle.ui.uidoc.surfaces.find(surface => surface.kind === "appSurface") ?? bundle.ui.uidoc.surfaces[0] ?? null;
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack || error.message;
    }
    return String(error);
}


function useRuntimePack(): {
    pack: GameRuntimePackV1 | null;
    error: string | null;
} {
    const [pack, setPack] = useState<GameRuntimePackV1 | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        const bridge = getGameRuntimeBridge();
        if (!bridge) {
            setError("Runtime bridge is not available");
            return;
        }
        void bridge.readPack()
            .then(nextPack => {
                if (!disposed) {
                    setPack(nextPack);
                    setError(null);
                }
            })
            .catch(err => {
                if (!disposed) {
                    setError(normalizeError(err));
                }
            });
        return () => {
            disposed = true;
        };
    }, []);

    return { pack, error };
}

function RuntimeErrorScreen(props: { message: string }): ReactNode {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 p-8 text-neutral-100">
            <pre className="max-h-full max-w-full overflow-auto whitespace-pre-wrap rounded border border-red-800/70 bg-red-950/50 p-4 text-xs leading-relaxed text-red-100">
                {props.message}
            </pre>
        </div>
    );
}

function RuntimeLoadingScreen(): ReactNode {
    return <div className="h-screen w-screen bg-black" />;
}

function useRuntimePackPreload(input: {
    pack: GameRuntimePackV1 | null;
    firstSurface: UISurface | null;
}): {
    ready: boolean;
    result: RuntimeSurfacePreloadResult | null;
} {
    const { pack, firstSurface } = input;
    const [state, setState] = useState<{
        key: string | null;
        ready: boolean;
        result: RuntimeSurfacePreloadResult | null;
    }>({ key: null, ready: false, result: null });

    useEffect(() => {
        const bridge = getGameRuntimeBridge();
        if (!pack || !firstSurface || !bridge) {
            setState({ key: null, ready: false, result: null });
            return;
        }
        const preloadKey = `${pack.bundle.bundleId}:${pack.bundle.revision}:${firstSurface.id}`;
        let cancelled = false;
        setState({ key: preloadKey, ready: false, result: null });
        void preloadRuntimePackAssets({
            pack,
            firstSurface,
            assetUrl: assetId => bridge.assetUrl(assetId),
        }).then(result => {
            if (cancelled) {
                return;
            }
            if (result.timedOut) {
                bridge.log(
                    "warning",
                    `[Runtime] Asset preload timed out after 10s: first screen ${result.firstSurfaceLoaded}/${result.firstSurfaceAssetIds.length}, total ${result.loaded}/${result.assetIds.length}`,
                );
            } else if (result.failed.length > 0) {
                bridge.log(
                    "warning",
                    `[Runtime] Asset preload finished with ${result.failed.length} failed asset(s): ${result.failed.join(", ")}`,
                );
            } else {
                bridge.log("info", `[Runtime] Asset preload finished: ${result.assetIds.length} asset(s)`);
            }
            setState({ key: preloadKey, ready: true, result });
        }).catch(err => {
            if (cancelled) {
                return;
            }
            bridge.log("warning", `[Runtime] Surface preload failed: ${normalizeError(err)}`);
            setState({
                key: preloadKey,
                ready: true,
                result: {
                    assetIds: [],
                    firstSurfaceAssetIds: [],
                    loaded: 0,
                    firstSurfaceLoaded: 0,
                    failed: [],
                    firstSurfaceFailed: [],
                    firstSurfaceComplete: false,
                    timedOut: false,
                },
            });
        });
        return () => {
            cancelled = true;
        };
    }, [firstSurface, pack]);

    const expectedKey = pack && firstSurface
        ? `${pack.bundle.bundleId}:${pack.bundle.revision}:${firstSurface.id}`
        : null;
    return {
        ready: Boolean(expectedKey && state.key === expectedKey && state.ready),
        result: expectedKey && state.key === expectedKey ? state.result : null,
    };
}

/**
 * Loads the runtime entries of plugins shipped inside the pack before the
 * game boots. A failing plugin never blocks the game; errors go to the
 * runtime log. loadRuntimePlugins is idempotent per plugin id+version+entry.
 */
function useRuntimePlugins(pack: GameRuntimePackV1 | null, rendererRegistry: ElementRendererRegistry): boolean {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (!pack) {
            setReady(false);
            return;
        }
        const plugins = pack.plugins ?? [];
        if (plugins.length === 0) {
            setReady(true);
            return;
        }
        let disposed = false;
        const bridge = getGameRuntimeBridge();
        const log = (level: "info" | "warning" | "error", message: string) => {
            bridge?.log(level, message);
        };
        const descriptors = plugins.map(entry => ({
            plugin: {
                id: entry.manifest.id,
                name: entry.manifest.name,
                version: entry.manifest.version,
                publisher: entry.manifest.publisher,
            },
            manifest: entry.manifest,
            // Without a bridge nothing can load anyway; the desktop scheme is
            // only a placeholder so the descriptor stays well-formed.
            entryUrl: bridge?.pluginEntryUrl(entry.entryRelativePath)
                ?? `nlgame://runtime/${entry.entryRelativePath}`,
        }));
        void loadRuntimePlugins(descriptors, { log, elementRenderers: rendererRegistry }).finally(() => {
            if (!disposed) {
                setReady(true);
            }
        });
        return () => {
            disposed = true;
        };
    }, [pack, rendererRegistry]);

    return ready;
}

export function GameRuntimeApp() {
    const { pack, error } = useRuntimePack();
    const [renderScale, setRenderScale] = useState(1);
    const bridge = getGameRuntimeBridge();
    const rendererRegistry = useMemo(() => new ElementRendererRegistry(BuiltinElementRenderers), []);

    const entrySurfaceId = pack?.entry.surfaceId ?? undefined;
    const entrySurface = pack ? findSurface(pack.bundle, entrySurfaceId) : null;
    const preload = useRuntimePackPreload({ pack, firstSurface: entrySurface });
    const pluginsReady = useRuntimePlugins(pack, rendererRegistry);
    const runtimeReady = preload.ready && pluginsReady;

    const persistenceAdapter = useMemo(() => {
        if (!bridge) {
            return null;
        }
        return {
            getAll: async () => bridge.persistence.getAll(),
            getValue: async (key: string) => bridge.persistence.getValue(key),
            setValue: async (key: string, value: unknown) => bridge.persistence.setValue(key, value),
            removeValue: async (key: string) => bridge.persistence.removeValue(key),
        };
    }, [bridge]);

    const onDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        if (!bridge) {
            return;
        }
        if (event.type === "execution.error") {
            bridge.log("error", event.message);
        } else if (event.type === "devtools.log") {
            const level = event.level === "error" || event.level === "warning" ? event.level : "info";
            bridge.log(level, event.message);
        }
    }, [bridge]);

    const log = useCallback<GameAppHost["log"]>((level, message) => {
        bridge?.log(level, message);
    }, [bridge]);

    const resolveStoryAssetUrl = useCallback(
        (assetId: string) => bridge?.assetUrl(assetId) ?? assetId,
        [bridge],
    );

    const saveStore = useMemo<GameAppSaveStore>(() => ({
        write: async (id, savedGame, capture, metadata) => {
            if (!bridge) {
                throw new Error("Save Game: runtime bridge is not available");
            }
            await bridge.save.write(id, savedGame, capture, metadata);
        },
        read: async id => {
            if (!bridge) {
                throw new Error("Save storage is not available");
            }
            const record = await bridge.save.read(id);
            return record ?? null;
        },
        readPreview: async id => {
            if (!bridge) {
                return null;
            }
            return bridge.save.readPreview(id);
        },
        remove: async id => {
            if (!bridge) {
                throw new Error("Delete Save: runtime bridge is not available");
            }
            await bridge.save.delete(id);
        },
        listIds: async () => {
            if (!bridge) {
                return [];
            }
            return bridge.save.listIds();
        },
    }), [bridge]);

    const quitApplication = useCallback(async (): Promise<void> => {
        await bridge?.close();
    }, [bridge]);

    const getFullscreen = useCallback(async (): Promise<boolean> => {
        return (await bridge?.getFullscreen()) === true;
    }, [bridge]);

    const setFullscreen = useCallback(async (fullscreen: boolean): Promise<void> => {
        await bridge?.setFullscreen(fullscreen);
    }, [bridge]);

    const subscribeFullscreenChanged = useCallback((listener: (isFullscreen: boolean) => void): (() => void) => {
        return bridge?.onFullscreenChanged(listener) ?? (() => undefined);
    }, [bridge]);

    const host = useMemo<GameAppHost | null>(() => {
        if (!pack) {
            return null;
        }
        return {
            id: "Runtime",
            bundle: pack.bundle,
            sessionKey: `${pack.bundle.bundleId}:${pack.bundle.revision}:${entrySurfaceId ?? ""}`,
            entrySurfaceId,
            ready: runtimeReady,
            bootAction: pack.entry.kind === "story"
                ? { kind: "story", storyId: pack.entry.storyId, sceneId: pack.entry.sceneId }
                : { kind: "surface" },
            persistenceAdapter,
            onDebugEvent,
            disposeMessage: "Preview runtime disposed",
            log,
            resolveStoryAssetUrl,
            saveStore,
            quitApplication,
            getFullscreen,
            setFullscreen,
            subscribeFullscreenChanged,
        };
    }, [
        entrySurfaceId,
        getFullscreen,
        log,
        onDebugEvent,
        pack,
        persistenceAdapter,
        quitApplication,
        resolveStoryAssetUrl,
        runtimeReady,
        setFullscreen,
        subscribeFullscreenChanged,
        saveStore,
    ]);

    const getScale = useCallback(() => renderScale, [renderScale]);

    const renderFrame = useCallback(
        (ctx: GameAppFrameContext) => (
            <StageViewportFrame
                designSize={ctx.activeSurface.designSize}
                onRenderScaleChange={setRenderScale}
                outerClassName="bg-black text-white"
                // Viewport units, not 100%: the runtime's #root has no fixed height, so height:100%
                // would collapse to content height and shrink the stage (breaking downsampling).
                outerStyle={{ width: "100vw", height: "100vh" }}
                boxStyle={{ backgroundColor: getSurfaceBackgroundColor(ctx.activeSurface) }}
            >
                {ctx.children}
            </StageViewportFrame>
        ),
        [],
    );

    const renderPlaceholder = useCallback(() => <RuntimeLoadingScreen />, []);

    if (error) {
        return <RuntimeErrorScreen message={error} />;
    }
    if (!pack || !host || !entrySurface) {
        return <RuntimeLoadingScreen />;
    }

    return (
        <GameApp
            host={host}
            rendererRegistry={rendererRegistry}
            getScale={getScale}
            renderFrame={renderFrame}
            renderPlaceholder={renderPlaceholder}
        />
    );
}
