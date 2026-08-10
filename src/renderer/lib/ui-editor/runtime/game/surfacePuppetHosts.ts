/**
 * Which of the three hosts is going to find this Surface puppet widget's model, and in what order.
 *
 * ## The order, and why it is this order
 *
 * 1. **Workspace services** — `Services.PuppetDescription`. Preferred wherever it exists because it
 *    is the only arm that also *caches descriptions*: mounting through it fills the motion/expression/
 *    skin dropdowns as a side effect, so the inspector does not pay a second mount to learn what the
 *    model contains.
 * 2. **The Dev Mode registry** — a Dev Mode window has no workspace services but does hold the
 *    project: `projectPath` plus a recursive read grant on it. It installs a resolver here at startup
 *    (see `apps/dev-mode/devModePuppetHost.ts`) and this reads it back.
 * 3. **The packaged bridge** — a shipped or previewed game, resolved against its pack.
 * 4. **Nothing.** Reported as `missing-backend`: the box keeps its place and draws nothing. Not
 *    `error` — a host that cannot look up runtimes has not failed at anything, and this is the state
 *    every Surface renders in until one of the three arms is present.
 *
 * The order lives here, once, rather than in each copy of `useSurfacePuppetSession`. Those two copies
 * are typechecked as unrelated modules (see the guard in the runtime shim), so an order implemented
 * twice is an order that will eventually be two different orders.
 *
 * ## Why a module-level registry rather than a prop
 *
 * Because a widget renderer is mounted deep inside a `GameApp` surface tree that knows nothing about
 * the shell that booted it, and threading a resolver down through it would put a puppet-shaped
 * parameter on every layer in between. The same reasoning, and the same shape, as
 * `getGameRuntimeBridge()` in `gameRuntimeBridge.ts` and `resolveCharacterAvatarAssetUrl()` in
 * `characterAvatarAssets.ts`. Unlike those two this one is subscribable, because Dev Mode installs its
 * resolver from an effect and a widget can easily mount first.
 *
 * Nothing here names a renderer and nothing here may.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { PuppetBackendModuleSource } from "./puppetBackendHost";
import { createPuppetModelSession } from "./puppetModelSession";
import { resolveBundleEntry } from "./storyCompiler";
import {
    SurfacePuppetUnavailableError,
    type SurfacePuppetOpener,
} from "./surfacePuppetSession";
import { getGameRuntimeBridge } from "../gameRuntimeBridge";
import { findPackPuppetBackendSource, resolvePackModelBundleUrl } from "./puppetPackRuntimes";

/**
 * The two lookups a host has to be able to do, and the whole of what distinguishes one host from
 * another.
 *
 * Everything downstream — finding the named backend, applying an entry override, mounting — is
 * identical in every host and lives in {@link createPuppetHostOpener}. Deliberately not "give me a
 * session": a host that had to build one would be re-implementing the mount, which is exactly the
 * duplication that produced a Dev Mode stage able to draw puppets and a Dev Mode widget that could not.
 */
export interface SurfacePuppetHost {
    /** For diagnostics. Which arm answered. */
    readonly kind: "dev-mode" | "packaged";
    /** Every author-supplied runtime this host can see. Empty is the normal case. */
    listBackendModules(): Promise<readonly PuppetBackendModuleSource[]>;
    /**
     * The URL of a model bundle's **entry file**, not of the asset id.
     *
     * `PuppetMountContext.resolveSibling(rel)` does URL arithmetic against this to find the bundle's
     * textures and motions, so a URL the bundle's own relative references do not resolve against is
     * worse than none. Null when the asset is not in this host.
     */
    resolveModelBundleUrl(assetId: string): Promise<string | null>;
}

// ---------------------------------------------------------------- the Dev Mode registry

let devModeHost: SurfacePuppetHost | null = null;
let devModeVersion = 0;
const devModeListeners = new Set<() => void>();

function notifyDevModeHost(): void {
    devModeVersion += 1;
    for (const listener of [...devModeListeners]) {
        try {
            listener();
        } catch {
            // A subscriber's own failure is not this registry's to propagate.
        }
    }
}

/**
 * Install the Dev Mode window's resolver. Returns the uninstaller; call it when the project closes so
 * a relaunch against a different project cannot be served by the previous one's grants.
 */
export function registerDevModePuppetHost(host: SurfacePuppetHost): () => void {
    devModeHost = host;
    notifyDevModeHost();
    return () => {
        if (devModeHost === host) {
            devModeHost = null;
            notifyDevModeHost();
        }
    };
}

export function getDevModePuppetHost(): SurfacePuppetHost | null {
    return devModeHost;
}

/** Test seam, and the reset a window teardown would otherwise leave to chance. */
export function __resetDevModePuppetHost(): void {
    devModeHost = null;
    notifyDevModeHost();
}

// ---------------------------------------------------------------- the packaged arm

let packagedHost: SurfacePuppetHost | null | undefined;

/**
 * The pack, once per window.
 *
 * `GameRuntimeApp` holds it in React state and a widget renderer is nowhere near that state, so the
 * pack is re-read here and memoised: `readPack()` is a plain read of a file the shell already served,
 * and it happens at most once. A pack that cannot be read degrades to "this game published no
 * runtimes" — the shell has already put the real failure on screen.
 */
export function createPackagedPuppetHost(): SurfacePuppetHost | null {
    if (packagedHost !== undefined) {
        return packagedHost;
    }
    const bridge = getGameRuntimeBridge();
    if (!bridge) {
        packagedHost = null;
        return null;
    }
    const pack = bridge.readPack().catch(() => null);
    packagedHost = {
        kind: "packaged",
        listBackendModules: async () => {
            const resolved = await pack;
            return (resolved?.puppetRuntimes ?? [])
                .map(runtime => findPackPuppetBackendSource(bridge, resolved, runtime.name))
                .filter((source): source is PuppetBackendModuleSource => source !== null);
        },
        resolveModelBundleUrl: async assetId => resolvePackModelBundleUrl(bridge, await pack, assetId),
    };
    return packagedHost;
}

/** Test seam: the module-level memo would otherwise leak one test's pack into the next. */
export function __resetPackagedPuppetHost(): void {
    packagedHost = undefined;
}

// ---------------------------------------------------------------- host -> opener

/**
 * The mount, written once for every host that can answer the two lookups.
 *
 * Throws {@link SurfacePuppetUnavailableError} for "nothing to mount" and anything else for "it
 * broke", which is the split `SurfacePuppetMount` degrades on.
 */
export function createPuppetHostOpener(host: SurfacePuppetHost): SurfacePuppetOpener {
    return async ({ request, container, size, onWarn }) => {
        const sources = await host.listBackendModules();
        const source = sources.find(candidate => candidate.id === request.backend);
        if (!source) {
            // The exact condition the engine calls `missing-backend`: the box is there, nothing answers
            // to its backend name. A project (or a published game) without the author's runtime draws
            // nothing and keeps working.
            throw new SurfacePuppetUnavailableError(
                "backend-missing",
                `No puppet runtime named "${request.backend}" is available here`,
            );
        }
        const bundleUrl = request.assetId ? await host.resolveModelBundleUrl(request.assetId) : null;
        if (!bundleUrl) {
            throw new SurfacePuppetUnavailableError(
                "no-model",
                `Model bundle ${request.assetId ?? "(none)"} is not available here`,
            );
        }
        const override = request.entry?.trim() ?? "";
        return createPuppetModelSession({
            container,
            source,
            backend: request.backend,
            src: override ? resolveBundleEntry(bundleUrl, override) : bundleUrl,
            options: request.options ?? {},
            size,
            onWarn: warning => onWarn(warning.message),
        });
    };
}

// ---------------------------------------------------------------- the chain

/**
 * The documented order, as one function. See this module's header for why it is this order.
 *
 * `workspaceOpener` is passed in rather than looked up because it is the one arm that cannot live in
 * the shared tree — building it needs `@/lib/workspace`, which the packaged runtime bundle is not
 * allowed to import.
 */
export function resolveSurfacePuppetOpener(
    workspaceOpener: SurfacePuppetOpener | null,
): SurfacePuppetOpener | null {
    if (workspaceOpener) {
        return workspaceOpener;
    }
    const devMode = getDevModePuppetHost();
    if (devMode) {
        return createPuppetHostOpener(devMode);
    }
    const packaged = createPackagedPuppetHost();
    return packaged ? createPuppetHostOpener(packaged) : null;
}

/**
 * {@link resolveSurfacePuppetOpener} as a hook, re-running when Dev Mode installs or withdraws its
 * resolver.
 *
 * The subscription is what makes arm 2 reliable: Dev Mode registers from an effect, and a widget whose
 * surface mounted first would otherwise sit at `missing-backend` for the life of the window.
 */
export function useSurfacePuppetOpener(
    workspaceOpener: SurfacePuppetOpener | null,
): SurfacePuppetOpener | null {
    const subscribe = useCallback((onChange: () => void) => {
        devModeListeners.add(onChange);
        return () => { devModeListeners.delete(onChange); };
    }, []);
    const registryVersion = useSyncExternalStore(subscribe, () => devModeVersion, () => devModeVersion);
    // Memoised on the version rather than on the resolver object: the opener's identity is what keys
    // the mount effect, so rebuilding it per render would remount the model on every render.
    return useMemo(
        () => resolveSurfacePuppetOpener(workspaceOpener),
        [workspaceOpener, registryVersion],
    );
}
