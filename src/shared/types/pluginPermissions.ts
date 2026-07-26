export const ApiCapability = {
    PluginPermissionGrant: "plugin.permission.grant",
    PluginTrustGrant: "plugin.trust.grant",
    PluginFileSystemGrant: "plugin.fs.grant",
    PluginInstallApprove: "plugin.install.approve",
    BashExecute: "bash.execute",
} as const;

export type ApiCapability = typeof ApiCapability[keyof typeof ApiCapability];

export type PluginPermissionPersistence = "temporary" | "permanent";
export type PluginFileSystemPermissionMode = "read" | "write" | "readwrite";

/**
 * Install-time permissions split into two families, and the split is the whole
 * point:
 *
 * - **Author-declared** (`filesystem`, `api`) — privileged Studio controls the
 *   plugin asks for explicitly in `permissions[]`.
 * - **Derived** (`runtime`, `sidecar`, `buildDependency`) — computed from
 *   `contributes` by {@link validatePluginManifest} and *rejected* if written by
 *   hand. A capability is declared in exactly one place, so what the prompt shows
 *   and what the plugin can actually reach cannot drift apart. Adding a
 *   capability widens the permission set, which makes the update re-prompt for
 *   free (see `isPermissionSubset`).
 */
export type PluginInstallPermission =
    | {
        kind: "filesystem";
        path: string;
        mode: PluginFileSystemPermissionMode;
        recursive: boolean;
    }
    | {
        kind: "api";
        capability: string;
    }
    | {
        /** Derived from `contributes.runtimeCapabilities`. */
        kind: "runtime";
        capability: PluginRuntimeCapability;
    }
    | {
        /** Derived from `contributes.sidecars`: a native child process shipped inside the author's game. */
        kind: "sidecar";
        id: string;
        /** `<platform>-<arch>` keys the sidecar ships binaries for. */
        platforms: string[];
    }
    | {
        /** Derived from `contributes.buildDependencies`: binaries downloaded at build time. */
        kind: "buildDependency";
        id: string;
        /** Distinct hostnames the binaries are fetched from. */
        hosts: string[];
    };

/**
 * Capability domains a plugin's `runtime` entry can ask for. Each maps 1:1 onto a
 * namespace on `app.game`: an undeclared domain is *absent from the object*, not
 * a method that throws. The list is closed — an unknown capability fails manifest
 * validation rather than being silently ignored, so a typo can never read as
 * "asked for nothing".
 */
export const PluginRuntimeCapability = {
    /** `app.game.store` — plugin-scoped persistent key/value storage. */
    Store: "store",
    /** `app.game.events` — game lifecycle and engine event subscription. */
    Events: "events",
    /** `app.game.state.get` — read story variables. */
    StateRead: "state.read",
    /** `app.game.state.set` — write story variables. */
    StateWrite: "state.write",
    /** `app.game.saves` — list and read save metadata. */
    SavesRead: "saves.read",
    /**
     * `app.game.saves.write` / `.load` — overwrite a save slot and load one.
     *
     * Separate from (and heavier than) `saves.read`: this can destroy a
     * playthrough. It exists because quick-save/quick-load is an ordinary thing
     * for a visual novel to ship — the built-in Quick Save plugin is exactly
     * this — and a capability model that cannot express a feature the product
     * already has would just push authors back around it.
     */
    SavesWrite: "saves.write",
    /** `app.game.ui.overlay` — draw on top of the game. */
    UiOverlay: "ui.overlay",
    /** `app.game.assets` — resolve packaged asset URLs. */
    Assets: "assets",
    /** `app.game.locale` — read and observe the game language. */
    Locale: "locale",
} as const;

export type PluginRuntimeCapability = typeof PluginRuntimeCapability[keyof typeof PluginRuntimeCapability];

export const PLUGIN_RUNTIME_CAPABILITIES: readonly PluginRuntimeCapability[] =
    Object.values(PluginRuntimeCapability);

/**
 * `app.game.sidecar` has no entry here on purpose: it exists exactly when
 * `contributes.sidecars` is non-empty. Declaring the sidecar *is* the request.
 */

export interface PluginIdentity {
    id: string;
    name?: string;
    version?: string;
    publisher?: string;
}

interface PluginPermissionRequestBase {
    requestId: string;
    plugin: PluginIdentity;
    reason?: string;
    requestedAt?: number;
}

export type PluginPermissionRequest =
    | (PluginPermissionRequestBase & {
        kind: "trust";
        persistence?: PluginPermissionPersistence;
    })
    | (PluginPermissionRequestBase & {
        kind: "filesystem";
        path: string;
        mode: PluginFileSystemPermissionMode;
        recursive: boolean;
        persistence: PluginPermissionPersistence;
    })
    | (PluginPermissionRequestBase & {
        kind: "install";
        source: string;
        permissions?: PluginInstallPermission[];
        persistence?: PluginPermissionPersistence;
    })
    | (PluginPermissionRequestBase & {
        kind: "api";
        capability: string;
        persistence?: PluginPermissionPersistence;
    });

export interface PluginPermissionDecision {
    requestId: string;
    approved: boolean;
    persistence?: PluginPermissionPersistence;
}

export interface PluginPermissionGrantPayload {
    request: PluginPermissionRequest;
    decision: PluginPermissionDecision;
}

export interface PluginPermissionGrantResult {
    requestId: string;
    pluginId: string;
    kind: PluginPermissionRequest["kind"];
    approved: boolean;
    persistence: PluginPermissionPersistence;
    grantedAt?: number;
}

export interface PluginTrustGrantRecord {
    plugin: PluginIdentity;
    trusted: true;
    persistence: PluginPermissionPersistence;
    grantedAt: number;
    sourceRequestId: string;
}

export interface PluginFileSystemGrantRecord {
    plugin: PluginIdentity;
    path: string;
    mode: PluginFileSystemPermissionMode;
    recursive: boolean;
    persistence: PluginPermissionPersistence;
    grantedAt: number;
    sourceRequestId: string;
}

export interface PluginApiGrantRecord {
    plugin: PluginIdentity;
    capability: string;
    persistence: PluginPermissionPersistence;
    grantedAt: number;
    sourceRequestId: string;
}

export interface PluginPermissionPromptProps {
    request: PluginPermissionRequest;
    requester?: {
        windowType: string;
        title?: string;
    };
}

export type PluginPermissionPromptResult = PluginPermissionGrantResult | null;
