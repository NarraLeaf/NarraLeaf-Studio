import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { setActiveBrandPalette } from "@shared/brand/brandRegistry";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import { BUILTIN_BRAND_COLORS } from "@shared/types/brand";
import type { DevModeBundle } from "@shared/types/devMode";
import type { GameRuntimePackV1, GameRuntimePreloadBridge } from "@shared/types/gameRuntime";
import type { UISurface } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { GameApp } from "@/lib/ui-editor/runtime/app/GameApp";
import type {
  GameAppFrameContext,
  GameAppHost,
  GameAppSaveStore
} from "@/lib/ui-editor/runtime/app/GameAppHost";
import { StageViewportFrame } from "@/lib/ui-editor/runtime/app/StageViewportFrame";
import { loadRuntimePlugins } from "@/lib/ui-editor/runtime/plugins/loadRuntimePlugins";
import { RuntimePluginHostController } from "@/lib/ui-editor/runtime/plugins/runtimePluginHostController";
import { RuntimeCrashScreen } from "./RuntimeCrashScreen";
import { clearAutomaticRestarts, setRuntimeCrashPolicy } from "./crashPolicy";
import { RuntimeSidecarBackend } from "./runtimeSidecarBackend";
import { isMobileShellDocument, resolveStageViewport } from "./stageViewportConfig";
import { readRuntimeTestSignalReporter } from "../gameTestSignal";
import {
  listPackPuppetBackendSources,
  resolvePackModelBundleUrl
} from "@/lib/ui-editor/runtime/game/puppetPackRuntimes";
import {
  preloadRuntimePackAssets,
  type RuntimeSurfacePreloadResult
} from "./surfaceResourcePreload";

function findSurface(bundle: DevModeBundle, surfaceId: string | undefined): UISurface | null {
  if (surfaceId) {
    const surface = bundle.ui.uidoc.surfaces.find((item) => item.id === surfaceId);
    if (surface) {
      return surface;
    }
  }
  return (
    bundle.ui.uidoc.surfaces.find((surface) => surface.kind === "appSurface") ??
    bundle.ui.uidoc.surfaces[0] ??
    null
  );
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
    void bridge
      .readPack()
      .then((nextPack) => {
        if (disposed) {
          return;
        }
        /**
         * The pack's palette goes live BEFORE `setPack`, and an effect would be too late.
         *
         * Every surface resolves its `nlbrand:` colours while it renders, reading the
         * module-level active palette as it goes. Publishing from an effect means the whole
         * first frame is painted against the seeds and then jumps to the author's colours
         * one commit later - a visible flash on exactly the games that use the feature.
         * Here the pack is in hand and React has not re-rendered yet, so the first paint is
         * already correct.
         *
         * `sidecarBackend?.applyPack` below is the same "the pack arrived" work and it does
         * live in an effect; the difference is that nothing it does is visible in that first
         * frame, so a commit's delay costs nothing there.
         */
        // Before `setPack`, with the palette and for a related reason: anything that
        // throws while this pack is being applied has to find the policy already in place.
        // On the desktop shell this only confirms what the process argument said; on the
        // web export, which has no such channel, it is the first answer there is.
        setRuntimeCrashPolicy(nextPack.crash?.policy);
        setActiveBrandPalette(nextPack.bundle.brand ?? BUILTIN_BRAND_COLORS);
        setActiveSaveSchemaFields(nextPack.bundle.ui.saveSchema ?? []);
        setPack(nextPack);
        setError(null);
      })
      .catch((err) => {
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

/**
 * A game that could not read its own pack.
 *
 * The same screen a render failure gets, because they are the same event to a player: the game
 * does not come up. It used to be a full-width stack trace on a red panel, which told the player
 * nothing they could use and did not even say the game was not coming back.
 */
function RuntimeErrorScreen(props: { message: string }): ReactNode {
  return <RuntimeCrashScreen details={props.message} />;
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
      assetUrl: (assetId) => bridge.assetUrl(assetId)
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.timedOut) {
          bridge.log(
            "warning",
            `[Runtime] Asset preload timed out after 10s: first screen ${result.firstSurfaceLoaded}/${result.firstSurfaceAssetIds.length}, total ${result.loaded}/${result.assetIds.length}`
          );
        } else if (result.failed.length > 0) {
          bridge.log(
            "warning",
            `[Runtime] Asset preload finished with ${result.failed.length} failed asset(s): ${result.failed.join(", ")}`
          );
        } else {
          bridge.log(
            "info",
            `[Runtime] Asset preload finished: ${result.assetIds.length} asset(s)`
          );
        }
        setState({ key: preloadKey, ready: true, result });
      })
      .catch((err) => {
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
            timedOut: false
          }
        });
      });
    return () => {
      cancelled = true;
    };
  }, [firstSurface, pack]);

  const expectedKey =
    pack && firstSurface
      ? `${pack.bundle.bundleId}:${pack.bundle.revision}:${firstSurface.id}`
      : null;
  return {
    ready: Boolean(expectedKey && state.key === expectedKey && state.ready),
    result: expectedKey && state.key === expectedKey ? state.result : null
  };
}

/**
 * Loads the runtime entries of plugins shipped inside the pack before the
 * game boots. A failing plugin never blocks the game; errors go to the
 * runtime log. loadRuntimePlugins is idempotent per plugin id+version+entry.
 */
function useRuntimePlugins(
  pack: GameRuntimePackV1 | null,
  rendererRegistry: ElementRendererRegistry,
  pluginHost: RuntimePluginHostController
): boolean {
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
    const descriptors = plugins.map((entry) => ({
      plugin: {
        id: entry.manifest.id,
        name: entry.manifest.name,
        version: entry.manifest.version,
        publisher: entry.manifest.publisher
      },
      manifest: entry.manifest,
      // Without a bridge nothing can load anyway; the desktop scheme is
      // only a placeholder so the descriptor stays well-formed.
      entryUrl:
        bridge?.pluginEntryUrl(entry.entryRelativePath) ??
        `nlgame://runtime/${entry.entryRelativePath}`,
      ...(entry.data ? { data: entry.data } : {}),
      // One entry per plugin, so a descriptor carries the values of the plugin it is for and
      // no other's.
      ...(entry.buildConfig ? { buildConfig: entry.buildConfig } : {})
    }));
    void loadRuntimePlugins(descriptors, {
      log,
      elementRenderers: rendererRegistry,
      host: pluginHost.host
    }).finally(() => {
      if (!disposed) {
        setReady(true);
      }
    });
    return () => {
      disposed = true;
    };
  }, [pack, pluginHost, rendererRegistry]);

  return ready;
}

/**
 * Capability backends this shell can serve, built from the runtime bridge alone
 * so it is identical on desktop and web except where the bridge itself differs
 * (`capabilities.closeRequested`). Created once per process: plugin `setup()`
 * captures these objects and they have to outlive every game session.
 */
function createRuntimePluginHost(
  bridge: GameRuntimePreloadBridge | null,
  sidecar: RuntimeSidecarBackend | null
): RuntimePluginHostController {
  if (!bridge) {
    // No bridge means nothing can load anyway; an empty shell keeps the
    // capability gating honest instead of handing out backends that throw.
    return new RuntimePluginHostController({});
  }
  return new RuntimePluginHostController({
    persistence: {
      getAll: () => bridge.persistence.getAll(),
      getValue: (key) => bridge.persistence.getValue(key),
      setValue: (key, value) => bridge.persistence.setValue(key, value),
      removeValue: (key) => bridge.persistence.removeValue(key)
    },
    saves: {
      // This shell always mounts a game app, which attaches the write and
      // load paths once it is up.
      writable: true,
      listIds: () => bridge.save.listIds(),
      readMetadata: async (id) => {
        // readPreview would be cheaper but only yields the screenshot;
        // the record is the only place the timestamps and the game's own
        // metadata live.
        const record = await bridge.save.read(id);
        if (!record) {
          return null;
        }
        const updatedAt = Date.parse(record.metadata.updatedAt ?? "");
        return {
          id: record.metadata.id ?? id,
          ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
          ...(record.metadata.user === undefined ? {} : { metadata: record.metadata.user })
        };
      }
    },
    assetUrl: (assetId) => bridge.assetUrl(assetId),
    subscribeFullscreenChanged: (listener) => bridge.onFullscreenChanged(listener),
    // Observers only: a plugin watching the close never gets to veto it, so
    // this handler always agrees and the blueprint decider stays the only
    // thing that can cancel a close.
    ...(bridge.capabilities?.closeRequested
      ? {
          subscribeCloseRequested: (listener: () => void) =>
            bridge.onCloseRequested(() => {
              listener();
              return true;
            })
        }
      : {}),
    // Present on desktop, absent on the web export - see web.ts. The loader
    // turns that absence into "no app.game.sidecar here".
    ...(sidecar ? { sidecar } : {}),
    // Forwarded, never decided: the shell behind this bridge re-reads the pack and checks the
    // named plugin's own declared patterns. Present on both shells, because both can open an
    // address - the desktop one through the platform opener, the web one through the browser.
    navigation: {
      openExternal: (ownerPluginId, request) =>
        bridge.externalLink.openForPlugin(ownerPluginId, request)
    },
    log: (level, message) => bridge.log(level, message)
  });
}

export function GameRuntimeApp() {
  const { pack, error } = useRuntimePack();
  const [renderScale, setRenderScale] = useState(1);
  const bridge = getGameRuntimeBridge();
  const rendererRegistry = useMemo(() => new ElementRendererRegistry(BuiltinElementRenderers), []);

  const sidecarBackend = useMemo(
    () => (bridge?.sidecar ? new RuntimeSidecarBackend(bridge.sidecar, bridge.log) : null),
    [bridge]
  );
  const pluginHost = useMemo(
    () => createRuntimePluginHost(bridge, sidecarBackend),
    [bridge, sidecarBackend]
  );
  useEffect(() => pluginHost.bindShellEvents(), [pluginHost]);
  /**
   * The engine reaching an ending, on its way out of the process.
   *
   * `event:state.end` is already observed - the plugin host maps it to `gameEnd` and re-binds it
   * for every relaunch and hot reload - but it had no exit from this renderer, so "does this game
   * reach an ending" was unanswerable from outside. Riding the existing hub rather than binding
   * the engine event a second time keeps one subscription per session and means a relaunch does
   * not need remembering here.
   *
   * Inert unless a test is watching: the reporter is absent on the web export and on any pack
   * with no control server, which is every shipped game.
   */
  useEffect(() => {
    const report = readRuntimeTestSignalReporter(bridge);
    const events = pluginHost.host.events;
    if (!report || !events) {
      return;
    }
    return events.on("gameEnd", () => {
      report({ kind: "game-end" });
    });
  }, [bridge, pluginHost]);
  // Before useRuntimePlugins' effect, which is what makes `available()` a real
  // answer by the time any plugin's setup() can ask: effects run in the order
  // their hooks were called, and this hook is declared above that one.
  useEffect(() => {
    if (pack) {
      sidecarBackend?.applyPack(pack);
    }
  }, [pack, sidecarBackend]);

  const entrySurfaceId = pack?.entry.surfaceId ?? undefined;
  const entrySurface = pack ? findSurface(pack.bundle, entrySurfaceId) : null;
  const preload = useRuntimePackPreload({ pack, firstSurface: entrySurface });
  const pluginsReady = useRuntimePlugins(pack, rendererRegistry, pluginHost);
  const runtimeReady = preload.ready && pluginsReady;

  const persistenceAdapter = useMemo(() => {
    if (!bridge) {
      return null;
    }
    return {
      getAll: async () => bridge.persistence.getAll(),
      getValue: async (key: string) => bridge.persistence.getValue(key),
      setValue: async (key: string, value: unknown) => bridge.persistence.setValue(key, value),
      removeValue: async (key: string) => bridge.persistence.removeValue(key)
    };
  }, [bridge]);

  const onDebugEvent = useCallback(
    (event: BlueprintDebugEvent) => {
      if (!bridge) {
        return;
      }
      if (event.type === "execution.error") {
        bridge.log("error", event.message);
      } else if (event.type === "devtools.log") {
        const level = event.level === "error" || event.level === "warning" ? event.level : "info";
        bridge.log(level, event.message);
      }
    },
    [bridge]
  );

  const log = useCallback<GameAppHost["log"]>(
    (level, message) => {
      bridge?.log(level, message);
    },
    [bridge]
  );

  /**
   * The Fetch node's request. Every shell backs this - the desktop preload forwards it to the main
   * process, the web shell runs it in the page - so unlike `sidecar` there is no absent case to
   * branch on, only a bridge that has not been installed yet.
   */
  const networkFetch = useCallback<NonNullable<GameAppHost["networkFetch"]>>(
    async (request) => {
      if (!bridge) {
        return {
          outcome: "networkError",
          status: 0,
          body: null,
          error: "Runtime bridge unavailable"
        };
      }
      return bridge.network.fetch(request);
    },
    [bridge]
  );

  /**
   * The Open Link node's request. Handed to the shell, which decides it: the desktop bridge
   * forwards it to the main process, the web bridge checks it in the page. Neither reads anything
   * this side supplied except the address.
   */
  const openExternal = useCallback<NonNullable<GameAppHost["openExternal"]>>(
    async (request) => {
      if (!bridge) {
        return { outcome: "failed", error: "Runtime bridge unavailable" };
      }
      return bridge.externalLink.open(request);
    },
    [bridge]
  );

  /**
   * The two Progress nodes' requests. Handed to the shell for the reason Open Link is: the
   * process that performs the act is the one that decides which file it is, from the pack's own
   * progress key. Nothing this side supplies names a path.
   */
  const exportProgress = useCallback<NonNullable<GameAppHost["exportProgress"]>>(
    async (request) => {
      if (!bridge) {
        return { outcome: "failed", error: "Runtime bridge unavailable" };
      }
      return bridge.progress.write(request);
    },
    [bridge]
  );

  const importProgress = useCallback<NonNullable<GameAppHost["importProgress"]>>(async () => {
    if (!bridge) {
      return { outcome: "failed", document: null, error: "Runtime bridge unavailable" };
    }
    return bridge.progress.read();
  }, [bridge]);

  /**
   * A model bundle resolves to the URL of its *entry file*, not of the asset id.
   *
   * The engine's `PuppetMountContext.resolveSibling(rel)` does URL arithmetic against whatever
   * this returns to find the bundle's textures and motions, which the model's own manifest names
   * by relative path. `.../asset/{id}` would make every one of those resolve to a sibling of the
   * id; `.../asset/{id}/{entry}` makes them resolve to `{id}/{rel}`, which is exactly the key the
   * packer wrote for each file.
   */
  const resolveStoryAssetUrl = useCallback(
    (assetId: string) => {
      if (!bridge) {
        return assetId;
      }
      // Shared with the puppet widget's seam so the two cannot disagree about where a bundle's
      // root is. An id the pack does not list is still handed to `assetUrl` - the shell's own
      // 404 says more than a silent empty string would.
      return resolvePackModelBundleUrl(bridge, pack, assetId) ?? bridge.assetUrl(assetId);
    },
    [bridge, pack]
  );

  const saveStore = useMemo<GameAppSaveStore>(
    () => ({
      write: async (id, savedGame, capture, metadata) => {
        if (!bridge) {
          throw new Error("Save Game: runtime bridge is not available");
        }
        await bridge.save.write(id, savedGame, capture, metadata);
      },
      read: async (id) => {
        if (!bridge) {
          throw new Error("Save storage is not available");
        }
        const record = await bridge.save.read(id);
        return record ?? null;
      },
      readPreview: async (id) => {
        if (!bridge) {
          return null;
        }
        return bridge.save.readPreview(id);
      },
      remove: async (id) => {
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
      }
    }),
    [bridge]
  );

  const quitApplication = useCallback(async (): Promise<void> => {
    await bridge?.close();
  }, [bridge]);

  const getFullscreen = useCallback(async (): Promise<boolean> => {
    return (await bridge?.getFullscreen()) === true;
  }, [bridge]);

  const setFullscreen = useCallback(
    async (fullscreen: boolean): Promise<void> => {
      await bridge?.setFullscreen(fullscreen);
    },
    [bridge]
  );

  const subscribeFullscreenChanged = useCallback(
    (listener: (isFullscreen: boolean) => void): (() => void) => {
      return bridge?.onFullscreenChanged(listener) ?? (() => undefined);
    },
    [bridge]
  );

  const subscribeCloseRequested = useCallback(
    (listener: () => boolean | Promise<boolean>): (() => void) => {
      return bridge?.onCloseRequested(listener) ?? (() => undefined);
    },
    [bridge]
  );

  /**
   * The puppet backends published with this game.
   *
   * Shared with the Surface `nl.puppet` widget's mounting seam (see
   * `puppetPackRuntimes.ts`) rather than derived here: both need the same
   * module URL and the same confined `resolveFile`, and a stage that loads a
   * backend one way while a widget loads it another is a difference nobody
   * would notice until one of them stopped drawing.
   */
  const listPuppetBackendModules = useCallback(
    async () => listPackPuppetBackendSources(bridge, pack),
    [bridge, pack]
  );

  const host = useMemo<GameAppHost | null>(() => {
    if (!pack) {
      return null;
    }
    return {
      id: "Runtime",
      bundle: pack.bundle,
      sessionKey: `${pack.bundle.bundleId}:${pack.bundle.revision}:${entrySurfaceId ?? ""}`,
      entrySurfaceId,
      // As the pack states it, resolved for the variant this build was produced as. Absent is
      // a build that shows nothing when its story ends, which is what every pack made before
      // this field carries and what every pack whose project picked no page carries.
      endingSurfaceId: pack.endingSurfaceId,
      ready: runtimeReady,
      bootAction:
        pack.entry.kind === "story"
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
      subscribeCloseRequested,
      listPuppetBackendModules,
      networkFetch,
      openExternal,
      exportProgress,
      importProgress
    };
  }, [
    entrySurfaceId,
    networkFetch,
    openExternal,
    exportProgress,
    importProgress,
    getFullscreen,
    listPuppetBackendModules,
    log,
    onDebugEvent,
    pack,
    persistenceAdapter,
    quitApplication,
    resolveStoryAssetUrl,
    runtimeReady,
    setFullscreen,
    subscribeFullscreenChanged,
    subscribeCloseRequested,
    saveStore
  ]);

  // The game is up: whatever automatic restarts it took to get here are spent, and the next
  // failure is a new incident rather than the same one continuing. Without this, a game that
  // crashed on Monday would refuse to restart itself on Tuesday.
  useEffect(() => {
    if (runtimeReady && host) {
      clearAutomaticRestarts();
    }
  }, [runtimeReady, host]);

  const getScale = useCallback(() => renderScale, [renderScale]);

  // Read once: the document cannot become a phone halfway through a session, and re-querying it
  // on every frame render would be a DOM lookup per surface change for an answer that never moves.
  const stageViewport = useMemo(
    () =>
      resolveStageViewport({
        viewport: pack?.viewport,
        mode: pack?.mode ?? "production",
        isMobileShell: isMobileShellDocument()
      }),
    [pack?.viewport, pack?.mode]
  );

  const renderFrame = useCallback(
    (ctx: GameAppFrameContext) => (
      <StageViewportFrame
        designSize={ctx.activeSurface.designSize}
        onRenderScaleChange={setRenderScale}
        fit={stageViewport.fit}
        cropAnchor={stageViewport.cropAnchor}
        outerClassName="bg-black text-white"
        // Viewport units, not 100%: the runtime's #root has no fixed height, so height:100%
        // would collapse to content height and shrink the stage (breaking downsampling).
        outerStyle={{ width: "100vw", height: "100vh" }}
        boxStyle={{ backgroundColor: getSurfaceBackgroundColor(ctx.activeSurface) }}
      >
        {ctx.children}
      </StageViewportFrame>
    ),
    [stageViewport]
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
      pluginHost={pluginHost}
    />
  );
}
