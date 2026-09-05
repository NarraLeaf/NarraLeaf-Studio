/**
 * One place where a game's blueprint host API is assembled, for every surface that gets one.
 *
 * ## The defect this exists to make unspellable
 *
 * Three surfaces build a host API from `createDevModeBlueprintHostApi`: a top-level page, a page
 * inside an `nl.frame`, and a Game UI slot (the dialogue box, the choice list, notifications, NVL,
 * the on-stage layer). Every one of that bridge's hundred-odd options is optional, because a host
 * really can lack a window or a filesystem and the nodes report that honestly. So an option left
 * off one of the three builds is indistinguishable, to types and to the nodes, from a host that
 * cannot do the thing: the node answers `false`, `{found:false}` or an empty list, with no throw
 * and no diagnostic, and the author sees a control that never lights up.
 *
 * That went wrong five times, always the same way - the three builds were three hand-written lists
 * of the same hundred keys, and one of them was short. Sound first, then progress, then the saved
 * variables, then a batch of twenty-five, then `voiceConfig`, whose absence made
 * `voice.listLocales()` answer empty and every voice node raise "This project has no voice
 * languages configured" - an error blaming the author's project for a field a host had not passed.
 *
 * So there are no longer three lists. There is {@link GameHostCapabilities}, which every option
 * shared by the three surfaces belongs to, and {@link GameHostSurfaceBinding}, which is what one
 * surface answers for itself. {@link buildGameHostApiOptions} joins them, and it is the only thing
 * that writes a bridge options object for a game.
 *
 * ## Why the shared half is derived rather than written out
 *
 * `GameHostCapabilities` is not a list of names someone maintains; it is *every* key of
 * `CreateBlueprintHostApiRuntimeOptions` minus the two exclusion sets below, each key made
 * mandatory to write. Three consequences, and they are the point:
 *
 *  - dropping a key from a host is a compile error rather than a dead node;
 *  - adding an option to the bridge is a compile error at every host until each one has answered
 *    for it, rather than a capability that quietly works on pages and not in a dialogue box;
 *  - a host that genuinely cannot do a thing writes `undefined` and is *seen* to, instead of
 *    leaving the key out and being indistinguishable from a host that forgot.
 *
 * The last one is why the mapped type re-keys through `as K`: that makes it non-homomorphic, so
 * the optional modifiers of the bridge's own fields are not carried over and every key has to be
 * named. The value type still admits `undefined`, which is what keeps "cannot" expressible.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
    CreateBlueprintHostApiRuntimeOptions,
    DevModeWidgetRuntimePatch,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { applyWidgetRuntimePatch, type WidgetPatchesByScope } from "./widgetRuntimePatches";
import type { PageProps } from "./types";

/**
 * A bridge option name, checked against the bridge.
 *
 * The two exclusion sets below are written as names, and a name that no longer exists would
 * silently widen `GameHostCapabilities` by excluding nothing - the way an allowlist outlives the
 * thing it excused. Passing them through here makes a rename a compile error instead.
 */
type BridgeOptionKey<K extends keyof CreateBlueprintHostApiRuntimeOptions> = K;

/**
 * The options a surface answers for itself, so they are not part of the shared set.
 *
 * Every one of them is either the runtime this drawing runs in, a fact about *which* surface it
 * is, plumbing that has to point back at this host's own adapter, or - in the case of
 * `onStartStory` - a capability a slot surface's shell is handed along with the rest of its
 * bindings, so it travels with the binding rather than with the capability set. All three hosts
 * now put the same thing in it: the boot gate (see `createStoryStartGate`), which is what stops a
 * Start Game pressed while the story is still compiling from racing the boot that is compiling it.
 * {@link buildGameHostApiOptions} sets all of them from a {@link GameHostSurfaceBinding},
 * unconditionally, so none of them can go missing either.
 *
 * The runtime trio - `document`, `scope`, `emit` - is here rather than among the capabilities for a
 * reason that is not about surfaces: a host can exist before its blueprint runtime core does (the
 * scene editor's story preview builds one for a bundle it has not compiled yet), and every site
 * that builds a host API already has to answer for that core being absent. Capabilities are what a
 * game *can do* and are known before it runs; these three are where a particular drawing runs.
 */
type SurfaceBoundOptionKey = BridgeOptionKey<
    | "document"
    | "scope"
    | "emit"
    | "activeSurfaceId"
    | "runtimeScopeId"
    | "pageProps"
    | "onIsGameOverlay"
    | "onStartStory"
    | "onWidgetPatch"
    | "onElementFlush"
    | "initialWidgetPatches"
    | "frameParams"
    | "onFrameEmit"
>;

/**
 * Bridge options that are not a game host's to answer, and why.
 *
 * Unlike the set above these are not set by the builder either, so the bridge falls back to what it
 * does when nobody passes them - which is the behaviour every game has always had. Anything added
 * here needs that shape of reason, not "no host needs it yet": a capability nobody has got round to
 * wiring belongs in `GameHostCapabilities` as an explicit `undefined`, where it is visible.
 */
type NotAGameHostOptionKey = BridgeOptionKey<
    // The component-blueprint editor's own flag: it changes how a graph resolves its element
    // references while a component definition is being edited, and no running game edits one.
    | "componentDefinitionMode"
    // The three dialog-state readers. The bridge answers all of them out of the mirrored game
    // state a running session writes into the scope store, which is why no host passes them and
    // why passing them from one host and not another would make the same node answer differently
    // on two surfaces of one game.
    | "onGetCharacter"
    | "onGetSpeakerColor"
    | "onGetSpeakerAvatar"
>;

type SharedOptionKey = Exclude<
    keyof CreateBlueprintHostApiRuntimeOptions,
    SurfaceBoundOptionKey | NotAGameHostOptionKey
>;

/**
 * Everything the blueprint nodes can ask of a game, as one value.
 *
 * Built once by whoever owns the game - `GameApp` for a real session, the story preview for the
 * scene editor's - and handed to every surface of it unchanged. Every key is mandatory to write;
 * see the file comment for why, and write `undefined` for a capability this host does not have.
 */
export type GameHostCapabilities = {
    [K in SharedOptionKey as K]: CreateBlueprintHostApiRuntimeOptions[K];
};

/**
 * What one surface of that game answers for itself.
 *
 * Small on purpose: it is the whole of what the three hosts legitimately differ by, so a reader
 * comparing a page against a dialogue box has ten lines to read rather than a hundred.
 */
export type GameHostSurfaceBinding = {
    /** The compiled interface document this surface is drawn from. */
    document: CreateBlueprintHostApiRuntimeOptions["document"];
    /** The scope store the graphs of this drawing read and write. */
    scope: CreateBlueprintHostApiRuntimeOptions["scope"];
    /** Where a graph's debug events go. */
    emit: CreateBlueprintHostApiRuntimeOptions["emit"];
    /** The surface being drawn. */
    activeSurfaceId: string;
    /** The execution scope this drawing of it runs in. */
    runtimeScopeId: string;
    /** What the surface was opened with: a page's props, a frame's params, nothing for a slot. */
    pageProps: PageProps;
    /**
     * Whether this surface is drawn over a running game.
     *
     * The three answers are three different facts, not three spellings of one: a page knows from
     * how it was pushed, a frame inherits its parent's answer, and a Game UI slot is only ever
     * drawn by a running game, so it is always true.
     */
    isGameOverlay: () => boolean;
    /**
     * The player's way into a story from this surface.
     *
     * Named here rather than shared because the two are not the same callable. A page host is
     * rebuilt every time the runtime's `startStoryInGame` changes and can hold it directly; a Game
     * UI slot keeps whatever it was handed when its session was mounted, so it is given the boot
     * gate, which reads the runtime through a ref at call time and waits out a boot still in
     * flight. Handing either one the other's would change when a Start Game press is served.
     */
    startStory: CreateBlueprintHostApiRuntimeOptions["onStartStory"];
    /**
     * Where the runtime widget patches of every scope live.
     *
     * The same pair at all three hosts, but the writes and the seed are per scope, so the builder
     * needs both this and `runtimeScopeId` to derive `onWidgetPatch` and `initialWidgetPatches`.
     */
    widgetPatches: {
        setByScope: Dispatch<SetStateAction<WidgetPatchesByScope>>;
        byScopeRef: MutableRefObject<WidgetPatchesByScope>;
    };
    /**
     * This host's own blueprint adapter, resolved at dispatch time rather than closed over.
     *
     * A `flush` goes back to the surface it came from, and the adapter that dispatches it is built
     * *after* the host API it is built from - so every host has to read it late, through a ref or a
     * mutable binding it fills in a line later.
     */
    resolveHostAdapter: () => UIHostAdapter | null;
    /**
     * Set only by a page drawn inside an `nl.frame`.
     *
     * The frame's params and the way its page raises an event back at the `nl.frame` element
     * hosting it. Neither can be built without a frame, which is why a top-level surface leaves
     * this unset rather than answering `undefined` twice.
     */
    frame?: {
        params: PageProps;
        emit: (eventName: string, data: unknown) => Promise<void> | void;
    };
};

/**
 * The options for one surface's host API: the game's capabilities, plus what this surface is.
 *
 * The only writer of a bridge options object for a running game. A capability missing from every
 * surface is a compile error in `GameHostCapabilities`; a capability missing from *one* surface is
 * no longer expressible, because no surface states the shared half.
 */
export function buildGameHostApiOptions(
    capabilities: GameHostCapabilities,
    binding: GameHostSurfaceBinding,
): CreateBlueprintHostApiRuntimeOptions {
    const { runtimeScopeId, widgetPatches } = binding;
    return {
        ...capabilities,
        document: binding.document,
        scope: binding.scope,
        emit: binding.emit,
        activeSurfaceId: binding.activeSurfaceId,
        runtimeScopeId,
        pageProps: binding.pageProps,
        onIsGameOverlay: binding.isGameOverlay,
        onStartStory: binding.startStory,
        onWidgetPatch: (elementId: string, patch: DevModeWidgetRuntimePatch) => {
            applyWidgetRuntimePatch({
                setWidgetPatchesByScope: widgetPatches.setByScope,
                widgetPatchesByScopeRef: widgetPatches.byScopeRef,
                runtimeScopeId,
                elementId,
                patch,
            });
        },
        onElementFlush: (elementId, payload) => {
            void binding.resolveHostAdapter()?.blueprintRuntime?.dispatchElementBlueprintEvent(
                elementId,
                "flush",
                payload,
            );
        },
        // What this scope is already showing. A host API rebuilt for a scope that is already drawn
        // has to start from what is on screen: every widget setter writes nothing when the value it
        // is given already matches the drawing, so a rebuild with an empty mirror drops exactly the
        // writes that put an element *back* to its authored value. A Game UI slot is rebuilt
        // mid-scene whenever the engine rekeys its box, and that is how the previous speaker's
        // avatar used to stay on the narration line that replaced them.
        initialWidgetPatches: widgetPatches.byScopeRef.current[runtimeScopeId],
        ...(binding.frame
            ? { frameParams: binding.frame.params, onFrameEmit: binding.frame.emit }
            : {}),
    };
}
