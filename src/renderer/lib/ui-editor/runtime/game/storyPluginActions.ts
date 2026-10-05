/**
 * Plugin story actions, game side: what runs when the story reaches a row a plugin's story action
 * inserted.
 *
 * A plugin's studio entry registers the action the author picks from the scene editor
 * (`app.services.story.actions`); its `createBlock` writes a `{action:"plugin"}` row carrying the
 * plugin id, the action id and the params. Its runtime entry registers the other half here, under the
 * same action id, through `app.game.storyActions.register`. The story compiler looks the row's action
 * up when it compiles the scene and turns it into an awaited engine action (`storyAwaitedAction.ts`):
 * the story stops on the row until `run` settles.
 *
 * A row with no runner - the plugin is missing, disabled, or only reads its rows from a compile pass
 * the way Auto-Highlight does - compiles to nothing, exactly as a marker row always has.
 *
 * Under `@/lib/ui-editor/` so the standalone game runtime bundle includes it, and re-exported through
 * `narraleaf-studio/runtime` by the plugin-types build.
 */

import type { RuntimePluginGame } from "../plugins/runtimePluginApi";

/** What a plugin story action's `run` receives. */
export type RuntimeStoryActionContext = {
    /** The params the row carries: whatever the studio entry's `createBlock` wrote. */
    params: Record<string, unknown>;
    /**
     * Aborted when the row is cancelled: the player rolls back past it, or loads a save, while it is
     * still running. Tear down whatever `run` put on screen and stop; nothing it does after this
     * reaches the story.
     */
    signal: AbortSignal;
    /** The very same object `setup(app)` received as `app.game`. */
    game: RuntimePluginGame;
};

/**
 * The game-side half of a plugin story action.
 *
 * `run` may be async, and the story waits for it: the next row starts once the promise settles. A
 * save taken while it runs replays the row on load, so `run` must be able to start again from
 * nothing. A throw is logged and the story carries on.
 */
export type RuntimeStoryActionDef = {
    /** The same id the studio entry registered the action under, prefixed with the plugin id. */
    id: string;
    run(ctx: RuntimeStoryActionContext): void | Promise<void>;
};

type RegisteredStoryAction = {
    def: RuntimeStoryActionDef;
    owner: string;
    game: RuntimePluginGame;
};

// A module singleton for the same reason the compile-pass registry is one: a game environment loads
// its plugins once per process and never unloads them, so there is no lifecycle to hang it off.
const registered = new Map<string, RegisteredStoryAction>();

/**
 * Register the runner for one story action on behalf of `owner`, which hands `game` to every run.
 *
 * Re-registering an id its owner already holds replaces the runner (a host may run setup twice -
 * React StrictMode does in development); an id another plugin holds is refused by the caller before
 * it gets here.
 */
export function registerStoryPluginAction(def: RuntimeStoryActionDef, owner: string, game: RuntimePluginGame): void {
    registered.set(def.id, { def, owner, game });
}

/** The plugin that registered an action id, or null when none did. */
export function getStoryPluginActionOwner(actionId: string): string | null {
    return registered.get(actionId)?.owner ?? null;
}

/** The registration behind an action id, or undefined when no runtime entry registered it. */
export function getStoryPluginAction(actionId: string): RegisteredStoryAction | undefined {
    return registered.get(actionId);
}

/** Drop every registered action. For tests; a production runtime never unregisters. */
export function clearStoryPluginActions(): void {
    registered.clear();
}
