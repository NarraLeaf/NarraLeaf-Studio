/**
 * What a script blueprint is handed when it runs: the `ctx` of each of the three tiers.
 *
 * A script blueprint is the TypeScript frontend of the same slot a visual graph fills. It does not
 * get a capability surface of its own; it gets the one the slot already has, because the runtime
 * that serves the slot is the same either way. So nothing here is designed. Every member is the
 * type of something an adapter already hands a graph, taken verbatim, and the file's job is to say
 * which adapter serves which tier and to put a name on the parts of the execution context that a
 * graph reads through its nodes.
 *
 * # Three tiers, by contract
 *
 * The tier follows from `blueprintContract(owner).invocation` and nothing else:
 *
 *  - `uiEvent`      -> {@link GameScriptContext}. The whole host API, the surface-bound extras
 *                      that live on the adapter beside it, and per-drawing locals.
 *  - `storyCall`    -> {@link StoryScriptContext}. What `buildStoryActionHostAdapter` gives a story
 *                      row: the story's own variable stores and app persistence. No navigation, no
 *                      game, no widget, no sound - a row that navigated would be a second way to
 *                      leave a scene. The synchronous modes (`value`, `condition`) get
 *                      {@link StorySyncScriptContext}, which drops the one asynchronous member.
 *  - `valueBinding` -> {@link ValueScriptContext}. The reads the value runtime can re-run every
 *                      time a dependency changes, and nothing that writes.
 *
 * # Where the anchor goes
 *
 * The anchor - project, surface, element, component element, story row - does not change which
 * host serves the script, so it does not change the tier. It changes what the script is *about*,
 * and that is {@link ScriptSelf}: the drawing this run belongs to, with the list row and component
 * params it was drawn with. The few adapter members that only exist for surface-bound owners
 * (`broadcast`, the surface transition readers) are typed against the self, so a project script
 * sees them as `undefined` rather than as a method that throws.
 *
 * # Smallest surface first
 *
 * Where the draft had a choice, it chose the smaller surface. Adding a member later costs an
 * author nothing; removing one is the rework this file exists to avoid.
 */

import type { LiteralValue } from "@shared/types/blueprint/document";
import type { StoryLiteralValue } from "@shared/types/story";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { BlueprintHostApiRuntime } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { StoryVariableRuntimeAccess, UIHostAdapterBlueprintRuntime } from "@/lib/ui-editor/runtime/types";

// ---------------------------------------------------------------------------
// Self: which drawing this run belongs to
// ---------------------------------------------------------------------------

/**
 * The widget types an element script can be written for: every built-in type whose logic table
 * says it supports a private blueprint. Held to that table by `scriptContext.test.ts`.
 *
 * A list rather than `string` because the events a widget script may export follow from its type,
 * and the generated half of the declarations (the project's own element ids) narrows further.
 */
export const SCRIPT_WIDGET_TYPES = [
    "nl.container",
    "nl.text",
    "nl.image",
    "nl.video",
    "nl.puppet",
    "nl.button",
    "nl.textInput",
    "nl.slider",
    "nl.switch",
    "nl.list",
    "nl.frame",
    "nl.dialog.sentence",
    "nl.notification.list",
    "nl.choice.list",
    "nl.nvl.list",
    "nl.nvl.texts",
] as const;

export type ScriptWidgetType = (typeof SCRIPT_WIDGET_TYPES)[number];

/**
 * The list row this drawing was drawn for, when it was drawn by a list.
 *
 * The same record the graph's `Get List Item` family reads (`ctx.listItemScope`), minus the list's
 * declared item shape, which the generated declarations carry instead.
 */
export type ScriptListRow = Pick<UIListItemScope, "item" | "index" | "count" | "key" | "selected">;

/**
 * Where the running script lives, and what it was drawn with.
 *
 * Mirrors `BlueprintAnchor` position for position, carrying the runtime facts a graph reads off
 * `ctx.executionOwner`, `ctx.listItemScope` and `ctx.instanceKey`:
 *
 *  - an element is one *drawing* of its record - a list draws it once per row, a component once per
 *    placement - and `row` says which row this is, or `null` when nothing drew it per row;
 *  - a component element carries the placement's resolved `params`, by param id, which is what
 *    `Get Component Param` reads.
 *
 * `elementId` is the element's own id, never the drawing address the runtime keys widget writes by.
 * A script addresses widgets by element id and the runtime binds the drawing, exactly as the
 * widget nodes do through `buildUIWidgetAddress`.
 */
export type ScriptSelf =
    | { kind: "project" }
    | { kind: "surface"; surfaceId: string }
    | {
          kind: "element";
          surfaceId: string;
          elementId: string;
          widgetType: ScriptWidgetType;
          row: ScriptListRow | null;
      }
    | {
          kind: "componentElement";
          componentId: string;
          elementId: string;
          widgetType: ScriptWidgetType;
          params: Readonly<Record<string, string>>;
          row: ScriptListRow | null;
      };

export type ScriptElementSelf = Extract<ScriptSelf, { kind: "element" | "componentElement" }>;

// ---------------------------------------------------------------------------
// Game tier: uiEvent invocation
// ---------------------------------------------------------------------------

/**
 * Sending broadcasts, and asking who is listening.
 *
 * On the adapter rather than in the host API (`dispatchBroadcastEvent`, `getBroadcastListenerCount`),
 * which is why it is a member of its own here. The sender is this script's element, filled in by
 * the runtime the way `Send Broadcast` fills it from `executionOwner`.
 */
export type ScriptBroadcast = {
    send: (event: string, data?: unknown) => Promise<void>;
    listenerCount: NonNullable<UIHostAdapterBlueprintRuntime["getBroadcastListenerCount"]>;
};

/**
 * Whether the surface this script is on is animating in or out.
 *
 * The three readers `Is Surface Entering` / `Exiting` / `Transitioning` expose, off the adapter's
 * one `getSurfaceTransitionState`.
 */
export type ScriptSurfaceTransition = {
    isEntering: () => boolean;
    isExiting: () => boolean;
    isTransitioning: () => boolean;
};

/**
 * Members that exist only for a script on a surface or on one of its elements.
 *
 * Distributive on purpose: a handler typed against the whole {@link ScriptSelf} union sees
 * `T | undefined` and has to check, which is the honest answer for a script that does not know
 * where it was placed.
 */
type SurfaceBound<Self extends ScriptSelf, T> = Self extends { kind: "surface" | "element" } ? T : undefined;

/**
 * The context of a UI event handler: everything a graph on the same slot could reach.
 *
 * `host` is the blueprint host API verbatim - all sixteen families, each method honest about what
 * the host cannot do (it throws, or answers false, the way the nodes report it). It is the same
 * object for every self, including a component definition's: the visual palette keeps page and
 * frame nodes out of a definition's graph, but that is a palette decision with no runtime guard
 * behind it, and a type that hid what the runtime will serve would be lying in the other direction.
 *
 * `vars` is this drawing's own store, with the lifetime a graph `Var` has: one per drawing, dropped
 * when the widget unmounts. A module-level `let` is one per *module*, shared by every row of a list
 * and every placement of a component, which is the wrong answer for almost everything a widget
 * script wants to remember. `stopPropagation` is the graph's `eventControl`: on a pointer event it
 * keeps the parent from hearing it, on `windowCloseRequested` it is `Keep Window Open`.
 */
export type GameScriptContext<Self extends ScriptSelf = ScriptSelf> = {
    self: Self;
    host: BlueprintHostApiRuntime;
    broadcast: SurfaceBound<Self, ScriptBroadcast>;
    surface: SurfaceBound<Self, ScriptSurfaceTransition>;
    vars: Record<string, unknown>;
    signal: AbortSignal;
    stopPropagation: () => void;
};

// ---------------------------------------------------------------------------
// Story tier: storyCall invocation
// ---------------------------------------------------------------------------

export type StoryScriptSelf = { kind: "storyRow" };

/**
 * The synchronous half of a story row's context, and the whole of it for `value` and `condition`.
 *
 * `scene` and `saved` are the adapter's own access pair, by variable id. Both may be written from a
 * synchronous mode, as `Set Scene Var` and `Set Saved Var` may be placed in one: the sync rule
 * forbids waiting, not writing.
 */
export type StorySyncScriptContext = {
    self: StoryScriptSelf;
    scene: StoryVariableRuntimeAccess;
    saved: StoryVariableRuntimeAccess;
    /**
     * Log a line where the author is already looking: Dev Mode's Output panel, beside the lines a
     * `Log` node writes.
     *
     * The one member of the host API a story row reaches, and it is here rather than under a `host`
     * because this tier has no `host`: a row's context is a short flat list of what it may touch,
     * and adding a namespace holding a single member would ask an author to learn one for nothing.
     */
    devtools: BlueprintHostApiRuntime["devtools"];
};

/**
 * A story action's context.
 *
 * `persistent` is keyed by persistent-variable id, the way `Get Persistent` is: the runtime looks
 * the storage key up in the project's variable table before it reaches the app persistence bridge,
 * and refuses a value that cannot be serialised, as the bridge does. Its two calls are asynchronous,
 * which is the whole reason the synchronous modes above do not have it - the graph's `Get
 * Persistent` is a latent node, and a value rendered inline cannot wait.
 */
export type StoryScriptContext = StorySyncScriptContext & {
    persistent: BlueprintHostApiRuntime["persistence"];
    signal: AbortSignal;
};

// ---------------------------------------------------------------------------
// Value tier: valueBinding invocation
// ---------------------------------------------------------------------------

/**
 * The host API reads a value script may make, by family.
 *
 * A value binding is re-run every time something it read changes, so it may only do what is safe
 * to do again: read. The visual graph enforces that with a node whitelist reviewed by hand; this
 * is the same review expressed as member names, and `scriptContext.test.ts` holds it to two
 * things - every member is synchronous, and every member the frozen contract knows is one the
 * contract marks `callableFromBinding`. A member the contract does not know (six families were
 * added after it stopped being extended) is admitted on the first ground alone.
 *
 * What a read through `widget` does that a read from a module-level closure does not: the runtime
 * records it as a dependency of the binding, so the binding re-runs when that property changes.
 * That is the graph's `trackDependency`, and the reason these reads go through `host` rather than
 * through anything a script could reach on its own.
 */
export const VALUE_SCRIPT_READS = {
    navigation: ["getPageProps"],
    layers: ["isMounted"],
    widget: [
        "getCommonProperties",
        "getTextProperties",
        "getButtonProperties",
        "getContainerProperties",
        "getImageProperties",
        "getSliderProperties",
        "getSwitchProperties",
        "getTextInputProperties",
        "getListProperties",
        "getDisplayableProperties",
        "getMeasuredRect",
        "getFrameProperties",
    ],
    state: ["get"],
    frame: ["getParam"],
    game: [
        "isInGame",
        "isGameOverlay",
        "getPlaytime",
        "getTotalPlaytime",
        "getNametag",
        "getSpeakerAvatar",
        "getSpeakerColor",
        "isDialogWaiting",
        "getDialogText",
        "isNarrator",
        "getCharacter",
        "getNotifications",
        "getChoiceCount",
        "isNvlMode",
        "isCurrentTextRead",
        "isTextRead",
        "isSceneVisited",
        "getSavedVariable",
        "isOptionPicked",
        "isEndingReached",
        "isDlcInstalled",
        "listEndings",
        "canUndoHistory",
        "canRedoHistory",
        "getPreference",
    ],
    sound: ["resolveElementVolume", "getTrackVolume"],
    localization: ["getConfig"],
    voice: ["listLocales"],
    input: ["isActionHeld", "getDevice"],
} as const satisfies { [F in keyof BlueprintHostApiRuntime]?: readonly (keyof BlueprintHostApiRuntime[F])[] };

/**
 * The `Extract` is for the compiler, not for safety: the `satisfies` clause above already refuses
 * a name that is not a member of its family, so nothing is silently dropped here.
 */
export type ValueScriptHost = {
    [F in keyof typeof VALUE_SCRIPT_READS]: Pick<
        BlueprintHostApiRuntime[F],
        Extract<(typeof VALUE_SCRIPT_READS)[F][number], keyof BlueprintHostApiRuntime[F]>
    >;
};

/** A value binding hangs off an element on a surface; a component definition has no bindings. */
export type ValueScriptSelf = Extract<ScriptSelf, { kind: "element" }>;

/**
 * The context of a value script: reads, this drawing's locals, and nothing that waits.
 *
 * `vars` is here because a value graph may use `Get Var` / `Set Var` and `Memo` - a synchronous
 * effect on the blueprint's own locals - and a script that memoises across re-runs wants the same.
 */
export type ValueScriptContext = {
    self: ValueScriptSelf;
    host: ValueScriptHost;
    surface: ScriptSurfaceTransition;
    vars: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Handlers: what each tier's entry point returns
// ---------------------------------------------------------------------------

/** A story action's return is ignored, as the `action` mode ignores a Return Value. */
export type StoryActionHandler = (ctx: StoryScriptContext) => void | Promise<void>;

/**
 * A story value is rendered inline in the same tick as the word that shows it.
 *
 * The return type is a concrete literal rather than `unknown` on purpose: an `async` handler
 * returns a `Promise`, and a `Promise` is not a {@link StoryLiteralValue}, so declaring one is a
 * type error where the graph's `isSyncOnlyGraph` would refuse a latent node.
 */
export type StoryValueHandler = (ctx: StorySyncScriptContext) => StoryLiteralValue;

/** A condition is tested each time its branch is reached, and coerced with `Boolean(...)`. */
export type StoryConditionHandler = (ctx: StorySyncScriptContext) => boolean;

/** A value binding's provider. Same ground for the concrete return type as {@link StoryValueHandler}. */
export type ValueHandler = (ctx: ValueScriptContext) => LiteralValue;
