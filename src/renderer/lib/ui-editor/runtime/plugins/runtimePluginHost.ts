/**
 * Backends the surrounding game environment supplies to the runtime plugin
 * loader.
 *
 * The loader itself is environment-agnostic: it knows which capabilities a
 * plugin declared, but not how to persist a value or draw an overlay. Each
 * environment (production/preview shell, Dev Mode window, web export) passes the
 * subset it can actually serve, and a capability the environment cannot back is
 * simply absent from `app.game` — the same shape as a capability the plugin
 * never declared. That keeps "declared but unavailable here" and "not declared"
 * indistinguishable to plugin code, which is what makes a single plugin build
 * work across shells that genuinely differ.
 *
 * Must stay under `@/lib/ui-editor/` so the standalone game runtime bundle can
 * include it (see project/build/build-runtime.js allowedPrefixes).
 */

import type { ReactElement } from "react";
import type {
    BlueprintOpenExternalRequest,
    BlueprintOpenExternalResult,
} from "@shared/types/blueprint/externalLink";
import type {
    RuntimePluginEventMap,
    RuntimePluginSaveMetadata,
    RuntimePluginStateChange,
    RuntimePluginStateScope,
} from "./runtimePluginApi";

export type RuntimePluginHostUnsubscribe = () => void;

/**
 * Plugin-scoped persistence. The loader prefixes every key with the plugin id
 * before it reaches this backend, so an implementation may treat the key space
 * as flat.
 */
export type RuntimePluginStoreBackend = {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    /** Every key currently stored, unprefixed filtering is the loader's job. */
    keys(): Promise<string[]>;
};

export type RuntimePluginEventBackend = {
    /**
     * Subscribe to one bridged event. Implementations that cannot produce an
     * event must report it through {@link supports} rather than silently
     * accepting a listener that never fires.
     */
    on<K extends keyof RuntimePluginEventMap>(
        event: K,
        listener: (payload: RuntimePluginEventMap[K]) => void,
    ): RuntimePluginHostUnsubscribe;
    supports(event: keyof RuntimePluginEventMap): boolean;
};

export type RuntimePluginStateBackend = {
    get(scope: RuntimePluginStateScope, key: string): unknown;
    set(scope: RuntimePluginStateScope, key: string, value: unknown): void;
    onChange(listener: (change: RuntimePluginStateChange) => void): RuntimePluginHostUnsubscribe;
};

export type RuntimePluginSavesBackend = {
    listIds(): Promise<string[]>;
    readMetadata(id: string): Promise<RuntimePluginSaveMetadata | null>;
    /**
     * Write and load are optional on the backend as well as gated by capability:
     * an environment may be able to list saves without being able to replace the
     * running playthrough.
     */
    write?: (id: string, metadata?: unknown) => Promise<void>;
    load?: (id: string) => Promise<void>;
};

export type RuntimePluginOverlayBackend = {
    /**
     * Mount a plugin-provided element above the game. The host renders it — the
     * game environment withholds `react-dom/client` on purpose, so plugins
     * cannot create a competing React root.
     */
    mount(ownerPluginId: string, render: () => ReactElement | null): RuntimePluginHostUnsubscribe;
};

export type RuntimePluginLocaleBackend = {
    current(): string;
    onChange(listener: (locale: string) => void): RuntimePluginHostUnsubscribe;
};

export type RuntimePluginAssetsBackend = {
    url(assetId: string): string;
};

export type RuntimePluginSidecarBackend = {
    available(ownerPluginId: string, sidecarId: string): boolean;
    request(ownerPluginId: string, sidecarId: string, method: string, params?: unknown): Promise<unknown>;
    notify(ownerPluginId: string, sidecarId: string, method: string, params?: unknown): void;
    start(ownerPluginId: string, sidecarId: string): Promise<void>;
    stop(ownerPluginId: string, sidecarId: string): Promise<void>;
    onEvent(
        ownerPluginId: string,
        sidecarId: string,
        listener: (method: string, params: unknown) => void,
    ): RuntimePluginHostUnsubscribe;
    onExit(
        ownerPluginId: string,
        sidecarId: string,
        listener: (info: { code: number | null; signal: string | null }) => void,
    ): RuntimePluginHostUnsubscribe;
};

/**
 * Opening an address outside the game on one plugin's behalf.
 *
 * `ownerPluginId` travels because the decision belongs to the process at the far end of this
 * backend, and that process decides against *that plugin's* declared patterns. The loader is what
 * fills the id in - a plugin never names itself - so the id is as trustworthy as the renderer is,
 * which is the same posture the sidecar backend documents: the boundary that holds is that the
 * patterns are read from the pack the player installed, so the worst a plugin can do with another
 * plugin's id is open an address the game already shipped a declaration for and the author already
 * approved. Nothing the renderer says widens that set.
 */
export type RuntimePluginNavigationBackend = {
    openExternal(
        ownerPluginId: string,
        request: BlueprintOpenExternalRequest,
    ): Promise<BlueprintOpenExternalResult>;
};

/**
 * What this environment can back. Everything is optional: the web export has no
 * sidecar, Dev Mode may not wire saves, and a bare test harness supplies none of
 * it.
 */
export type RuntimePluginHost = {
    store?: RuntimePluginStoreBackend;
    events?: RuntimePluginEventBackend;
    state?: RuntimePluginStateBackend;
    saves?: RuntimePluginSavesBackend;
    overlay?: RuntimePluginOverlayBackend;
    locale?: RuntimePluginLocaleBackend;
    assets?: RuntimePluginAssetsBackend;
    sidecar?: RuntimePluginSidecarBackend;
    navigation?: RuntimePluginNavigationBackend;
};
