/**
 * Which service stores are the author's project and which are Studio's own state.
 *
 * `editor/services/<namespace>.json` is one flat directory holding two unrelated
 * kinds of file. The author's cast lives there, and so does the dock layout. That
 * mattered the moment version control arrived: freezing the workspace froze the
 * panel layout too, so merely opening a tab right after freezing raised "Nothing is
 * being saved right now" before the author had done anything - measured in the real
 * app, see plan 2026-07-28-002 §4.1. Editor state is not project state, and the fix
 * is to stop storing it in the versioned tree, not to carve exceptions into the
 * freeze latch.
 *
 * So this table decides one thing: the directory a store is read from and written
 * to. `studio` routes to `.nlstudio/services/`, which
 * {@link import("./workingSet").isVersioned} already excludes; `project` stays in
 * `editor/services/`, under version control. Nothing else about the working-set
 * policy changes - `workingSet.ts` is still the only source of truth for what the
 * repository stores, and this table only picks which side of it a store lands on.
 * (Its comment already claimed `.nlstudio/` held the editor layout; this is what
 * makes that true.)
 *
 * **The default is project content**, including for plugin stores, and it is not a
 * neutral default. Over-classifying a store as project content costs an author a
 * frozen preference and some noise in a change list, all of it recoverable.
 * Under-classifying one takes something the author made out of version control,
 * where it can no longer be restored from any revision - which is the data loss this
 * whole milestone exists to prevent. When in doubt a store stays in the versioned
 * tree. A new store is therefore classified by *adding* it here, and only to make it
 * Studio state.
 *
 * **Shared rather than renderer-only** for the reason `workingSet.ts` gives: the
 * renderer owns the read/write path, but three main-process readers reach straight
 * into `editor/services/character.json` (the Dev Mode bundler, the pack compiler's
 * plugin runtime data, the preview manager). Reclassifying a store they read would
 * silently empty them, so the classification has to be visible from both sides.
 */

/** `studio` -> `.nlstudio/services/` (not versioned). `project` -> `editor/services/` (versioned). */
export type ServiceStoreLocation = "studio" | "project";

/**
 * The classification, whole.
 *
 * Every core store Studio writes is listed, including the ones the default would
 * already have covered, because a table a reader has to cross-reference against four
 * services is not a table anyone will read. Plugin stores (`plugin__<id>__<ns>`) are
 * deliberately absent: they are a game capability's content - the Gallery's catalog
 * is inlined into the shipped bundle by `pluginRuntimeData.ts` - and there is no
 * fixed set of them to enumerate, so they take the default.
 */
export const SERVICE_STORE_LOCATIONS = {
    /** Dock layout and open tabs: the shape of Studio's window, not of the game. */
    panel_state: "studio",
    /** Toast history - a log of what Studio said to this author, on this machine. */
    notification_history: "studio",
    /** The colour picker's recently-used list: a tool remembering the last few clicks. */
    recent_colors: "studio",
    /**
     * The project's characters - profiles, appearances, groups. Content the author
     * wrote, and the single largest thing in `editor/services/`. Moving it would take
     * the cast out of version control, which is the exact failure the default above is
     * written to avoid; it is listed rather than left implicit so that is on the page.
     */
    character: "project",
} as const satisfies Record<string, ServiceStoreLocation>;

/**
 * The namespaces this table calls Studio state.
 *
 * Annotating a service's namespace constant with this type is what keeps the owning
 * service and the table from drifting: renaming `panel_state` without touching the
 * table would otherwise fall through to the project-content default and quietly put
 * the panel layout back in the versioned tree - the bug this file exists to fix,
 * recurring with nothing to notice it.
 */
export type StudioStateStoreNamespace = {
    [K in keyof typeof SERVICE_STORE_LOCATIONS]:
        (typeof SERVICE_STORE_LOCATIONS)[K] extends "studio" ? K : never;
}[keyof typeof SERVICE_STORE_LOCATIONS];

/** Where one store namespace belongs. Unlisted namespaces are project content. */
export function serviceStoreLocation(namespace: string): ServiceStoreLocation {
    const table: Record<string, ServiceStoreLocation | undefined> = SERVICE_STORE_LOCATIONS;
    return table[namespace] ?? "project";
}

/** Whether a store is Studio's own state, i.e. lives outside the versioned tree. */
export function isStudioStateStore(namespace: string): boolean {
    return serviceStoreLocation(namespace) === "studio";
}
