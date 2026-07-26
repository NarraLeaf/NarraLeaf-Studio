/**
 * The story compile-pass extension point: types + the runtime registry.
 *
 * A runtime plugin registers a pass via `app.game.story.registerCompilePass`. During
 * compilation the story compiler runs every registered pass once per scene, handing it a
 * {@link SceneCompileContext} that lets it observe the scene's blocks and inject engine actions
 * around them. This is how a plugin implements behaviour that is cross-cutting and derived from
 * the scene (e.g. dimming every non-speaker on each line) without touching the document.
 *
 * The plugin never sees NarraLeaf-React directly: {@link EngineAction} is opaque, and every
 * primitive it needs (parallel fan-out, a runtime-evaluated guard, resolving a character to its
 * stage image, an undoable scene-local flag) is a method on the context, implemented by the
 * compiler. This keeps engine-correctness concerns — parallel-not-blocking, the flag's undo
 * cleaner — on the Studio side, implemented once.
 *
 * This module must stay under `@/lib/ui-editor/` so the standalone game runtime bundle includes
 * it (see project/build/build-runtime.js), and the plugin-types build re-exports these types
 * through `narraleaf-studio/runtime`.
 */

/** An opaque compiled engine action (an NLR chainable). Plugins only pass these around. */
export type EngineAction = { readonly __nlsEngineAction: unique symbol };

/** A resolved stage character image — the only engine method a pass needs. */
export interface StageImage {
    /** darkness 0 = normal, 1 = black. */
    darken(darkness: number, durationMs: number, easing: string): EngineAction;
}

/**
 * A runtime boolean in scene-local storage (reset on scene entry). `write` produces an action
 * whose undo cleaner restores the previous value — the compiler owns that so a pass cannot get
 * the undo semantics wrong.
 */
export interface RuntimeFlag {
    /** A predicate evaluated at runtime, for use as a guard. */
    read(): () => boolean;
    /** An action that sets the flag, undoable. */
    write(value: boolean): EngineAction;
}

/** One block of a scene, in execution order, classified for a pass. */
export type CompileBlockView =
    /** A dialogue line. `speaker` is the character's stage object name, or null for narration. */
    | { kind: "dialogue"; id: string; speaker: string | null }
    /** A `{action:"plugin"}` marker block. */
    | { kind: "pluginAction"; id: string; pluginId: string; actionId: string; params: Record<string, unknown> }
    /** Any other block (set background, wait, a character enter/exit, another plugin's block, …). */
    | { kind: "other"; id: string }
    /** A control-flow edge (branch enter/exit, jump) — breaks a run. */
    | { kind: "boundary"; id: string };

/** What a pass injects around a block. */
export interface BlockInjection {
    before?: EngineAction[];
    after?: EngineAction[];
}

/** The per-scene context handed to a compile pass. */
export interface SceneCompileContext {
    /** Blocks in execution order; control flow is flattened with `boundary` markers between edges. */
    readonly blocks: readonly CompileBlockView[];
    /** Every character stage object name that appears in this scene. */
    roster(): string[];
    /** Resolve a character stage object name to its Image, or null if it is not in this scene. */
    resolveCharacterImage(objectName: string): StageImage | null;
    /** Fan actions out in parallel without blocking the line (allAsync — never doAsync). */
    parallel(actions: EngineAction[]): EngineAction;
    /** Wrap actions so they run only while `flag` reads true (Condition.If). */
    guarded(flag: RuntimeFlag, actions: EngineAction[]): EngineAction;
    /** A scene-local, undoable runtime flag, created/looked up by name. */
    runtimeFlag(name: string): RuntimeFlag;
    /** Attach injected actions to a block (by its id from `blocks`). */
    inject(blockId: string, injection: BlockInjection): void;
}

export interface StoryCompilePass {
    /** Namespaced by the owning plugin id. Duplicate ids are ignored (last-registered wins nothing). */
    id: string;
    /** Called once per scene, before its blocks are compiled. */
    scene(ctx: SceneCompileContext): void;
}

// --- registry (module singleton; runtime plugins have no unload lifecycle) ---

const registered: Array<{ pass: StoryCompilePass; owner: string }> = [];

/**
 * Register a compile pass. Ignores a duplicate `id` (a runtime host may re-run plugin setup, e.g.
 * under React StrictMode), so registration is idempotent.
 */
export function registerStoryCompilePass(pass: StoryCompilePass, owner: string): void {
    if (registered.some(entry => entry.pass.id === pass.id)) {
        return;
    }
    registered.push({ pass, owner });
}

/** Every registered pass, in registration order. */
export function getStoryCompilePasses(): StoryCompilePass[] {
    return registered.map(entry => entry.pass);
}
