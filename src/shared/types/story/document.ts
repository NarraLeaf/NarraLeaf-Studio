import type { StoryExpression } from "./expression";

export const STORY_LIBRARY_INDEX_SCHEMA_VERSION = 1 as const;
// v4 adds the `invalid` block kind and dialogue's `speakerName`. Both are additive - v3 documents
// load unchanged - but a v3 Studio would silently drop an unresolved command line and render a
// temp-speaker line with no speaker, so the bump makes it refuse the document instead.
// v5 replaces the expression condition's inert `source: string` with a parsed `StoryExpression`, and
// adds `setVariable.expression` / the `expression` interpolation. Only the condition needs migrating
// (the other two are additive); a v4 Studio reading a v5 document would see a condition object it
// cannot evaluate, so the bump makes it refuse rather than test false forever.
// v6: variable declarations became explicit rows. The persisted per-scene/per-document registries
// (`sceneVariables` / `savedVariables`) are gone; a `declaration` block IS the variable, the maps
// are derived by scanning (see `declarations.ts`), and deleting the row deletes the variable. The
// migration synthesizes a declaration block per registry entry, with the block id taking over the
// old `variableId` so every stored ref keeps resolving.
// v7 adds the block-level `disabled` flag (a compiled-out, build-tolerated row — distinct from
// `invalid` and `note`). Purely additive: a v6 document loads with every block enabled, so the
// migration is a no-op version bump. The bump exists only so a v6 Studio refuses a v7 document
// rather than silently compiling a row the author meant to skip.
// v8 adds the `event` rich-text run (a zero-width inline reveal-time event — expression switch
// and/or SE — see `StoryInlineEvent`). Purely additive: a v7 document simply has no event runs, so
// the migration is a no-op version bump. The bump exists only so a v7 Studio refuses a v8 document
// rather than dropping event tokens it does not understand.
// v9 (M-VAR) symmetrizes `StoryVariableRef`: the persistent arm now addresses by `variableId` like
// the scene/saved arms, replacing the old `storageKey`. The migration renames the field on every
// persistent ref with the identical value (a persistent variable's id equals its storage key), so
// old references keep resolving unchanged - `storyVariableRefKey` collapses to `scope:variableId`.
// v10 follows the character appearance rework: a character no longer has forms, so a row can no
// longer name one. `formName` + `variants` become `pose` (a preset character's pose id) or `tags`
// (a layered character's tag per axis). The migration derives the pose id from the old
// `(formName, variantName)` pair with the same deterministic function the character migration used,
// so the two migrations need not run together, or even in the same session. A row whose derived id
// names no pose compiles to a diagnostic — which is the point: the model this replaced answered an
// unresolvable differential with an arbitrary other image.
// v11 is a burned number. It added a `{action:"plugin"}` marker block for plugin compile passes;
// that feature was withdrawn (designed against a Studio that has since moved, and never validated
// by a consumer), but the number stays spent: documents saved while it existed carry
// `schemaVersion: 11`, and `assertSupportedStoryDocument` refuses anything newer than this
// constant. Since v11's migration was a pure no-op bump, such a document is shape-identical to a
// v10 one, so keeping the number costs nothing and reclaiming it would lock those projects out.
// v12 adds `StoryDocument.unassignedSceneIds`: the order of the scenes no chapter claims, which
// until now was only the key order of the `scenes` record. The bump is not additive in the way v7
// and v8 were. A v11 Studio would ignore the field and fall back to key order, which the canonical
// serializer sorts by UUID - so it would open the document, show the scenes in a random order, and
// save that as if the author had arranged it. Refusing the document is the point.
// v13 does two things at once, because both change what a block may BE and one migration has to see
// the other's output. (a) The `code` block kind is gone. It had a language picker and a source
// editor and had never run: the compiler skipped every one of them with a warning, so the whole
// affordance was a promise the runtime never kept. Its rows migrate to `note` with the source
// carried over verbatim - authors typed real code into them, and dropping it would be silent data
// loss. (b) A `repeat` group may now carry `until` (a condition, compiled to the engine's
// `whileLoop`) instead of `times`, and there is a new `{control:"break"}` row.
// Neither half is additive, and in opposite directions. A v12 Studio reading a v13 document would
// find a control payload whose `control` is `"break"` and an `until` it does not know, and would
// compile the loop as a one-shot `repeat` with no iteration at all - a scene that runs, silently
// wrong. Reading the other way, a v12 document's `code` rows no longer typecheck as blocks at all.
// So the bump makes an older Studio refuse rather than reinterpret.
// v14 adds two node kinds to the story expression language: `array` (the `[1, 2, 3]` literal) and
// `index` (the `inv[0]` / `flags["ch1"]` subscript), which together are what finally lets a `json`
// variable be READ - it could always be stored, and until now every use of one had to detour through
// a blueprint. The whitelist grows by 22 collection and string functions in the same change, but
// functions need no version: an unknown name has always parsed to `invalid`, which is a tree the
// compiler refuses, so an older Studio fails loudly on those already.
// No migration. A v13 document cannot contain either node - they did not exist to be written - so
// there is nothing to rewrite and the ladder in `migrateStoryDocumentToLatest` gets no new step,
// only the unconditional stamp it already ends with.
// The bump is still not optional, and this is the one direction that matters: a v13 Studio reading a
// v14 expression would meet a node kind absent from every one of its switches. `isStoryExpressionEvaluable`
// returns `undefined` for it, the compiler reads that as falsy and quietly drops the expression, and
// the evaluator's exhaustive switch falls through to `undefined` - so an inventory check would read
// as empty rather than as broken. Refusing the document is the point.
// v15 adds two more node kinds to the story expression language, and both are *references* rather
// than computations: `visited` (`visited(序章)` / `picked(那句拒绝)`, a read of the visited record in
// `runtime/game/storyVisited.ts`) and `invoke` (`bonus()`, a call to a `mode:"value"` Story Action
// Blueprint whose Return Value becomes the expression's). Between them they close the last two
// places where an expression had to detour through a blueprint: a route/one-shot check, which only
// the blueprint nodes could ask, and an assignment right-hand side, which was the one slot of the
// three that could not name a blueprint at all (interpolation and conditions both already could).
// Both store an id and carry the author's name for display and repair only - the same convention as
// `var` / `StoryVariableRef` / `StoryLayerRef` - so renaming a scene, rewording an option or
// renaming a blueprint cannot break a reference.
// No migration, for the same reason v14 needed none: a v14 document cannot contain either node, so
// the ladder in `migrateStoryDocumentToLatest` gains no step, only the stamp it already ends with.
// The bump is about the other direction, and here the silent-wrong-answer is worse than v14's. A
// v14 Studio reading `visited(序章)` meets a node kind absent from every switch it has:
// `isStoryExpressionEvaluable` returns `undefined`, the compiler reads that as falsy and drops the
// expression, and the branch it guarded stops being taken. The author sees a route lock that never
// engages and a one-shot option that never greys out - i.e. a story that runs, plausibly, and gates
// nothing. An `invoke` fails the same way, silently turning a computed bonus into "no bonus".
// Refusing the document is the point.
// v16 adds `AppTag` to the story expression language: the build variant a package is being produced
// as, readable as a string (`AppTag == "Demo"`). It is a compile-time constant, not a value the game
// has - the transform in `@shared/story/appTagFold` replaces every mention with the variant's name
// while the bundle is assembled, and a build refuses any mention it could not replace.
// No migration: a v15 document cannot contain the node, so the ladder in
// `migrateStoryDocumentToLatest` gains no step, only the stamp it already ends with.
// The bump is not additive, and it is the same silent-wrong-answer as v14 and v15, one layer down.
// `AppTag` is stored as a `call` node with a `fn` older Studios have never heard of - which is
// exactly why it is a `call` and not a new node kind: every switch over `kind` would have returned
// `undefined` for a new kind and dropped the expression, while every switch over `fn` is exhaustive
// over a closed union that the compiler checks. But a v15 Studio still meets `fn: "appTag"` at
// runtime, falls off the end of `evaluateCall` with `undefined`, and reads `AppTag == "Demo"` as
// false - a demo-only branch that silently never runs, in a story that otherwise plays. Refusing the
// document is the point.
// v16 also carries the `cut` control payload, which would not have needed a version of its own: an
// older Studio reads it as an ordinary group with no children and compiles nothing, which is not a
// wrong answer, only an incomplete one. It rides along because the two shipped together and one
// stamp cannot describe half a document.
// v17 brings back the `{action:"plugin"}` marker block - the row a plugin's story action inserts and
// its own compile pass reads back. This is the second time the shape exists: v11 added it, the
// feature was withdrawn, and the number stayed spent (see above). What is different now is the only
// thing that was wrong then - there is a consumer. The shape is unchanged from v11's, deliberately,
// so a project written during that window migrates by the stamp alone.
// No migration step: no document written before this can contain the block, and a v11 one already
// carries it in exactly this shape.
// The bump is not optional, and the failure it prevents is the silent kind. A v16 Studio meets an
// `action` it has never heard of, falls through `compileStoryAction`'s chain to the `/effect`
// fallback, and emits an effect with an `undefined` name: the marker vanishes and every darken its
// pass would have injected vanishes with it, in a scene that otherwise compiles and plays. Refusing
// the document is the point.
export const STORY_DOCUMENT_SCHEMA_VERSION = 17 as const;
/** Story animation index/asset schema version (independent of the story document version). */
export const STORY_ANIMATION_SCHEMA_VERSION = 1 as const;

export type StoryLibraryIndexVersion = typeof STORY_LIBRARY_INDEX_SCHEMA_VERSION;
export type StoryDocumentVersion = typeof STORY_DOCUMENT_SCHEMA_VERSION;
export type StoryAnimationSchemaVersion = typeof STORY_ANIMATION_SCHEMA_VERSION;

export type StoryId = string;
export type StoryAnimationAssetId = string;
export type StoryChapterId = string;
export type StorySceneId = string;
export type StoryBlockId = string;
export type StoryTextId = string;

export type StoryLibraryIndex = {
    schemaVersion: StoryLibraryIndexVersion;
    stories: StoryLibraryEntry[];
    defaultStoryId?: StoryId;
    meta?: StoryMeta;
};

export type StoryLibraryEntry = {
    id: StoryId;
    name: string;
    documentPath: string;
    createdAt: string;
    updatedAt: string;
    importSource?: StoryImportSource;
    exportMeta?: StoryExportMeta;
};

export type StoryImportSource = {
    kind: "package" | "project" | "manual";
    label?: string;
    importedAt?: string;
};

export type StoryExportMeta = {
    packageFormat?: string;
    exportedAt?: string;
    sourceStoryId?: StoryId;
};

export type StoryDocument = {
    schemaVersion: StoryDocumentVersion;
    id: StoryId;
    name: string;
    entrySceneId?: StorySceneId;
    chapters: StoryChapter[];
    scenes: Record<StorySceneId, StoryScene>;
    /**
     * Authoring order of the scenes no chapter claims (schema v12). `chapters[].sceneIds` orders
     * everything inside a chapter; this orders what is left, so that no scene's position depends on
     * the key order of `scenes` - which the canonical serializer sorts by UUID.
     *
     * Deliberately NOT a document-wide list of every scene. That would state a chaptered scene's
     * position twice, and the two arrays would drift the first time someone reordered a chapter and
     * forgot the other one. Here every scene's order is stated in exactly one place, and the two
     * arrays compose (see `listSceneIdsInDocumentOrder`).
     *
     * Absent means "no unclaimed scenes", which is the normal case - Studio's own paths always file
     * a new scene under a chapter, so unclaimed scenes come from imports and hand edits. Reads must
     * tolerate its absence and `normalizeStoryDocument` is its only writer; nothing that mutates
     * chapters has to remember it exists.
     */
    unassignedSceneIds?: StorySceneId[];
    meta?: StoryMeta;
};

export type StoryMeta = {
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
};

export type StoryChapter = {
    id: StoryChapterId;
    name: string;
    sceneIds: StorySceneId[];
    meta?: StoryMeta;
};

export type StoryScene = {
    id: StorySceneId;
    name: string;
    runtimeName: string;
    description?: string;
    defaultBackgroundAssetId?: string;
    /**
     * The music this scene opens with. The engine plays it as part of the scene's own init, so it is
     * already going when the first row runs — which is what "this scene's track" means and what a
     * leading `/bgm` row can never be (the row plays *after* the scene is on screen).
     *
     * Additive: no document written before this carries it, so no schema bump — the same rule
     * `camera` and `vfx` were added under. Absent means the scene inherits whatever is already
     * playing, which is how a story that changes music with `/bgm` rows has always behaved.
     */
    bgm?: StorySceneBgm;
    rootBlockIds: StoryBlockId[];
    blocks: Record<StoryBlockId, StoryBlock>;
    /**
     * Named "Scene Snapshots" (变量快照): author-authored sets of variable values used to launch a
     * mid-story preview under conditions the editor cannot analyse statically (e.g. global flags).
     * Per-scene and additive (no schema bump); the scene-variable rows shown re-bind per scene.
     */
    sceneSnapshots?: StorySceneSnapshot[];
    meta?: StoryMeta;
};

/**
 * One named variable snapshot. `values` holds only the explicit overrides, keyed by
 * `storyVariableRefKey(ref)` (spanning scene / saved / persistent scopes); anything unset falls back
 * to the variable's declared default at launch time.
 */
export type StorySceneSnapshot = {
    id: string;
    name: string;
    values: Record<string, StoryLiteralValue>;
};

/**
 * A scene's opening background music.
 *
 * `loop` defaults to true because a scene's music is meant to still be playing when the player
 * reaches the end of the scene, and because the in/out points an author marks on the asset only
 * become a loop region when it loops.
 *
 * Volume and fade live here rather than being read off the asset: the same track can open a quiet
 * scene and a loud one, and the fade is a property of *this* transition into *this* scene.
 */
export type StorySceneBgm = {
    assetId: string;
    /**
     * The project audio track this music plays on (`ProjectAudioTrack.id`).
     *
     * Spelled `audioTrackId` rather than `trackId` because `trackId` already keys a Story Motion
     * timeline row, and one spelling for two unrelated things would make "how many rows use this
     * audio track" unanswerable. Absent resolves to the `music` built-in, which is the bus and the
     * defaults a scene's music has always used.
     */
    audioTrackId?: string;
    /** 0-1 as authored. Multiplied by the track's gain at compile time. Absent = the track's gain alone. */
    volume?: number;
    /** Absent = whatever the track's own loop default says (`music` loops). */
    loop?: boolean;
    /** Cross-fade into this track, in milliseconds. Absent = the track's fade-in. */
    fadeMs?: number;
};

export type StorySceneUpdate = {
    name?: string;
    description?: string;
    defaultBackgroundAssetId?: string | null;
    /** `null` clears the scene's music; a partial patch replaces the whole record. */
    bgm?: StorySceneBgm | null;
};

/**
 * Story-declarable variable classes:
 *  - "scene": per-scene, backed by NLR `Scene.local` (survives save/load); declared on `StoryScene`.
 *  - "saved": per save-file, backed by NLR `Storable`; declared on `StoryDocument`; serializable-only.
 *  - "persistent": app-level, shared with UI blueprints via the project variable registry
 *     (`VariableRegistry`, `@shared/types/variables/registry`), referenced by stable `storageKey`;
 *     serializable-only. Not stored in the story document. (The former
 *     `BlueprintDocument.persistentVariables` map was deleted in the M-VAR registry migration; it now
 *     survives only as a legacy migration seed - see `variableRegistryModel.ts`.)
 * The blueprint-local "var" class is a Blueprint concern (`Blueprint.members.variables`), not a story scope.
 */
export type StoryVariableScope = "scene" | "saved" | "persistent";
export type StoryVariableValueType = "boolean" | "number" | "string" | "json";
export type StoryStageObjectKind = "image" | "text" | "layer" | "video" | "vfx";
/**
 * The stage objects that ARE Displayables, and so answer `/transform` and `/fx`.
 *
 * Video and Vfx are `Actionable`s in the engine, not Displayables: they carry no transform pipeline
 * at all. Excluding them here is what makes "a vfx cannot be transformed" a fact of the type system
 * rather than a rule every target picker has to remember.
 */
export type StoryDisplayableTargetKind = Exclude<StoryStageObjectKind, "video" | "vfx"> | "character";

/**
 * What a Story Motion asset animates. Every displayable kind, plus the stage camera.
 *
 * Deliberately NOT the same type as {@link StoryDisplayableTargetKind}: that one is the input to
 * `targetParam(accepts)` and to the command sidebar's subject cut, so widening it would list the
 * camera as a candidate target for `/transform` and `/fx`. The camera has its own command
 * (`/camera motion`), and only the motion *library* needs to know that a camera shot is a thing a
 * motion can be authored for.
 */
export type StoryMotionTargetKind = StoryDisplayableTargetKind | "camera";

/** Declaration for a scene variable (backed by NLR `Scene.local`). */
export type StorySceneVariableDefinition = {
    id: string;
    /** Author-facing, proper-case label. Displayed to users; the id/storageKey are never shown. */
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Stable runtime key; defaults to `id` and never changes on rename so saves stay valid. */
    storageKey: string;
    meta?: StoryMeta;
};

/** Declaration for a saved variable (per save-file, backed by NLR `Storable`). Serializable-only. */
export type StorySavedVariableDefinition = {
    id: string;
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Stable runtime key within the saved namespace; defaults to `id`, unchanged on rename. */
    storageKey: string;
    meta?: StoryMeta;
};

export type StoryLiteralValue = string | number | boolean | null | StoryLiteralValue[] | { [key: string]: StoryLiteralValue };

// --- Legacy shapes, retained only as migration input. ---
// v5 and earlier persisted variable REGISTRIES: `StoryScene.sceneVariables` and
// `StoryDocument.savedVariables` (Record<variableId, definition>). v6 replaced both with
// `declaration` blocks; the migration reads the old fields off the raw object and strips them.
export type StoryVariableScopeLegacy = "studioGlobal" | "gamePersistent" | "sceneLocal";

export type StoryVariableDefinitionLegacy = {
    id: string;
    name: string;
    scope: StoryVariableScopeLegacy;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    meta?: StoryMeta;
};

export type StoryPersistentDefinitionLegacy = {
    namespace: string;
    defaultContent: Record<string, StoryLiteralValue>;
    meta?: StoryMeta;
};

export type StoryBlockKind = "nodeAction" | "action" | "control" | "jump" | "note" | "invalid" | "declaration";

export type StoryBlock =
    | StoryNodeActionBlock
    | StoryActionBlock
    | StoryControlBlock
    | StoryJumpBlock
    | StoryNoteBlock
    | StoryInvalidBlock
    | StoryDeclarationBlock;

export type StoryBlockBase<TKind extends StoryBlockKind, TPayload> = {
    id: StoryBlockId;
    kind: TKind;
    parentId: StoryBlockId | null;
    childrenIds: StoryBlockId[];
    payload: TPayload;
    diagnosticsMeta?: StoryDiagnosticsMeta;
    /**
     * A disabled row (schema v7) is skipped by the compiler — with its whole subtree, if it is a
     * container — and is invisible at runtime, but the build does not reject it (unlike `invalid`) and
     * it keeps its payload (unlike `note`). Absent means enabled; the three states are disjoint.
     */
    disabled?: boolean;
};

export type StoryNodeActionBlock = StoryBlockBase<"nodeAction", StoryNodeActionPayload>;
export type StoryActionBlock = StoryBlockBase<"action", StoryActionPayload>;
export type StoryControlBlock = StoryBlockBase<"control", StoryControlPayload>;
export type StoryJumpBlock = StoryBlockBase<"jump", StoryJumpPayload>;
export type StoryNoteBlock = StoryBlockBase<"note", StoryNotePayload>;
export type StoryInvalidBlock = StoryBlockBase<"invalid", StoryInvalidPayload>;
export type StoryDeclarationBlock = StoryBlockBase<"declaration", StoryDeclarationPayload>;

/**
 * A variable declaration, as a row (schema v6).
 *
 * The row IS the variable: its block id is the `variableId` refs point at, scanning the document is
 * how the variable tables are built, and deleting the row deletes the variable - there is no second
 * registry to leak orphans into. A declaration has no runtime behaviour of its own (the compiler
 * skips it and reads the scanned table for defaults); it exists so a script reader can SEE where a
 * variable comes from, in the same place everything else lives.
 *
 * Scope decides where the scan looks: "scene" declarations bind within their scene, "saved" and
 * "persistent" are document-wide wherever the row sits. Blueprint-declared persistent variables
 * remain in the blueprint document - the one class not authored as a story row.
 */
export type StoryDeclarationPayload = {
    scope: StoryVariableScope;
    /** Author-facing, proper-case label. Displayed to users; the id/storageKey are never shown. */
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    description?: string;
    /** Stable runtime key; defaults to the block id and never changes on rename so saves stay valid. */
    storageKey: string;
};

/**
 * A command line the author left unresolved - they dismissed the candidates, or nothing matched, and
 * the text does not parse into an action.
 *
 * It is deliberately not a note and not narration: it has no runtime behaviour, and it is an *error*,
 * not a comment. Committing one of these is how the editor refuses to silently turn a half-typed
 * `/set` into a line of prose the author never meant to write - the text survives verbatim in
 * `source`, re-editing the row resumes command entry from it, and nothing about it is quiet: preview
 * skips it with an error diagnostic, and a production build refuses to compile at all.
 */
export type StoryInvalidPayload = {
    /** The raw line as typed, so re-entering the row resumes command entry from exactly it. */
    source: string;
};

export type StoryNodeActionPayload =
    | {
          action: "narration";
          text: StoryTextSegment;
      }
    | {
          action: "dialogue";
          characterId?: string;
          /**
           * A speaker with no Studio character behind it, carried as a bare name.
           *
           * NarraLeaf's dialogue box does not bind to Studio's `Character` abstraction - it displays
           * whatever name its `Character` instance carries - so an unknown name is a perfectly valid
           * line, not an error. That is what lets the speaker picker always offer the typed name back
           * as a candidate: "nothing matched" stops being a state the editor has to have an answer
           * for. Ignored when `characterId` resolves.
           */
          speakerName?: string;
          text: StoryTextSegment;
          voiceAssetId?: string;
          /** Auto-pause after the line: `true` waits for a click, a number waits that many ms. */
          pauseAfter?: boolean | number;
      }
    | {
          action: "choice";
          prompt?: StoryTextSegment;
      }
    | {
          action: "choiceOption";
          text: StoryTextSegment;
          hiddenWhen?: StoryConditionRef;
          disabledWhen?: StoryConditionRef;
      };

export type StoryActionPayload =
    | {
          action: "setBackground";
          assetId?: string;
          color?: string;
          transition?: StoryTransitionRef;
      }
    | {
          action: "character";
          /**
           * `setName` is the one operation that touches no portrait: it renames the *speaker label*
           * (NLR `Character.setName`), which is how "？？？" becomes a real name mid-scene. Every other
           * operation acts on the character's stage image.
           *
           * `setMotion` and `setSkin` are the two state channels only a `puppet` character has — the
           * named loop it settles into and the costume it wears. They are here rather than in an
           * action kind of their own because the *subject* is the character: the row reads, colours,
           * indexes and inspects as a character row, and a puppet participates in a scene the way any
           * other character does. On a character Studio draws itself they are a compile diagnostic.
           */
          operation: "enter" | "move" | "exit" | "expression" | "setName" | "setMotion" | "setSkin" | "setParams";
          characterId?: string;
          assetId?: string;
          objectName?: string;
          /** `preset` character: which finished sprite to show. */
          pose?: string;
          /**
           * `layered` character: the tag chosen on each axis. Deliberately partial on `expression` —
           * it names only the axes the author touched, and the engine leaves the rest alone, so
           * changing the mood keeps the outfit. `enter` resolves it out to every axis first.
           */
          tags?: StoryCharacterTagSelection;
          /**
           * `puppet` character: the state its backend is asked for — the expression on `expression`,
           * the motion on `setMotion`, the skin on `setSkin`. The third arm of the same question
           * `pose` and `tags` answer for the other two appearance kinds.
           *
           * A **name the backend owns**, stored verbatim rather than as an id, because there is no id
           * to store: which names a model has is only knowable from the live model (the engine's
           * `PuppetInstance.describe`), so nothing in the project can be renamed out from under it and
           * nothing here can be validated against a catalogue.
           *
           * Absent (or blank) is the engine's `null`: the *absence* of a request, which visibly clears
           * that channel — `/motion Doll` with no name puts the model back to rest. That is why this
           * is one optional field and not a "clear" flag; the engine's own vocabulary already has
           * exactly this shape (`PuppetState`).
           *
           * Additive: no document written before this carries it, so no schema bump — the same rule
           * `camera` and `vfx` were added under.
           */
          puppetName?: string;
          /**
           * `setParams` — the numeric parameters of the model this row sets, keyed by the model's own id.
           *
           * **A map rather than one pair per row, because one gesture is several parameters.** Turning a
           * head is `ParamAngleX`, `ParamAngleY` and `ParamAngleZ` moving together; a row each would
           * make three rows out of one authorial act. The engine's `Puppet.setParam` *merges* — it sets
           * one id and leaves every other alone — so N calls from one row are exactly equivalent to the
           * row's intent, and the compiler emits one per entry.
           *
           * Unlike the three named channels there is no `null` here: the engine's `PuppetState.params`
           * documents an absent key as "keep the model's own default for it", so clearing a parameter
           * means dropping the key rather than nulling it. Dropping every key leaves a row that asks for
           * nothing, which compiles to nothing.
           *
           * Additive, like `puppetName` above: no document written before this carries it.
           */
          params?: Record<string, number>;
          /** `setName` — the label shown from this row on. Empty is legal: some reveals hide the name again. */
          displayName?: string;
          transition?: StoryTransitionRef;
          transform?: StoryTransformRef;
      }
    | {
          action: "audio";
          operation:
              | "setBgm"
              | "playSound"
              | "stopSound"
              | "pauseSound"
              | "resumeSound"
              | "setVolume"
              | "setRate"
              | "muteSound"
              | "seekSound";
          objectName?: string;
          assetId?: string;
          /**
           * The project audio track this row plays on (`ProjectAudioTrack.id`) — the bus it lands on,
           * the multiplier applied to {@link volume}, and the fade/loop defaults it inherits.
           *
           * Only the rows that CREATE a sound (`setBgm`, `playSound`) carry one: a later `/vol piano`
           * addresses a handle that already has a track, and letting it name a second would be two
           * answers to one question (the compiler reports that as a conflict rather than picking).
           *
           * Spelled `audioTrackId`, not `trackId`: the latter is Story Motion's key for a timeline row,
           * and sharing it would make reference counting across documents ambiguous.
           *
           * Additive: no document written before this carries it, so no schema bump. Absent — and a
           * dangling id, since a track can be deleted — resolves to the built-in for the operation's
           * natural bus, which is exactly what the compiler hard-coded before tracks existed.
           */
          audioTrackId?: string;
          /**
           * Fade for this row, in milliseconds, applied in whichever direction the operation goes.
           * Absent = the track's own `fadeInMs` / `fadeOutMs`.
           */
          fadeMs?: number;
          /** 0-1 as authored. Multiplied by the track's gain at compile time. */
          volume?: number;
          rate?: number;
          muted?: boolean;
          /** Absent = the track's own loop default. */
          loop?: boolean;
          /** `seekSound` — where to move the play head, in milliseconds (seconds on the line). */
          timeMs?: number;
      }
    | {
          action: "setVariable";
          target: StoryVariableRef;
          value: StoryLiteralValue;
          /**
           * A computed right-hand side (`/set gold gold + 1`). **When present it wins**, and `value`
           * is only the last literal the row held - never read by the compiler.
           *
           * Why not fold the literal case in here too: `/set gold 100` is the overwhelmingly common
           * row, `value` is what the inspector's literal editor binds to, and every document written
           * before expressions existed already stores it. So a bare literal stays a bare literal and
           * this field is the escape hatch - which keeps the migration empty and the blast radius of
           * expressions confined to rows that actually use one.
           */
          expression?: StoryExpression;
      }
    | {
          action: "wait";
          mode: "duration" | "click";
          durationMs?: number;
      }
    | {
          action: "image";
          operation: "create" | "setSource" | "show" | "hide";
          objectName: string;
          assetId?: string;
          color?: string;
          layer?: StoryLayerRef;
          autoFit?: boolean;
          transition?: StoryTransitionRef;
          transform?: StoryTransformRef;
      }
    | {
          action: "displayable";
          operation:
              | "show"
              | "hide"
              | "transform"
              | "mask"
              | "clearMask"
              | "clip"
              | "clearClip"
              | "filter"
              | "clearFilter"
              | "backdrop"
              | "blend"
              | "darken"
              | "circleReveal"
              | "circleClose"
              | "wipe";
          target: StoryDisplayableTargetRef;
          transform?: StoryTransformRef;
          /** Image mask source (image asset) for the `mask` operation. */
          maskAssetId?: string;
          /** CSS clip-path for the `clip` operation. */
          clipPath?: string;
          /** CSS filter for the `filter` operation. */
          filter?: string;
          /**
           * CSS backdrop-filter for the `backdrop` operation - the frosted-glass knob, a sibling of
           * `filter` (its raw CSS twin), e.g. `blur(8px)`. Additive: no document before this carries it.
           */
          backdropFilter?: string;
          /**
           * mix-blend-mode for the `blend` operation. NLR's `blend()` takes the full CSS type, but only
           * the six modes its `Vfx` overlay exposes are offered (`StoryVfxBlendMode`) - the same curated
           * set, not the CSS catalogue. Additive.
           */
          mixBlendMode?: StoryVfxBlendMode;
          /** Darkness 0..1 for the `darken` operation (image/character targets only). */
          darkness?: number;
          /** Shared effect timing. */
          durationMs?: number;
          easing?: string;
          /** Effect-specific params, e.g. circle center/from/to or wipe direction/reverse. */
          effectProps?: Record<string, StoryLiteralValue>;
      }
    | {
          action: "text";
          operation: "create" | "setText" | "show" | "hide" | "setFontSize" | "setFontColor";
          objectName: string;
          text?: string;
          fontSize?: number;
          fontColor?: string;
          layer?: StoryLayerRef;
          transform?: StoryTransformRef;
      }
    | {
          action: "layer";
          operation: "create" | "setZIndex" | "show" | "hide" | "transform";
          objectName: string;
          /**
           * Which layer non-`create` ops act on - a built-in (`background`/`displayable`) or a custom
           * layer bound by its create block. `create` names a new custom layer via `objectName`.
           */
          target?: StoryLayerRef;
          zIndex?: number;
          transform?: StoryTransformRef;
      }
    | {
          /**
           * A `Video` — an Actionable, not a Displayable, which is why it has its own verb set rather
           * than sharing `displayable`'s. `play` waits for the clip to finish; `resume` does not.
           *
           * Additive: the four transport operations and `timeMs` are new in A3, and no document
           * written before them carries either, so no schema bump.
           */
          action: "video";
          operation: "create" | "show" | "hide" | "play" | "pause" | "resume" | "stop" | "seek";
          objectName: string;
          assetId?: string;
          muted?: boolean;
          /** `seek` — where to jump to, in milliseconds. The engine's `seek` takes seconds; the compiler converts. */
          timeMs?: number;
      }
    | {
          /**
           * The story's stage camera (`story.camera`) — a Displayable like any other in the engine, but
           * its own action kind here because an author does not file "move the camera" next to "move a
           * sprite".
           *
           * Two facts this payload cannot state but every consumer must respect: the camera is a
           * **story-level singleton** whose pose survives a scene change (and rides the save file), and
           * `darken` drives the same CSS `filter` channel `Displayable.filter` does — it is stage
           * brightness, not the scene's `screenEffect` vignette layer.
           *
           * Additive: no document written before this carries it, so no schema bump.
           */
          action: "camera";
          operation: "pan" | "zoom" | "rotate" | "darken" | "look" | "reset" | "motion";
          /** `pan` — where the view centres. The command line fills the three placements; the inspector, any align. */
          position?: StoryAlignPositionValue;
          /** `zoom` — 1 is neutral. Clamped away from 0/negative at compile time. */
          zoom?: number;
          /** `rotate` — degrees. */
          rotation?: number;
          /** `darken` — 0 (normal) to 1 (black). Clamped at compile time; the engine does not clamp. */
          darkness?: number;
          /**
           * `look` — a colour grade over the whole stage, from the library in `lib/ui-editor/runtime/game/cameraLookPresets.ts`.
           *
           * **The same single channel `darken` writes.** `Camera.darken(d)` IS `filter("brightness(1 - d)")`
           * in the engine, so a look and a darken never compose: whichever row runs last wins outright
           * and the earlier one leaves no trace. That is why every preset folds its own brightness in
           * and why the two operations are alternatives rather than layers — a scene that sets both is
           * not "graded and dimmed", it is whichever came second. `reset` clears the channel, so this
           * arm needs no clear operation of its own.
           *
           * Three fields rather than one resolved string, because the string is the *output*: keeping
           * the preset and the dial is what lets the inspector re-open the row on the grade the author
           * chose instead of on a wall of CSS it would have to parse back.
           *
           * Additive, exactly as `motion` and the `vfx` arm were: a document written before this
           * carries none of them, so no schema bump.
           */
          lookPreset?: string;
          /** `look` — 0 is no grade, 1 the preset's nominal strength. Clamped to 0–2 at compile time. */
          lookIntensity?: number;
          /**
           * `look` — the CSS filter actually applied. Written by hand it OVERRIDES `lookPreset`
           * entirely, which is the escape hatch for a grade the library does not name; left empty the
           * compile resolves the preset and the intensity instead.
           */
          filter?: string;
          /**
           * `motion` — a Story Motion driving the camera, i.e. a whole keyframed shot (a handheld
           * shake, a slow push-in) instead of one settled pose. The engine's `Camera` is a
           * `Displayable`, so it takes a `Transform` exactly like a sprite does; this is the same
           * {@link StoryTransformRef} `/transform` carries, and it is read only in `animation` mode —
           * the other five operations already *are* the presets a `preset` mode would offer.
           *
           * `durationMs`/`easing` are dead for this operation: the timing lives in the keyframes.
           */
          motion?: StoryTransformRef;
          durationMs?: number;
          easing?: string;
      }
    | {
          /**
           * A `Vfx` (NLR 0.16.0) — a full-screen looping video overlay for ambience: falling petals,
           * rain, dust, light flares. An `Actionable`, **not** a Displayable: it has no transform
           * pipeline, which is why `StoryDisplayableTargetKind` excludes it and `/transform` `/fx`
           * never offer it as a target.
           *
           * `create` is what puts it on stage AND registers the name the later verbs address, the
           * same shape `video` uses. Additive: no document before A3 carries it, so no schema bump.
           */
          action: "vfx";
          operation: "create" | "show" | "hide" | "pause" | "resume" | "setRate";
          objectName: string;
          /** The looping clip — a video asset, the same pipeline `/video` uses. */
          assetId?: string;
          /**
           * How the overlay composites. The choice IS the material route: `normal` for a true-alpha
           * WebM, `screen` for glow rendered on black, `multiply` for shadow rendered on white.
           */
          blendMode?: StoryVfxBlendMode;
          opacity?: number;
          loop?: boolean;
          fit?: "cover" | "contain" | "fill";
          zIndex?: number;
          /**
           * Playback speed; 0.5 drifts slowly, 2 falls twice as fast. On `setRate` it is the change;
           * on `create` it is the loop's resting speed — and only the latter survives a save, since
           * the engine does not persist a runtime rate change.
           */
          rate?: number;
          /** `show` / `hide` — the fade the action waits out. */
          durationMs?: number;
          easing?: string;
      }
    | {
          action: "nvl";
          transition?: StoryTransformRef;
      }
    | {
          /**
           * A screen-wide gesture drawn on the scene's own effect layer: the eyes closing, the frame
           * darkening at its edges. Both are one in-and-out move with a pause at full, which is why
           * they share one parameter grammar rather than each naming its halves differently.
           *
           * `durationMs` is the WHOLE move and stays the only field a simple row needs; `inMs` and
           * `outMs` override one half each, and absent means "derive from `durationMs`". Splitting
           * them is the difference between a blink and "slam the eyes shut, then open them slowly" —
           * the engine has always had `closeDuration` / `openDuration`, and Studio used to fill both
           * from the one number, so the asymmetric blink was inexpressible rather than unsupported.
           *
           * Additive: a document written before this carries neither half, and `durationMs` alone
           * still means exactly what it meant. No schema bump.
           */
          action: "screenEffect";
          effect: "blink" | "vignette";
          durationMs?: number;
          /** The move in: the eyes closing (`blink`), the edges darkening (`vignette`). */
          inMs?: number;
          /**
           * The move out: the eyes opening, the edges clearing.
           *
           * Honoured in full by `blink`. The engine's `vignette` helper drives both of its halves from
           * one `duration`, so a vignette whose `outMs` differs from its in-duration is reported at
           * compile time rather than silently played symmetric — see `compileScreenEffectAction`.
           */
          outMs?: number;
          holdMs?: number;
          color?: string;
          opacity?: number;
          /**
           * `vignette` — where the mask starts and finishes fading, as a percentage of the frame.
           * Stored as numbers and printed into the engine's length strings at compile time: the
           * gradient stops are the one thing here that must stay resolution-independent, and a number
           * the inspector can put on a slider cannot be typed as `44px` by accident.
           *
           * `inner` is the clear centre and `outer` the fully-dark edge, so `inner` above `outer` is
           * not a wide vignette, it is a `radial-gradient` the browser drops entirely. Ordered at
           * compile time.
           */
          inner?: number;
          outer?: number;
          easing?: string;
      }
    | {
          action: "blueprint";
          /** Owner blueprint id of the implicit Story Action Blueprint bound 1:1 to this action. */
          blueprintId: string;
      }
    | {
          /**
           * A marker a plugin's story action left behind, for that same plugin's compile pass to read.
           *
           * This is the one block kind whose meaning lives outside the document, and the exception is
           * deliberate. Everything else a plugin contributes through `story.actions` is a standard
           * block: the action is a *shortcut for typing*, and once typed the document owes the plugin
           * nothing - uninstall it and the scene still plays. A marker cannot work that way, because
           * what it asks for is not a thing that happens at one point in the scene but a rule about
           * every line after it, and no fixed set of rows expresses that while the author keeps
           * editing. So the row records the *request* and the plugin's pass answers it at compile
           * time.
           *
           * The consequence is a real dependency, and it is declared rather than discovered:
           * `ProjectDependencyService` scans these blocks and reports the plugin as required, so a
           * project that would compile differently without it says so before the build, not after.
           * A marker whose plugin is absent compiles to nothing and lints as a missing dependency -
           * never to a guess about what it meant.
           */
          action: "plugin";
          /** The plugin that owns this marker. The document hard-depends on it; see above. */
          pluginId: string;
          /** The plugin's story-action id, itself namespaced by `pluginId`. */
          actionId: string;
          /**
           * What the author filled in on the row, for the owning pass to interpret. Studio never
           * reads inside it - the keys are the plugin's vocabulary - so it is only constrained to be
           * JSON, which is what makes the row survive a round trip through the project file.
           */
          params: Record<string, StoryPluginActionParamValue>;
      };

/** A JSON-serializable parameter value carried by a `{action:"plugin"}` block. */
export type StoryPluginActionParamValue =
    | string
    | number
    | boolean
    | null
    | StoryPluginActionParamValue[]
    | { [key: string]: StoryPluginActionParamValue };

/** Mirrors NLR's `VfxBlendMode`; the compiler passes it straight through to the overlay's CSS. */
export type StoryVfxBlendMode = "normal" | "screen" | "multiply" | "lighten" | "color-dodge" | "overlay";

export type StoryControlPayload =
    | {
          control: "condition";
      }
    | {
          control: "conditionBranch";
          branch: "if" | "elseIf" | "else";
          condition?: StoryConditionRef;
      }
    | {
          control: "sequence" | "parallel" | "race" | "repeat";
          mode?: "do" | "doAsync" | "all" | "allAsync" | "any";
          times?: number;
          /**
           * A conditional loop (schema v13), on `repeat` only: run the body over and over **until**
           * this condition becomes true. Mutually exclusive with {@link times} - `until` present is
           * what selects the conditional form, and the two together are a command-line error.
           *
           * Read the name literally, because the engine's is the opposite. `until` is a STOP
           * condition; NLR's `Control.whileLoop` takes a CONTINUE condition, so the compiler passes
           * it the negation. Anything that evaluates this - a preview, a lint, a second compiler -
           * has to do the same, and getting it backwards produces a loop that runs zero times or
           * forever rather than an error anyone can see.
           *
           * The body is not guaranteed to run: like a while loop, the condition is tested first, so
           * an `until` that is already true skips the group entirely. There is deliberately no
           * "test at the end" variant - one loop shape is enough, and the author can put the row
           * before the group.
           */
          until?: StoryConditionRef;
      }
    | {
          /**
           * Leave the innermost enclosing loop (`Control.breakLoop`) - the escape hatch a conditional
           * loop needs, since an `until` that a body can no longer satisfy has no other way out.
           *
           * Carries nothing and takes no children: it is a single instruction, so unlike every other
           * `control` row it is not a container. Legal only inside a `repeat` body; the compiler
           * diagnoses a stray one rather than emitting it, because the engine's own error for a
           * `breakLoop` with no loop around it arrives at play time, on the player's screen.
           */
          control: "break";
      }
    | {
          /**
           * A named point inside a scene (`Control.label`). Invisible at runtime — it passes straight
           * through to the next row — and it is the only thing `goto` can address.
           *
           * Names are scoped to their scene, so the same name may recur in another one; declaring it
           * twice within a scene is an error the engine's build rejects, which is why the compiler
           * diagnoses it here first.
           */
          control: "label";
          name: string;
      }
    | {
          /**
           * Move the play head to a `label` in the SAME scene (`Control.jump`). Distinct from a
           * `jump` block, which changes scene and therefore unloads and re-initializes one — this
           * unloads nothing, so it is the loop and the retry, not the transition.
           */
          control: "goto";
          targetLabel: string;
      }
    | {
          /**
           * Where one build variant's story ends. The rest of the scene, and everything the story
           * reaches after it, is not in that variant's package; every other variant does not have
           * this row at all.
           *
           * Control flow rather than a block kind of its own: it says where playback of an edition
           * stops, which is the same question `break` and `goto` answer for a loop and a scene. Not
           * a container — it carries nothing and takes no children, so `canAcceptChildren` refuses
           * it the way it refuses the other three single-instruction control rows.
           *
           * Names the variant by its id, under the field name every stored reference to a variant
           * uses (`APP_TAG_REFERENCE_FIELDS`), so renaming a variant cannot invalidate the
           * row and the "how many things use this variant" sweep counts it without being taught
           * about story rows. An id no variant answers to resolves to release, and a cut point
           * naming release cuts nothing — which is what makes deleting a variant safe to do with
           * its rows still written.
           *
           * **Needed no version of its own.** The payload is additive: a document that predates it
           * simply has no such row, so the migration ladder gains no step. It is the one direction
           * that decides this, and here it is benign - an older Studio meets an unknown control
           * payload, reads the row as an ordinary group and compiles it as one, which emits nothing
           * because the row has no children. Nothing it can do with the document is silently wrong;
           * it just does not know what the row means. It is stamped v16 because `AppTag` shipped in
           * the same document and that one does have to be refused.
           */
          control: "cut";
          appTagId: string;
      };

export type StoryJumpPayload = {
    targetSceneId: StorySceneId;
    transition?: StoryTransitionRef;
};

export type StoryNotePayload = {
    text: StoryTextSegment;
};

export type StoryTextSegment = {
    textId: StoryTextId;
    /** Plain-text projection of the segment (concatenation of rich text runs). Always kept in sync. */
    value: string;
    role: "narration" | "dialogue" | "choicePrompt" | "choiceText" | "note";
    /**
     * Optional rich-text runs. When absent the segment is plain (`value`). When present, `value`
     * is the derived plain-text projection and `rich` is the source of truth for styling. Maps to
     * NarraLeaf `Sentence`/`Word`/`Pause` at compile time.
     */
    rich?: StoryRichRun[];
};

export type StoryTextMarks = {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    ruby?: string;
    cps?: number;
    fontSize?: number;
};

/**
 * Inline text interpolation (phase 2): a rich-text run that renders a computed value.
 *  - "variable": the current value of a scene/saved/persistent variable (NLR dynamic word).
 *  - "blueprint": the Return Value of a Story Action Blueprint's On Call graph.
 */
export type StoryInterpolationRef =
    | { kind: "variable"; target: StoryVariableRef }
    | { kind: "blueprint"; blueprintId: string }
    /**
     * A computed inline run - the `{gold + bonus}` an author types mid-sentence. A bare `{gold}`
     * normalizes to `kind: "variable"` instead, so there is exactly one representation of "show this
     * variable" and the existing variable-interpolation UI keeps working unchanged.
     */
    | { kind: "expression"; expression: StoryExpression };

/**
 * An inline reveal-time event (phase B1): a zero-width dialogue token that fires a restricted,
 * closed set of side effects the instant the typewriter reveals it — the editor analogue of NLR's
 * `TextEvent`. It is NOT a general action escape hatch; only an expression switch and/or a sound
 * effect. `expression` targets the speaking character (the row's `characterId`) and reuses the
 * `pose`/`tags` selection every `/show` `/face` action already uses.
 */
export type StoryInlineEvent = {
    expression?: {
        characterId: string;
        pose?: string;
        tags?: StoryCharacterTagSelection;
    };
    sound?: { assetId: string };
};

export type StoryRichRun =
    | { text: string; marks?: StoryTextMarks }
    | { pause: number | true }
    /** An inline value (variable/blueprint), stylable like a word: bold/italic/color apply to its text. */
    | { interpolation: StoryInterpolationRef; marks?: StoryTextMarks }
    /** A zero-width reveal-time event (expression switch and/or SE). Projects to no plain text. */
    | { event: StoryInlineEvent };

export type StoryVariableRef =
    | { scope: "scene"; variableId: string }
    | { scope: "saved"; variableId: string }
    // v9 (M-VAR): symmetric with the other scopes. `variableId` is the persistent variable's identity
    // (registry entry id, or declaration block id for a story `/persis` row) - which equals its storage
    // key, so the resolver still hands that value to the host persistence bridge.
    | { scope: "persistent"; variableId: string };

/** Legacy (schema v1) free-form variable reference, retained for migration + picker safety-net. */
export type StoryVariableRefLegacy = {
    scope: StoryVariableScopeLegacy;
    namespace?: string;
    key: string;
};

/**
 * The stage singletons every scene has without a creator block: the scene background image
 * (`Scene.background`) and NarraLeaf-React's two built-in layers. All are Displayables, so any of
 * them can be a transform / show / hide / effect target.
 */
export type StoryDisplayableBuiltin = "background" | "backgroundLayer" | "displayableLayer";

export type StoryDisplayableTargetRef = {
    kind?: StoryDisplayableTargetKind;
    name: string;
    /**
     * Stable identity of the displayable: the id of the action block that introduced it
     * (character enter / image / text / layer). Displayables can only be declared statically,
     * so this always points at a real creator block. When present it is the source of truth -
     * the current stage name is resolved from that block, so the reference survives renames.
     * `name` remains as a legacy fallback and last-known label when the source is unresolvable.
     */
    sourceBlockId?: StoryBlockId;
    /**
     * A built-in stage singleton (scene background / built-in layer) that has no creator block.
     * When set it is the source of truth; `name`/`kind`/`sourceBlockId` are display fallbacks only.
     */
    builtin?: StoryDisplayableBuiltin;
};

/**
 * Reference to the render layer an image/text is placed on. Layers can only be declared statically
 * (by a `layer` create block) or be one of NarraLeaf-React's two built-in scene layers, so every
 * valid target is discoverable by scanning the scene - never free-text.
 *  - "default": one of NLR `Scene.backgroundLayer` (z-index -1) / `Scene.displayableLayer` (z-index
 *    0, the default). An absent ref is equivalent to `{ kind: "default", layer: "displayable" }`.
 *  - "custom": a user-declared layer, bound to the stable id of the `layer` create block. The
 *    block's current name is resolved at every read site so the reference survives renames; `name`
 *    is only a legacy fallback / last-known label (also the sole binding for pre-v3 documents whose
 *    layer name never matched a create block).
 */
export type StoryLayerRef =
    | { kind: "default"; layer: "background" | "displayable" }
    | { kind: "custom"; sourceBlockId?: StoryBlockId; name?: string };

/** Tag id per axis id. Partial selections are legal and mean "leave every other axis alone". */
export type StoryCharacterTagSelection = Record<string, string>;

export type StoryConditionRef =
    | {
          kind: "variable";
          target: StoryVariableRef;
          operator: "isTrue" | "isFalse" | "equals" | "notEquals" | "exists";
          value?: StoryLiteralValue;
      }
    | {
          /**
           * Blueprint-backed condition: the boolean is computed by an implicit Story Action Blueprint's
           * "On Call" graph (owner kind `storyAction`, mode `condition`), mirroring how a blueprint
           * interpolation evaluates a value. The graph's `Return Value` is typed boolean and coerced
           * with `Boolean(...)` at evaluation. `blueprintId` is created lazily on first edit.
           */
          kind: "blueprint";
          blueprintId: string;
      }
    | {
          /**
           * Expression-backed condition: `/if gold >= 100`. Carries a parsed {@link StoryExpression},
           * not raw script - the tree is built once when the row commits, so the compiler evaluates
           * rather than parses and a condition cannot fail to compile on data that already saved.
           *
           * Schema v4 stored a bare `source: string` here and every consumer refused it (the compiler
           * returned a constant false). v5 re-parses that source on load; anything that no longer
           * resolves becomes an `invalid` tree, which faults visibly instead of silently testing false.
           */
          kind: "expression";
          expression: StoryExpression;
      };

export type StoryTransformPreset =
    | "none"
    | "left"
    | "center"
    | "right"
    | "custom"
    | "fadeIn"
    | "fadeOut"
    | "slideLeft"
    | "slideRight"
    | "slideUp"
    | "slideDown"
    | "zoom"
    | "scale"
    | "rotate"
    /**
     * Mirror the target horizontally — the sprite that faces both ways from one drawing.
     *
     * A sibling of `scale` rather than a channel of its own, because that is what it is in the
     * engine: `Displayable.scale` documents "use negative value to invert the scale" and NLR maps
     * the pair onto `scale(zoom*scaleX, zoom*scaleY)`, so a mirror IS `scaleX: -1`. Both presets
     * therefore write the same field, and a transform holds one preset, so a row cannot ask to be
     * mirrored and scaled by two different numbers at once.
     *
     * Additive: no document written before this carries it, so no schema bump.
     */
    | "flip"
    | "opacity"
    | "darken"
    | "circleReveal"
    | "circleClose"
    | "wipe";

export type StoryTransformRef = {
    mode?: "preset" | "animation";
    preset?: StoryTransformPreset;
    durationMs?: number;
    easing?: string;
    props?: Record<string, StoryLiteralValue>;
    animationId?: StoryAnimationAssetId;
};

export type StoryTransitionRef = {
    kind:
        | "none"
        | "dissolve"
        | "fadeIn"
        | "maskCircle"
        | "maskWipe"
        | "softWipe"
        | "blinds"
        | "slide"
        | "softIris"
        // 0.16.0 Mask-vocabulary additions (engine `Reveal` + `Mask.*`). Additive: existing documents
        // never carry these, so no schema bump is needed.
        | "barnDoor"
        | "clock"
        | "fan"
        | "dots"
        | "blurDissolve"
        // 0.28.0: engine `Exposure` — the frame burns out per channel instead of
        // being covered. Additive, like the mask additions above.
        | "exposure"
        | "throughColor"
        | "darkness"
        | "custom";
    durationMs?: number;
    easing?: string;
    props?: Record<string, StoryLiteralValue>;
};

export type StoryDiagnosticsMeta = {
    sourceLine?: number;
    sourceColumn?: number;
    tags?: string[];
};

export type StoryAnimationIndex = {
    schemaVersion: StoryAnimationSchemaVersion;
    animations: StoryAnimationIndexEntry[];
    meta?: StoryMeta;
};

export type StoryAnimationIndexEntry = {
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryMotionTargetKind;
    documentPath: string;
    createdAt: string;
    updatedAt: string;
};

export type StoryAnimationAsset = {
    schemaVersion: StoryAnimationSchemaVersion;
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryMotionTargetKind;
    timeline?: StoryAnimationTimeline;
    sequences: StoryAnimationSequence[];
    config?: StoryAnimationConfig;
    /**
     * Editor-only image asset rendered as the motion target in the Story Motion preview.
     * This is a visualization hint and is NOT an animation target binding - it is
     * ignored by the compiler and never affects the produced Transform.
     */
    previewAssetId?: string;
    /** Editor-only image asset rendered as the stage background in the Story Motion preview. */
    previewBackgroundAssetId?: string;
    meta?: StoryMeta;
};

export type StoryAnimationConfig = {
    repeat?: number;
    repeatDelayMs?: number;
};

export type StoryAnimationSequence = {
    id: string;
    props: StoryTransformSequenceProps;
    options?: StoryAnimationSequenceOptions;
};

export type StoryAnimationTimeline = {
    fps?: number;
    durationMs?: number;
    tracks: StoryAnimationTrack[];
};

export type StoryAnimationTrackProperty = keyof StoryTransformSequenceProps;

export type StoryAnimationTrack = {
    id: string;
    property: StoryAnimationTrackProperty;
    keyframes: StoryAnimationKeyframe[];
};

export type StoryAnimationKeyframe = {
    id: string;
    timeMs: number;
    value: StoryAnimationKeyframeValue;
    easing?: string;
};

export type StoryAnimationKeyframeValue = StoryAlignPositionValue | number | string;

export type StoryTransformSequenceProps = {
    position?: StoryAlignPositionValue;
    opacity?: number;
    zoom?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    fontColor?: string;
    maskImage?: string;
    maskSize?: string;
    maskPosition?: string;
    maskRepeat?: string;
    maskMode?: string;
    clipPath?: string;
    filter?: string;
    backdropFilter?: string;
    mixBlendMode?: string;
};

export type StoryAlignPositionValue = {
    xalign?: number;
    yalign?: number;
    xoffset?: number;
    yoffset?: number;
};

export type StoryAnimationSequenceOptions = {
    durationMs?: number;
    easing?: string;
    delayMs?: number;
    at?: number | `+${number}` | `-${number}`;
};

export type StoryPackageCapability = {
    supported: false;
    reason: "not_implemented";
};
