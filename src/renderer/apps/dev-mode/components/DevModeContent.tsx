import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { StageViewportFrame } from "@/lib/ui-editor/runtime/app/StageViewportFrame";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintPersistenceProjectRef } from "@shared/types/ipcEvents";
import type { DevModeSaveProjectRef } from "@shared/types/devModeSave";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import { BlueprintRuntimeDebugPanel } from "./BlueprintRuntimeDebugPanel";
import { GameApp } from "@/lib/ui-editor/runtime/app/GameApp";
import type {
    GameAppFrameContext,
    GameAppHost,
    GameAppOverlayContext,
    GameAppSaveStore,
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import { useDevModeRuntimePlugins } from "../hooks/useDevModeRuntimePlugins";
import { resolveDevModeViewportSize } from "./devModeViewport";

type DevModeContentProps = {
    bundle: DevModeBundle | null;
    projectPath: string | null;
    surface: UISurface | null;
    surfaceId: string;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    handleAspectUpdate: (metrics: { scale: number }) => void;
    sessionError: string | null;
    onDismissSessionError: () => void;
};

function SessionErrorBanner(props: {
    sessionError: string | null;
    onDismissSessionError: () => void;
}): ReactNode {
    const { sessionError, onDismissSessionError } = props;
    const { t } = useTranslation();
    if (!sessionError) {
        return null;
    }
    return (
        <div className="shrink-0 border-b border-danger/40 bg-danger/15 px-3 py-2 text-xs text-danger">
            <div className="flex items-start justify-between gap-2">
                <pre className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-snug">
                    {sessionError}
                </pre>
                <button
                    type="button"
                    className="shrink-0 rounded border border-danger/50 px-2 py-0.5 text-2xs text-danger hover:bg-danger/25"
                    onClick={onDismissSessionError}
                >
                    {t("devMode.dismiss")}
                </button>
            </div>
        </div>
    );
}

/** Studio-only debug tools: floating action button, tools menu, and the Blueprint DevTools panel. */
function DevModeDebugOverlay(props: {
    core: BlueprintRuntimeCore;
    bundle: DevModeBundle;
    uidoc: UIDocument;
    activeSurfaceId: string;
    widgetRuntimeStore: WidgetRuntimeStateStore;
    projectPath: string | null;
}) {
    const { core, bundle, uidoc, activeSurfaceId, widgetRuntimeStore, projectPath } = props;
    const { t } = useTranslation();
    const [devtoolsMenuOpen, setDevtoolsMenuOpen] = useState(false);
    const [blueprintPanelOpen, setBlueprintPanelOpen] = useState(false);
    const devtoolsFabRef = useRef<HTMLButtonElement>(null);
    const devtoolsMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!devtoolsMenuOpen) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const t = e.target as Node;
            if (devtoolsFabRef.current?.contains(t)) {
                return;
            }
            if (devtoolsMenuRef.current?.contains(t)) {
                return;
            }
            setDevtoolsMenuOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [devtoolsMenuOpen]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            if (devtoolsMenuOpen) {
                setDevtoolsMenuOpen(false);
                e.preventDefault();
                return;
            }
            if (blueprintPanelOpen) {
                setBlueprintPanelOpen(false);
                e.preventDefault();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [devtoolsMenuOpen, blueprintPanelOpen]);

    return (
        <>
            <AnimatePresence>
                {blueprintPanelOpen ? (
                    <motion.div
                        key="blueprint-devtools"
                        role="complementary"
                        aria-label={t("devMode.devtools.title")}
                        className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-[min(100%,380px)] max-w-full flex-col overflow-hidden border-l border-edge bg-surface-sunken shadow-[-8px_0_24px_rgba(0,0,0,0.35)]"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    >
                        <BlueprintRuntimeDebugPanel
                            debug={core.debug}
                            blueprintDocument={bundle.ui.localBlueprints}
                            uiDocument={uidoc}
                            activeSurfaceId={activeSurfaceId}
                            scopeBridge={core.scopeBridge}
                            widgetRuntimeStore={widgetRuntimeStore}
                            projectPath={projectPath}
                            className="h-full min-h-0 w-full border-l-0"
                        />
                    </motion.div>
                ) : null}
            </AnimatePresence>

            <div className="pointer-events-none absolute inset-0 z-40">
                <div className="pointer-events-auto absolute bottom-3 left-3">
                    <div className="relative flex w-11 flex-col items-start">
                        {devtoolsMenuOpen ? (
                            <div
                                ref={devtoolsMenuRef}
                                role="menu"
                                aria-label={t("devMode.devtools.menuAria")}
                                className="absolute bottom-full left-0 z-10 mb-2 w-[min(15rem,calc(100vw-1.5rem))] rounded-md border border-edge bg-surface-sunken py-1 shadow-lg"
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    aria-pressed={blueprintPanelOpen}
                                    className={`flex w-full cursor-default items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                                        blueprintPanelOpen
                                            ? "bg-fill-strong text-fg"
                                            : "text-fg-muted hover:bg-fill hover:text-fg"
                                    }`}
                                    onClick={() => {
                                        setBlueprintPanelOpen(prev => !prev);
                                        setDevtoolsMenuOpen(false);
                                    }}
                                >
                                    <span
                                        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center"
                                        aria-hidden
                                    >
                                        {blueprintPanelOpen ? (
                                            <Check className="h-3.5 w-3.5 text-primary" />
                                        ) : null}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">{t("devMode.devtools.title")}</span>
                                </button>
                            </div>
                        ) : null}
                        <button
                            ref={devtoolsFabRef}
                            type="button"
                            className="pointer-events-auto flex h-11 w-11 shrink-0 cursor-default items-center justify-center rounded-full border border-edge bg-surface-sunken shadow-md outline-none ring-edge-strong transition-colors duration-150 hover:border-edge-strong hover:bg-surface-raised hover:shadow-lg focus-visible:ring-2"
                            aria-label={devtoolsMenuOpen ? t("devMode.devtools.closeMenu") : t("devMode.devtools.openMenu")}
                            aria-expanded={devtoolsMenuOpen}
                            aria-haspopup="menu"
                            onClick={() => setDevtoolsMenuOpen(prev => !prev)}
                        >
                            <img src="/favicon.ico" alt="" className="h-7 w-7 rounded-full" draggable={false} />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

export function DevModeContent(props: DevModeContentProps) {
    const { t } = useTranslation();
    const {
        bundle,
        projectPath,
        surface,
        surfaceId,
        rendererRegistry,
        scale,
        handleAspectUpdate,
        sessionError,
        onDismissSessionError,
    } = props;

    const projectRef = useMemo<BlueprintPersistenceProjectRef & DevModeSaveProjectRef | null>(() => {
        if (!projectPath) {
            return null;
        }
        const rawIdentifier = bundle?.meta?.projectIdentifier;
        const projectIdentifier =
            typeof rawIdentifier === "string" && rawIdentifier.trim() ? rawIdentifier.trim() : undefined;
        return {
            projectIdentifier,
            projectPath,
        };
    }, [bundle?.meta?.projectIdentifier, projectPath]);

    const persistenceAdapter = useMemo(() => {
        if (!projectRef) {
            return null;
        }
        return {
            getAll: async () => {
                const result = await getInterface().blueprintPersistence.getAll(projectRef);
                if (!result.success) {
                    throw new Error(result.error ?? "Failed to read Blueprint persistent values");
                }
                return result.data.values;
            },
            getValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.getValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to read Blueprint persistent value "${key}"`);
                }
                return result.data.value;
            },
            setValue: async (key: string, value: unknown) => {
                const result = await getInterface().blueprintPersistence.setValue(projectRef, key, value);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to write Blueprint persistent value "${key}"`);
                }
            },
            removeValue: async (key: string) => {
                const result = await getInterface().blueprintPersistence.removeValue(projectRef, key);
                if (!result.success) {
                    throw new Error(result.error ?? `Failed to remove Blueprint persistent value "${key}"`);
                }
            },
        };
    }, [projectRef]);

    const onDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        if (!projectPath) {
            return;
        }
        try {
            getInterface().devMode.forwardBlueprintDebugEvent({ projectPath, event });
        } catch (error) {
            console.warn("[DevMode] failed to forward blueprint debug event", error);
        }
    }, [projectPath]);

    const log = useCallback<GameAppHost["log"]>((level, message) => {
        if (level === "error") {
            console.error(message);
        } else if (level === "warning") {
            console.warn(message);
        } else {
            console.info(message);
        }
    }, []);

    const resolveStoryAssetUrl = useCallback<GameAppHost["resolveStoryAssetUrl"]>(async (assetId, assetType) => {
        const result = await getInterface().devMode.resolveAssetUrl(assetId, assetType);
        if (!result.success || !result.data?.url) {
            throw new Error(result.error ?? `Failed to resolve asset: ${assetId}`);
        }
        return result.data.url;
    }, []);

    const requireProjectRef = useCallback((operation: string): DevModeSaveProjectRef => {
        if (!projectRef) {
            throw new Error(`${operation}: project is not available`);
        }
        return projectRef;
    }, [projectRef]);

    const saveStore = useMemo<GameAppSaveStore>(() => ({
        write: async (id, savedGame, capture, metadata) => {
            const ref = requireProjectRef("Save Game");
            const result = await getInterface().devMode.save.write(ref, id, savedGame, capture, metadata);
            if (!result.success) {
                throw new Error(result.error ?? `Save Game failed: ${id}`);
            }
        },
        read: async id => {
            const ref = requireProjectRef("Load Save");
            const result = await getInterface().devMode.save.read(ref, id);
            if (!result.success) {
                throw new Error(result.error ?? `Load Save failed: ${id}`);
            }
            return result.data.record ?? null;
        },
        readPreview: async id => {
            const ref = requireProjectRef("Get Save Preview");
            const result = await getInterface().devMode.save.readPreview(ref, id);
            if (!result.success) {
                throw new Error(result.error ?? `Get Save Preview failed: ${id}`);
            }
            return result.data.capture;
        },
        remove: async id => {
            const ref = requireProjectRef("Delete Save");
            const result = await getInterface().devMode.save.delete(ref, id);
            if (!result.success) {
                throw new Error(result.error ?? `Delete Save failed: ${id}`);
            }
        },
        listIds: async () => {
            const ref = requireProjectRef("List Saves");
            const result = await getInterface().devMode.save.listIds(ref);
            if (!result.success) {
                throw new Error(result.error ?? "List Saves failed");
            }
            return result.data.ids;
        },
    }), [requireProjectRef]);

    const quitApplication = useCallback(async (): Promise<void> => {
        const result = await getInterface().devMode.stop();
        if (!result.success) {
            throw new Error(result.error ?? "Quit failed");
        }
    }, []);

    const getFullscreen = useCallback(async (): Promise<boolean> => {
        const result = await getInterface().devMode.getFullscreen();
        if (!result.success) {
            throw new Error(result.error ?? "Get Fullscreen failed");
        }
        return result.data.isFullscreen;
    }, []);

    const setFullscreen = useCallback(async (fullscreen: boolean): Promise<void> => {
        const result = await getInterface().devMode.setFullscreen(fullscreen);
        if (!result.success) {
            throw new Error(result.error ?? "Set Fullscreen failed");
        }
    }, []);

    const subscribeFullscreenChanged = useCallback((listener: (isFullscreen: boolean) => void): (() => void) => {
        const token = getInterface().devMode.onFullscreenChanged(({ isFullscreen }) => listener(isFullscreen));
        return () => token.cancel();
    }, []);

    // Runtime plugin entries must be registered before the game boots so
    // plugin blueprint nodes and widget renderers resolve at execution time.
    // Failed plugins are logged and skipped; they never block the game.
    const runtimePlugins = useDevModeRuntimePlugins(rendererRegistry);

    const host = useMemo<GameAppHost | null>(() => {
        if (!bundle || !surface) {
            return null;
        }
        return {
            id: "DevMode",
            bundle,
            sessionKey: `${bundle.bundleId}:${bundle.revision}:${surface.id}`,
            entrySurfaceId: surface.id,
            ready: runtimePlugins.ready,
            bootAction: { kind: "surface" },
            persistenceAdapter,
            onDebugEvent,
            disposeMessage: "Dev Mode runtime disposed",
            log,
            resolveStoryAssetUrl,
            saveStore,
            quitApplication,
            getFullscreen,
            setFullscreen,
            subscribeFullscreenChanged,
        };
    }, [
        bundle,
        getFullscreen,
        log,
        onDebugEvent,
        persistenceAdapter,
        quitApplication,
        resolveStoryAssetUrl,
        runtimePlugins.ready,
        saveStore,
        setFullscreen,
        subscribeFullscreenChanged,
        surface,
    ]);

    const getScale = useCallback(() => scale, [scale]);

    const renderFrame = useCallback((ctx: GameAppFrameContext) => {
        const viewportSize = resolveDevModeViewportSize({
            activeSurfaceDesignSize: ctx.activeSurface.designSize,
            gameViewport: ctx.gameViewport,
        });
        return (
            <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="min-h-0 min-w-0 flex-1">
                    <StageViewportFrame
                        designSize={viewportSize}
                        onRenderScaleChange={value => handleAspectUpdate({ scale: value })}
                    >
                        {ctx.children}
                    </StageViewportFrame>
                </div>
            </div>
        );
    }, [handleAspectUpdate]);

    const renderPlaceholder = useCallback(() => (
        <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
            {t("devMode.surfaceUnavailable")}
        </div>
    ), [t]);

    const renderOverlays = useCallback((ctx: GameAppOverlayContext) => {
        if (!ctx.core || !ctx.activeSurface || !bundle) {
            return null;
        }
        return (
            <DevModeDebugOverlay
                core={ctx.core}
                bundle={bundle}
                uidoc={bundle.ui.uidoc}
                activeSurfaceId={ctx.activeSurface.id}
                widgetRuntimeStore={ctx.widgetRuntimeStore}
                projectPath={projectPath}
            />
        );
    }, [bundle, projectPath]);

    if (!bundle || !host) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
                    {t("devMode.waitingPayload")}
                </div>
            </div>
        );
    }

    if (!surface) {
        return (
            <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
                <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
                <div className="flex flex-1 items-center justify-center text-sm text-fg-muted">
                    {t("devMode.surfaceNotFound", { surfaceId })}
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden">
            <SessionErrorBanner sessionError={sessionError} onDismissSessionError={onDismissSessionError} />
            <GameApp
                host={host}
                rendererRegistry={rendererRegistry}
                getScale={getScale}
                renderFrame={renderFrame}
                renderPlaceholder={renderPlaceholder}
                renderOverlays={renderOverlays}
            />
        </div>
    );
}
