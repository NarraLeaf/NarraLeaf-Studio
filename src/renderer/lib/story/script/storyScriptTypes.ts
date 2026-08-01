import type { StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";

/**
 * The Story Script text format: a scene rendered as editable prose plus a verbatim snapshot.
 *
 * The format exists so a writer can take a scene out of Studio, edit it in any text editor on any
 * device, and bring it back without losing anything. That "without losing anything" is NOT earned by
 * covering every action in the grammar - it is earned by carrying the scene's own JSON in the file
 * (`#data`) and only ever letting the text layer edit the things a writer edits: narration, dialogue,
 * choice text and notes. Every other row projects to a read-only `»` label whose payload is taken back
 * from the snapshot untouched.
 *
 * The consequence worth stating twice: **the `»` label is never parsed.** It is cosmetic. An author
 * may mangle it, translate it, or delete half of it; as long as the row's anchor survives, the action
 * comes back exactly as it left. That is what makes the format's losslessness a property of its
 * construction rather than a race between the exporter and a payload union that grows every week.
 */
export const STORY_SCRIPT_FORMAT_VERSION = 1 as const;

/**
 * Anchor delimiters and rich-run markers.
 *
 * Chosen because no author types them: the escaping burden would otherwise fall on `{`, `[` and `*`,
 * which appear in real prose constantly. Text that does contain one of these four is backslash-escaped
 * on export and unescaped on import, so the round-trip stays total on arbitrary input.
 */
export const STORY_SCRIPT_ANCHOR_OPEN = "⟦";
export const STORY_SCRIPT_ANCHOR_CLOSE = "⟧";
export const STORY_SCRIPT_RUN_OPEN = "‹";
export const STORY_SCRIPT_RUN_CLOSE = "›";

/** Line prefixes for the shapes the text layer may edit, plus the opaque one it may not. */
export const STORY_SCRIPT_NOTE_PREFIX = "// ";
export const STORY_SCRIPT_OPTION_PREFIX = "- ";
export const STORY_SCRIPT_OPAQUE_PREFIX = "» ";

/**
 * Cosmetic one-line description of a non-editable row. Supplied by the caller because the good
 * describer (`describeStoryBlock`) needs project lookups the codec has no business holding.
 */
export type StoryScriptLabeller = (scene: StoryScene, blockId: StoryBlockId) => string;

/**
 * The name printed before a dialogue line: the row's `speakerName`, or the display name of the
 * character it binds to. A callback for the same reason {@link StoryScriptLabeller} is one - resolving
 * a `characterId` to a name needs the project's character list, which the codec must not hold.
 *
 * Required rather than optional, and deliberately so: a codec that fell back to "" for a
 * character-bound row would export `: 早上好` and re-import it as a *speaker change*, silently
 * unbinding the character. A missing callback has to be a compile error, not a runtime surprise.
 */
export type StoryScriptSpeakerLabeller = (scene: StoryScene, blockId: StoryBlockId) => string;

/**
 * The inverse: what a speaker label the author typed (or edited) means. Returns the character it
 * names, or the bare name to carry as a temp speaker (`StoryNodeActionPayload.speakerName`).
 *
 * Consulted **only for a label the author actually changed** - see `speakerLabel` on
 * {@link StoryScriptPlanInput}. `character -> display name` is neither total nor injective, so asking
 * this what an *unedited* label means is how a round trip with no edits in it destroys a binding.
 */
export type StoryScriptSpeakerResolver = (label: string) => { characterId: string } | { speakerName: string };

export type StoryScriptExportMode =
    /** Anchors + `#data` footer. Importable, and the only mode that round-trips. */
    | "roundtrip"
    /** Prose only - no anchors, no footer. Byte-stable for the same document, so `git diff` between
     *  two exports is meaningful. Deliberately NOT importable: a file with no snapshot cannot restore
     *  an action, and guessing one would be worse than refusing. */
    | "review";

export type StoryScriptExportOptions = {
    mode: StoryScriptExportMode;
    label: StoryScriptLabeller;
    speaker: StoryScriptSpeakerLabeller;
};

export type StoryScriptLineShape = "narration" | "dialogue" | "note" | "choiceOption" | "opaque";

export type StoryScriptParseErrorCode =
    | "notAScript"
    | "unsupportedVersion"
    | "dataMissing"
    | "dataCorrupt"
    | "malformed";

export type StoryScriptParseError = {
    code: StoryScriptParseErrorCode;
    /** Developer-facing English. The UI renders `story.script.parseError.<code>` instead. */
    message: string;
    line?: number;
};

export type ParsedStoryScriptLine = {
    /** 1-based, counted within the whole file. */
    lineNumber: number;
    /** Nesting depth, from the leading indent (2 spaces per level). */
    depth: number;
    /** Absent for a line the author typed themselves - which is exactly how a new row is detected. */
    anchor?: number;
    shape: StoryScriptLineShape;
    /** `dialogue` only. The label as written; resolution back to a character happens at merge time. */
    speaker?: string;
    /** Editable shapes only, still carrying its rich-run markers. */
    text?: string;
};

export type ParsedStoryScriptScene = {
    sceneId: StorySceneId;
    name: string;
    /**
     * Hash of the canonical scene JSON at export time (see `storyScriptCodec.ts` for the digest, which
     * is an integrity check and not a security boundary). Drives the staleness warning.
     */
    origin: string;
    /** The verbatim scene as exported. Every non-edited field on every row comes from here. */
    snapshot: StoryScene;
    lines: ParsedStoryScriptLine[];
};

export type ParsedStoryScript = {
    formatVersion: number;
    storyId: string;
    scenes: ParsedStoryScriptScene[];
};

export type StoryScriptParseResult =
    | { ok: true; script: ParsedStoryScript }
    | { ok: false; error: StoryScriptParseError };

export type StoryScriptDiagnosticCode =
    /** A `»` line with no anchor: the text cannot say what action it was, so no row is created. */
    | "opaqueWithoutAnchor"
    /** An anchor naming a row that is not in the snapshot. */
    | "unknownAnchor"
    /** An anchor whose row is an action, on a line the author rewrote as prose. The row is kept and
     *  the edit is dropped - never the other way around. */
    | "shapeMismatchAction"
    /** The mirror image: an anchor whose row is text, on a line the author rewrote as a `»` action.
     *  Kept apart from {@link shapeMismatchAction} because the two sentences differ in *which* half
     *  of the file survived, which is the only thing the author needs to know to fix it. */
    | "shapeMismatchText"
    /** The same anchor twice: the author copied a line. The first keeps its identity; the rest are
     *  cloned with fresh ids, because two rows cannot share a `textId` without merging their
     *  translations and their voice takes. */
    | "duplicateAnchor"
    /** A rich-run marker naming a run the snapshot does not have. The marker is dropped. */
    | "unknownRun"
    /** A new line whose shape cannot carry an author-typed row (e.g. an option outside a choice). */
    | "unplaceableLine"
    /**
     * A speaker label the author changed, with no {@link StoryScriptSpeakerResolver} supplied to turn
     * it back into a binding. The change is ignored - guessing would unbind the row - while the text
     * edit on the same line still applies.
     *
     * Reported only for a change that is *visible* without the project's characters, i.e. on a row
     * carrying a bare `speakerName`. A row bound to a `characterId` was exported under a display name
     * this file cannot recompute, so a change to it is not merely unresolvable but undetectable, and
     * a diagnostic on every such line would say "unverified", not "changed".
     */
    | "speakerUnresolved";

export type StoryScriptDiagnostic = {
    severity: "error" | "warning";
    code: StoryScriptDiagnosticCode;
    line?: number;
    /** Developer-facing English; the UI renders `story.script.diag.<code>`. */
    message: string;
};

export type StoryScriptSceneStats = {
    unchanged: number;
    edited: number;
    added: number;
    removed: number;
    cloned: number;
    /** Rows whose position or nesting changed but whose payload did not. */
    moved: number;
};

export type StoryScriptScenePlan = {
    sceneId: StorySceneId;
    sceneName: string;
    /**
     * The merged scene, structurally valid and ready to hand to `replaceScene` as-is.
     * `replaceScene` performs no validation of its own, so this must be correct by construction.
     */
    scene: StoryScene;
    stats: StoryScriptSceneStats;
    /** The live scene no longer hashes to `origin`: importing will discard whatever changed since. */
    stale: boolean;
    /** True when the scene is absent from the live document entirely. */
    missing: boolean;
    diagnostics: StoryScriptDiagnostic[];
};

export type StoryScriptImportPlan = {
    /** The file's `#story` id matches the open document. False is a warning, not a refusal. */
    storyMatches: boolean;
    scenes: StoryScriptScenePlan[];
    diagnostics: StoryScriptDiagnostic[];
};

/**
 * Mints the ids new rows need. Must produce UUID v4: `assertValidStoryEntityId` rejects anything
 * else, and a rejected id surfaces only when the document is next loaded.
 */
export type StoryScriptIdFactory = () => string;

export type StoryScriptPlanInput = {
    script: ParsedStoryScript;
    live: StoryDocument;
    generateId: StoryScriptIdFactory;
    /**
     * Optional. Absent means speaker labels are read-only: a changed label on a character-bound row is
     * ignored with a `speakerUnresolved` diagnostic rather than guessed at.
     */
    resolveSpeaker?: StoryScriptSpeakerResolver;
    /**
     * The labeller the file was **exported** through, so import can ask the only question it can answer
     * correctly: *did the author change this label?*
     *
     * Without it, the only available question is "what does this label resolve to?", and that answer is
     * wrong on three states no display name can express - a binding to a deleted character (which
     * prints nothing), two characters sharing a name (first-wins rebinds the row to the wrong one), and
     * a temp speaker spelled like a character (silently promoted into a binding). All three are edits
     * the author did not make, on a file they did not touch.
     *
     * Optional so the codec stays usable without a project, but a caller that has the export's labeller
     * and does not pass it is asking for those three corruptions.
     */
    speakerLabel?: StoryScriptSpeakerLabeller;
};
