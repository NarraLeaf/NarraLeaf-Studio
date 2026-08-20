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
 * - **Derived** (`runtime`, `sidecar`, `buildDependency`, `externalLink`,
 *   `network`) — computed from `contributes` by {@link validatePluginManifest}
 *   and *rejected* if written by
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
        /**
         * Which of the two sidecar shapes this is, carried through from the manifest because the
         * two are different promises: `executable` starts a separate binary, `node` runs the
         * plugin's own JavaScript under the game's Electron as Node. An author told only "this
         * ships a helper program" has not been told which one they are approving.
         *
         * Named apart from `kind` above on purpose - that one says which permission this is, this
         * one says what the sidecar runs.
         */
        sidecarKind: PluginSidecarKind;
        /** `<platform>-<arch>` keys the sidecar ships binaries for. */
        platforms: string[];
    }
    | {
        /** Derived from `contributes.buildDependencies`: binaries downloaded at build time. */
        kind: "buildDependency";
        id: string;
        /** Distinct hostnames the binaries are fetched from. */
        hosts: string[];
    }
    | {
        /**
         * Derived from `contributes.externalLinks`: addresses outside the game this plugin may open
         * in the player's browser or platform handler.
         *
         * One permission carrying every pattern rather than one permission each, because what the
         * author is deciding is a single question - "may this plugin send the player out to these
         * places" - and a prompt that asked it four times would be four chances to stop reading.
         * `isPermissionSubset` still compares the patterns one by one, so adding one to a later
         * version widens the set and re-prompts.
         *
         * The patterns are the author's own strings, unrewritten: this list is what the prompt
         * shows, and normalizing a permission before showing it to the person approving it would
         * make the prompt and the manifest two slightly different documents.
         */
        kind: "externalLink";
        patterns: string[];
    }
    | {
        /**
         * Derived from `contributes.network`: hosts this plugin's runtime code requests bytes from.
         *
         * A separate question from `externalLink` and never folded into it. Opening a page hands an
         * address to the browser the player already uses and nothing comes back; this fetches, and
         * what comes back runs inside the game. An author deciding about one has not decided about
         * the other.
         *
         * The patterns are also what a project's network allowlist shows attributed to this plugin,
         * which is the point of declaring them: a build narrowed to a list still reaches what the
         * author approved here, and the list can say so rather than silently making room.
         */
        kind: "network";
        patterns: string[];
    };

/**
 * How a sidecar's shipped files are started.
 *
 * - `executable` — a separate binary, spawned as its own process.
 * - `node` — the plugin's own JavaScript, run under the game's Electron as Node, which gives it
 *   everything Node can reach on the player's machine.
 *
 * It lives here rather than beside `PluginSidecarContribution` so the contribution and the derived
 * permission read the same union: `plugins.ts` already imports from this module, and one of the two
 * spelling out `"executable" | "node"` by hand is how a manifest and the prompt that describes it
 * start to disagree.
 */
export type PluginSidecarKind = "executable" | "node";

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
    /**
     * `app.game.story` — register a compile pass that observes each scene and injects engine
     * actions around its rows.
     *
     * The heaviest of the ten to read, and the one whose weight is easiest to miss: nothing here
     * touches the player's files, and the author still sees only their own document — but a pass
     * runs over *every* scene of the project, sees who speaks in each, and can put actions around
     * lines it did not write. That is a plugin editing the story, at the last moment before it
     * plays, and it is worth a name the author approves at install.
     *
     * It is not `state.write` in disguise and does not imply it: a pass builds actions, it does not
     * run them, and the one piece of runtime state it can touch is a scene-local flag the compiler
     * creates and owns (`SceneCompileContext.runtimeFlag`), never a story variable the author
     * declared.
     */
    StoryCompile: "story.compile",
} as const;

export type PluginRuntimeCapability = typeof PluginRuntimeCapability[keyof typeof PluginRuntimeCapability];

export const PLUGIN_RUNTIME_CAPABILITIES: readonly PluginRuntimeCapability[] =
    Object.values(PluginRuntimeCapability);

/**
 * The capabilities that can name a story scene, and so decide what a variant's package must keep.
 *
 * **Empty, and that is a reading of the nine above rather than an omission.** Go through them: a
 * store holds the plugin's own keys, events observe what the game already did, state reads and
 * writes story variables, saves list and load slots the game itself compiled, an overlay draws on
 * top, assets resolve packaged URLs, and locale reads the language. None of them takes a scene, and
 * none of them starts one.
 *
 * This replaced "does the package carry any plugin at all", which was the whole feature's undoing:
 * the built-in Gallery ships in every package and declares `store` + `events`, so every project had
 * a plugin and no project could ever drop a scene. A test that is true everywhere decides nothing.
 *
 * **The honest gap, which is not closed by this and would not be closed by blocking every plugin.**
 * These are *declared* capabilities, not enforced ones. A plugin also contributes blueprint nodes,
 * and a contributed node executes with the host API in reach - so a determined plugin can still
 * reach past what its manifest says. Refusing every plugin would not fix that (the node would still
 * run); it would only make a demo impossible for every project that ships the built-ins, which is
 * every project. So the declaration is what the build acts on, and the gap is written down here
 * rather than papered over. Closing it means enforcing the boundary at the host API, not widening
 * this list.
 */
export const STORY_STARTING_RUNTIME_CAPABILITIES: readonly PluginRuntimeCapability[] = [];

/** Whether a plugin's declared capabilities let it start a story. See the list above. */
export function runtimeCapabilitiesCanStartStory(
    capabilities: readonly PluginRuntimeCapability[] | undefined,
): boolean {
    return (capabilities ?? []).some(capability => STORY_STARTING_RUNTIME_CAPABILITIES.includes(capability));
}

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
