/**
 * The story compile-pass extension point: the types a plugin codes against, and the registry the
 * compiler reads.
 *
 * A runtime plugin registers a pass through `app.game.story.registerCompilePass`. While a story
 * compiles, the compiler runs every registered pass once per scene and hands it a
 * {@link SceneCompileContext}: the scene's rows in execution order, and the means to attach engine
 * actions around them. That is how a plugin implements behaviour which is *derived from* the scene
 * and cross-cutting over it - dimming every non-speaker on each line - without writing a single row
 * into the document.
 *
 * # Why the context is this small
 *
 * Six methods, and every one of them is here because a real plugin needs it. An earlier version of
 * this file was written the other way round - guessing at what a pass might want - and it was
 * withdrawn precisely for that: nothing had ever driven it, so nothing had ever shown which half of
 * it was wrong. What survives is what NarraLeaf's Auto-Highlight actually calls, and the shape it
 * needs each call to have.
 *
 * # Why the plugin never sees the engine
 *
 * {@link EngineAction} is opaque, and every primitive a pass needs is a method on the context. The
 * plugin says "darken this character", "fan these out in parallel", "run these only while my flag is
 * set" - and the compiler decides what that means in NarraLeaf-React. Two of those decisions are
 * load-bearing and neither belongs in a plugin:
 *
 *  - **Parallel means `Control.allAsync`, never `doAsync`.** A `doAsync` group joins the action
 *    history across the `say` that follows it, and an undo then tears the two apart (the engine's
 *    own `controlAsyncUndoOrdering` test is what pins this down). A pass that reached for the engine
 *    directly would get this wrong once and produce a bug no author could diagnose.
 *  - **A flag write carries an undo cleaner.** Without one the write never enters the action
 *    history, so rewinding past it leaves the flag set and every later guard takes the wrong branch
 *    - a save that plays differently the second time.
 *
 * # Where it may live
 *
 * Under `@/lib/ui-editor/` so the standalone game runtime bundle includes it (see
 * `project/build/build-runtime.js` allowedPrefixes), and re-exported through
 * `narraleaf-studio/runtime` by the plugin-types build.
 */

/**
 * An opaque compiled engine action. A pass receives these from the context and gives them back to
 * it; there is deliberately nothing a plugin can do with one in between.
 */
export type EngineAction = { readonly __nlsEngineAction: unique symbol };

/** A character's stage image, narrowed to what a pass can ask of it. */
export interface StageImage {
    /**
     * Drive the image's darkness: 0 is untouched, 1 is black. `easing` is a NarraLeaf-React easing
     * name; an unknown one falls back to the engine's default rather than failing the compile.
     */
    darken(darkness: number, durationMs: number, easing: string): EngineAction;
    /**
     * Raise the image to the front within its own layer. Instant, and takes no duration.
     *
     * The second method here, and it arrives under this file's own rule: what survives is what a pass
     * actually calls. Auto-Highlight is the caller - it dims the rest of the cast and brings the
     * speaker forward, and without this it could only do the first half.
     *
     * An engine that predates the call returns an action that does nothing and reports a diagnostic
     * against the row, so a pass never has to ask which engine it is compiling against.
     */
    bringToFront(): EngineAction;
}

/**
 * A boolean in the scene's own local storage, reset when the scene is entered.
 *
 * Deliberately write-only from the plugin's side. Reading it is not something a pass can do - the
 * pass runs at compile time and the value only exists while the game plays - so the read half is
 * spelled as {@link SceneCompileContext.guarded}, which builds the runtime predicate for you. An
 * interface with a `read()` returning a function would have suggested otherwise.
 */
export interface RuntimeFlag {
    /** An action that sets the flag. Undoable: the compiler attaches the cleaner. */
    write(value: boolean): EngineAction;
}

/**
 * One row of a scene, in execution order, classified down to what a pass can act on.
 *
 * A deliberately coarse vocabulary: four kinds, not the twenty-odd payloads the document has. A pass
 * is asking "who speaks here, and where does that change" - and every row that answers neither
 * question is `other`, so a payload added to the document later does not silently become a new case
 * every existing pass forgot to handle.
 */
export type CompileBlockView =
    /** A spoken line. `speaker` is the character's stage object name, or null for narration. */
    | { kind: "dialogue"; id: string; speaker: string | null }
    /** A `{action:"plugin"}` marker. `pluginId` lets a pass ignore markers that are not its own. */
    | { kind: "pluginAction"; id: string; pluginId: string; actionId: string; params: Record<string, unknown> }
    /** Any other row: a background, a wait, a character entering, another plugin's marker. */
    | { kind: "other"; id: string }
    /**
     * A control-flow edge - a branch, a jump, a choice. Not a row a pass acts on, but a place where
     * "what happens next" stops being knowable from the text, which is exactly what a pass reasoning
     * about runs of dialogue has to see.
     */
    | { kind: "boundary"; id: string };

/** What a pass attaches around one row. */
export interface BlockInjection {
    before?: EngineAction[];
    after?: EngineAction[];
}

/** The per-scene context handed to a compile pass. */
export interface SceneCompileContext {
    /**
     * The scene's rows in execution order, with containers flattened and their edges marked
     * `boundary`. Disabled rows are absent: they do not run, so they are not part of the order a
     * pass is reasoning about.
     */
    readonly blocks: readonly CompileBlockView[];
    /**
     * Every character stage object name that appears anywhere in this scene.
     *
     * Static, from the document - there is no such thing as "who is on stage right now" at compile
     * time. For the darkening case that is not a limitation: darkening a character who has not
     * entered is invisible, so a pass can address the whole cast and let the stage sort it out.
     */
    roster(): string[];
    /** The stage image behind a roster name, or null when the scene never mentions it. */
    resolveCharacterImage(objectName: string): StageImage | null;
    /** Fan actions out in parallel without blocking the row they hang off. See the header note. */
    parallel(actions: EngineAction[]): EngineAction;
    /** Actions that run only while `flag` reads true. */
    guarded(flag: RuntimeFlag, actions: EngineAction[]): EngineAction;
    /** A scene-local flag, created on first use and looked up by name after that. */
    runtimeFlag(name: string): RuntimeFlag;
    /**
     * Attach actions around the row with this id (an id from {@link blocks}).
     *
     * Additive: calling it twice for one row appends rather than replaces, so a pass can build a
     * row's injection in more than one place without tracking what it has already said.
     */
    inject(blockId: string, injection: BlockInjection): void;
}

export interface StoryCompilePass {
    /** Namespaced by the owning plugin id, like every other contributed identifier. */
    id: string;
    /** Called once per scene, before that scene's rows are compiled. */
    scene(ctx: SceneCompileContext): void;
}

// --- registry -----------------------------------------------------------------------------------
//
// A module singleton, which is the right shape here for a reason particular to this surface: game
// environments load their plugins once per process and there is no unload lifecycle to hang a
// registry off (see `RuntimePluginSetup`, which has no cleanup return for the same reason).

const registered: Array<{ pass: StoryCompilePass; owner: string }> = [];

/**
 * Register a compile pass on behalf of `owner`.
 *
 * A duplicate id is ignored rather than replacing the pass or throwing: a host may run plugin setup
 * more than once (React StrictMode does exactly this in development), and neither "two copies of the
 * same pass injecting everything twice" nor "the dev build crashes where the packaged one does not"
 * is an acceptable answer to that.
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

/** The plugin that registered a pass, for attributing a diagnostic to it. */
export function getStoryCompilePassOwner(passId: string): string | null {
    return registered.find(entry => entry.pass.id === passId)?.owner ?? null;
}

/** Drop every registered pass. For tests; a production runtime plugin never unregisters. */
export function clearStoryCompilePasses(): void {
    registered.length = 0;
}
