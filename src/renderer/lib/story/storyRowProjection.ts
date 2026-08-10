import type { TranslationKey } from "@shared/i18n";
import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryDocument,
    StoryExpr,
    StoryInterpolationRef,
    StoryScene,
    StorySceneId,
    StoryTextSegment,
    StoryVariableRef,
} from "@shared/types/story";
import {
    describeDeclaration,
    layerActionTargetRef,
    resolveDisplayableTargetRef,
    resolveStoryLayerRef,
    storyVariableRefKey,
} from "@shared/types/story";
import { formatStorySecondsLabel, storyMsToSeconds } from "@shared/utils/storyTime";
import { translate, translateCommand } from "@/lib/i18n";
import { getPresetPosition } from "@/lib/ui-editor/runtime/game/storyTransformProps";
import { getQuickParams, quickParamText, type QuickParam } from "./storyQuickParamsModel";
import { storyVerbLabelKey } from "./storyVerbVocabulary";
// Two pure tables that happen to live under the story editor: the command taxonomy (the colour unit)
// and the rich-run model (the one description of what an inline chip reads as). Both are data /
// pure functions — nothing in this module renders, mounts or touches a workspace service.
import { getCommandGroup, type StoryCommandGroupId } from "@/apps/workspace/modules/story/scene-editor/storyCommandCategories";
import { isEventRun, isInterpolationRun, isTextRun, segmentToRuns } from "@/apps/workspace/modules/story/scene-editor/richText";
import { storyAppearanceLabel } from "@/apps/workspace/modules/story/scene-editor/storyAppearanceLabel";

/**
 * "What sentence is this row" — one projection, consumed by the story editor and by the Dev Mode
 * timeline / execution context (U4 WI-1).
 *
 * There used to be two: the editor's, assembled across `blockOverview` + `BackgroundBlockPreview` +
 * `RichTextView`, and a weaker re-projection in `storyRuntimeDebugModel` that the M5 card authorised
 * as a stopgap. They disagreed on the rows that matter most — `Enter Nattou` against
 * `character enter · character`, `Set background outside_s.jpg d 5s` against `setBackground` — so the
 * debug panel was quietly a different reading of the same story than the editor beside it.
 *
 * Two couplings had to go before one projection was possible, and both are solved the same way — by
 * taking a *lookup* instead of a service:
 *
 *  - the character name/accent used to arrive as `Character[]`, the workspace service class. Dev Mode
 *    has no such service (only `DevModeCharacterSummary`), so it is now {@link StoryRowLookups.character},
 *    a structural `id → { name, color? }` table both sides can supply;
 *  - a background row's asset NAME needs the asset table, which a pure function cannot reach. It is
 *    {@link StoryRowLookups.assetName}, following the shape `describeBlockSubject` already
 *    established; the Dev Mode bundle now carries an `assetId → name` map so its side can fill it in.
 *
 * React-free on purpose: the editor renders the same fragments as chips and clickable tokens, the
 * timeline flattens them to text, and the projection itself stays unit-testable.
 */

/** A character as the row projection needs it: a display name plus the optional editor accent. */
export type StoryRowCharacter = {
    /** Author-facing name. May be empty (an unnamed character); never an id. */
    name: string;
    /**
     * Editor accent colour, when the surface has one and it is readable.
     *
     * A literal ready for CSS, never the stored value: a profile's accent may be a `nlbrand:` link
     * at the project palette, and both lookups that fill this in resolve it before applying the
     * readability band (`readableAccentColor`). The projection is pure and has no palette to reach.
     */
    color?: string;
};

/** Everything the projection needs from outside the block — lookups only, never a service. */
export type StoryRowLookups = {
    /** The character behind an id, or `null` when the id resolves to nothing. */
    character: (characterId: string) => StoryRowCharacter | null;
    /**
     * The display name of an asset id, or `null` when it is unknown. Omit the whole field when the
     * caller has no asset table at all: an id then prints as itself, which is what `describeBlock`
     * has always done for the list.
     */
    assetName?: (assetId: string) => string | null;
    /**
     * The name of a Story Motion asset, or `null` when it is unknown. Same split as `assetName`: a row
     * stores only the motion's id and the projection is pure. Omit it and a motion row falls back to
     * naming its operation — which is what the Dev Mode timeline does, since its bundle carries no
     * motion index.
     */
    motionName?: (animationId: string) => string | null;
    /**
     * The author-facing name of a pose or tag id on a character, or `null` when it resolves to
     * nothing. Same rule as the two above: without it the appearance is simply not named, because the
     * only other thing the payload holds is an id.
     */
    appearanceName?: (characterId: string, refId: string) => string | null;
    /** The scene the block belongs to — variable, layer and displayable refs resolve against it. */
    scene?: StoryScene;
    /** Every scene in the document: jump targets and cross-scene variable names. */
    scenes?: Record<StorySceneId, StoryScene>;
    /** The story document, used to name the inline interpolation chips a text row carries. */
    document?: StoryDocument;
    /**
     * The author-facing name of a project-level variable declared in the project REGISTRY
     * (`editor/variables.json`) rather than as a story declaration row, or `null` when the id names
     * nothing there.
     *
     * One lookup covers both project scopes because a `StoryVariableRef` already says which scope it
     * is, and each addresses its entry the way the ref carries it: `saved` by entry id, `persistent`
     * by storage key.
     *
     * Optional like the tables above, but with a far sharper consequence: the declaration migration
     * made the registry the ONLY declaration site for saved and persistent variables, so a caller
     * that omits this prints the bare fallback word ("variable") for every one of them — the story
     * itself becoming unreadable rather than a name degrading to an id.
     */
    projectVariableName?: (scope: "saved" | "persistent", variableId: string) => string | null;
};

/**
 * The slice of {@link StoryRowLookups} that naming a variable actually reads.
 *
 * Named rather than spelled out at each signature so a caller can see, from the type alone, that
 * `variableRefShortLabel` needs no characters and no assets — only where declarations live.
 */
export type StoryVariableNameLookups = Pick<StoryRowLookups, "scene" | "scenes" | "projectVariableName">;

/** A lookup that resolves nothing — for call sites with no characters (tests, clipboard of a bare block). */
export const noStoryRowCharacters: StoryRowLookups["character"] = () => null;

/**
 * What the *surface* does with the projection, as opposed to what the block contains.
 *
 * Only one switch so far: a text row with no text falls back to the editor's `Double-click to enter
 * narration` prompt. That prompt is an instruction for the person editing, and a read-only surface —
 * the Dev Mode timeline — has no double-click to offer, so it asks for the empty sentence instead of
 * inheriting an affordance it does not have.
 */
export type StoryRowOptions = {
    /** Default `true` (the editor). `false` leaves an empty text row's sentence empty. */
    editingPlaceholders?: boolean;
};

// --- Text ---------------------------------------------------------------------------------------

export function getStoryTextSegment(block: StoryBlock): StoryTextSegment | null {
    if (block.kind === "note") {
        return block.payload.text;
    }
    if (block.kind !== "nodeAction") {
        return null;
    }
    if ("text" in block.payload) {
        return block.payload.text;
    }
    if ("prompt" in block.payload) {
        return block.payload.prompt ?? null;
    }
    return null;
}

export function getStoryEmptyTextPlaceholder(block: StoryBlock): string {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return translate("story.emptyPlaceholder.narration");
        if (block.payload.action === "choiceOption") return translate("story.emptyPlaceholder.option");
        if (block.payload.action === "choice") return translate("story.emptyPlaceholder.choice");
    }
    if (block.kind === "note") return translate("story.emptyPlaceholder.note");
    return translate("story.emptyPlaceholder.text");
}

/**
 * A text segment as the *reader* sees it: the words, with every inline chip replaced by the label it
 * prints. Deliberately mirrors `renderRunsToElement` run for run — a pause chip shows its seconds
 * (nothing for a click pause), a value chip shows the variable's name, an event chip shows the
 * appearance it switches to *by name* — because "what the row says" has to be the same question in
 * both surfaces.
 *
 * `segment.value` is NOT enough: it is the plain text only, so a line reading `OK {a}` in the editor
 * came out of the old debug projection as `OK`, silently dropping the thing the author put there.
 */
export function storyTextSegmentPlain(segment: StoryTextSegment, lookups: StoryRowLookups): string {
    let out = "";
    for (const run of segmentToRuns(segment)) {
        if (isTextRun(run)) {
            out += run.text;
        } else if (isInterpolationRun(run)) {
            out += interpolationLabel(run.interpolation, lookups);
        } else if (isEventRun(run)) {
            const expression = run.event.expression;
            out += (expression ? storyAppearanceLabel(expression, lookups.appearanceName) : null) ?? "";
        } else {
            out += run.pause === true ? "" : formatStorySecondsLabel(run.pause);
        }
    }
    return out;
}

/**
 * What an inline `{value}` chip prints.
 *
 * Resolved through {@link variableRefShortLabel} rather than through the editor's
 * `resolveInterpolationName`: that one takes each project scope as a LIST, and this call site had no
 * list to hand it — it passed the empty one — so every registry-declared saved and persistent
 * variable came out as the bare fallback word. That sentence is not only read on screen: the story
 * script export writes it to disk.
 */
function interpolationLabel(interpolation: StoryInterpolationRef, lookups: StoryVariableNameLookups): string {
    return interpolation.kind === "variable"
        ? variableRefShortLabel(interpolation.target, lookups)
        : translate("story.describe.blueprint");
}

/** Whether a segment holds anything at all (the editor swaps in a placeholder when it does not). */
function segmentHasValue(segment: StoryTextSegment): boolean {
    return Boolean(segment.value) || Boolean(segment.rich && segment.rich.length > 0);
}

// --- Names --------------------------------------------------------------------------------------

export function getStorySceneName(scenes: Record<StorySceneId, StoryScene> | undefined, sceneId: string | undefined): string {
    if (!sceneId) {
        return translate("story.describe.sceneUnassigned");
    }
    return scenes?.[sceneId]?.name || translate("story.describe.sceneUnknown");
}

/** The name a row prints for a character id — including the two "there is no name" cases. */
export function storyCharacterName(lookups: StoryRowLookups, characterId: string | undefined): string {
    if (!characterId) {
        return translate("story.characterName.unassigned");
    }
    const character = lookups.character(characterId);
    return character ? character.name : translate("story.characterName.unknown");
}

// --- Containers ---------------------------------------------------------------------------------

export type StoryContainerRole = "condition" | "branch" | "group" | "menu" | "option" | "nvl";

export type StoryContainerHeaderInfo = {
    /** Plain-language pill label shown on the accordion header (proper case, no ALL-CAPS). */
    pill: string;
    /**
     * The command that WRITES this container, when one does — the id, not a word, because the word is
     * the command language's to choose (`story.command.<id>.label`) and only the editor's registry can
     * spell it.
     *
     * Set for the seven containers an author can type into being (`/if` `/repeat` `/until` `/parallel`
     * `/race` `/sequence` `/nvl` `/menu`), and deliberately absent for the four header rows that no
     * line produces: the condition BRANCHES (if / else-if / else, which `/if` scaffolds and the
     * footer's buttons add) and a choice OPTION. Those keep {@link pill} and its prose styling, on the
     * rule the rest of the editor already follows — a row prints a command line only when it IS one,
     * and a header wearing `@否则` would teach a word the parser cannot take back.
     */
    commandId?: string;
    role: StoryContainerRole;
    /** Branch (if / else-if) headers carry an editable condition; else / others do not. */
    hasCondition: boolean;
    /** Counted repeat groups expose an inline repeat count. Never set together with {@link repeatUntil}. */
    repeatTimes?: number;
    /**
     * Conditional repeat groups (`/repeat until=…`) expose the stop condition instead of a count.
     * Which of the two is defined IS the form of the loop - there is no third field saying which,
     * because the payload does not have one either (`until` present selects the conditional form).
     */
    repeatUntil?: StoryConditionRef;
};

/** Header descriptor for a container block - the pill text + which inline editors it exposes. */
export function getStoryContainerHeaderInfo(block: StoryBlock): StoryContainerHeaderInfo | null {
    if (block.kind === "control") {
        const payload = block.payload;
        if (payload.control === "condition") {
            // The container IS the `/if` line: the command builds this block and scaffolds the first
            // branch under it, so this is the row an author's `/if` wrote.
            return { pill: translate("story.containerHeader.condition"), commandId: "if", role: "condition", hasCondition: false };
        }
        if (payload.control === "conditionBranch") {
            const pill = payload.branch === "if"
                ? translate("story.containerHeader.if")
                : payload.branch === "elseIf"
                    ? translate("story.containerHeader.elseIf")
                    : translate("story.containerHeader.else");
            return { pill, role: "branch", hasCondition: payload.branch !== "else" };
        }
        // Not containers, so they have no header at all - they render as ordinary rows.
        if (payload.control === "label" || payload.control === "goto" || payload.control === "break") {
            return null;
        }
        if (payload.control === "repeat") {
            // `until` is what selects the conditional form, so it is read first: a group carrying one
            // is never shown a count, even if a stale `times` survived beside it.
            if (payload.until !== undefined) {
                return {
                    pill: translate("story.containerHeader.repeatUntil"),
                    commandId: "until",
                    role: "group",
                    hasCondition: false,
                    repeatUntil: payload.until,
                };
            }
            return { pill: translate("story.containerHeader.repeat"), commandId: "repeat", role: "group", hasCondition: false, repeatTimes: payload.times ?? 1 };
        }
        if (payload.control === "parallel") {
            return { pill: translate("story.containerHeader.parallel"), commandId: "parallel", role: "group", hasCondition: false };
        }
        if (payload.control === "race") {
            return { pill: translate("story.containerHeader.race"), commandId: "race", role: "group", hasCondition: false };
        }
        return { pill: translate("story.containerHeader.sequence"), commandId: "sequence", role: "group", hasCondition: false };
    }
    if (block.kind === "action" && block.payload.action === "nvl") {
        return { pill: translate("story.containerHeader.nvl"), commandId: "nvl", role: "nvl", hasCondition: false };
    }
    if (block.kind === "nodeAction" && block.payload.action === "choice") {
        return { pill: translate("story.containerHeader.menu"), commandId: "menu", role: "menu", hasCondition: false };
    }
    if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
        return { pill: translate("story.containerHeader.option"), role: "option", hasCondition: false };
    }
    return null;
}

/**
 * The container chain a row sits inside, outermost first, in the editor's own words.
 *
 * Walks `parentId` rather than the engine's frames on purpose: the answer to "where am I" is a fact
 * about the story the author wrote, so it holds for any row (including one that has not run yet) and
 * never has to be reconciled with an engine enum. The visited guard keeps a corrupted `parentId`
 * cycle from hanging the panel.
 */
export function storyContainerChain(scene: StoryScene, blockId: StoryBlockId): { blockId: StoryBlockId; info: StoryContainerHeaderInfo }[] {
    const chain: { blockId: StoryBlockId; info: StoryContainerHeaderInfo }[] = [];
    const seen = new Set<StoryBlockId>();
    let parentId = scene.blocks[blockId]?.parentId ?? null;
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = scene.blocks[parentId];
        if (!parent) {
            break;
        }
        const info = getStoryContainerHeaderInfo(parent);
        if (info) {
            chain.unshift({ blockId: parentId, info });
        }
        parentId = parent.parentId ?? null;
    }
    return chain;
}

// --- Badge + colour ------------------------------------------------------------------------------

/** Stable id of a row's badge — what picks its icon; the label and the colour come with it. */
export type StoryBlockBadgeId =
    | "narration" | "dialogue" | "choice" | "choiceOption"
    | "background" | "character" | "audio" | "variable" | "wait" | "image"
    | "transform" | "displayable" | "text" | "layer" | "video" | "vfx" | "nvl"
    | "blueprint" | "camera" | "effect"
    | "label" | "goto" | "break" | "control" | "jump" | "invalid" | "declaration" | "note";

export type StoryBlockBadge = {
    id: StoryBlockBadgeId;
    labelKey: TranslationKey;
    /**
     * The command GROUP the row files under — the colour unit (see `storyCommandCategories`). `null`
     * only for `invalid`: that row is an error, not another kind of action, and wears the danger hue.
     */
    group: StoryCommandGroupId | null;
};

function badge(id: StoryBlockBadgeId, labelKey: TranslationKey, group: StoryCommandGroupId | null): StoryBlockBadge {
    return { id, labelKey, group };
}

/**
 * The row's badge identity and its colour unit. The icons live with the editor (they are React
 * components); everything that decides *which* badge a row wears is here, so the editor's left-edge
 * bar and the Dev Mode timeline's hue can never come from two different chains of ifs.
 */
export function storyBlockBadge(block: StoryBlock): StoryBlockBadge {
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return badge("narration", "story.badge.narration", "character");
        if (block.payload.action === "dialogue") return badge("dialogue", "story.badge.dialogue", "character");
        if (block.payload.action === "choice") return badge("choice", "story.badge.choice", "flow");
        return badge("choiceOption", "story.badge.choiceOption", "flow");
    }
    if (block.kind === "action") {
        if (block.payload.action === "setBackground") return badge("background", "story.badge.background", "scene");
        if (block.payload.action === "character") return badge("character", "story.badge.character", "character");
        if (block.payload.action === "audio") return badge("audio", "story.badge.audio", "sound");
        if (block.payload.action === "setVariable") return badge("variable", "story.badge.variable", "data");
        if (block.payload.action === "wait") return badge("wait", "story.badge.wait", "flow");
        if (block.payload.action === "image") return badge("image", "story.badge.image", "image");
        if (block.payload.action === "displayable") {
            if (block.payload.operation === "transform") return badge("transform", "story.badge.transform", "image");
            return badge("displayable", "story.badge.displayable", "image");
        }
        if (block.payload.action === "text") return badge("text", "story.badge.text", "text");
        if (block.payload.action === "layer") return badge("layer", "story.badge.layer", "layer");
        if (block.payload.action === "video") return badge("video", "story.badge.video", "video");
        // Its own badge and hue, not the screen-effect one: a vfx is a stage object with a name and a
        // lifetime, while `/blink` is a one-shot the scene plays.
        if (block.payload.action === "vfx") return badge("vfx", "story.badge.vfx", "vfx");
        if (block.payload.action === "nvl") return badge("nvl", "story.badge.nvl", "scene");
        if (block.payload.action === "blueprint") return badge("blueprint", "story.badge.blueprint", "utils");
        // Its own badge, not "Effect": `/camera darken` dims the whole stage and outlives the scene,
        // while `/vignette` is a mask layer inside it. The row has to say which one it is at a glance.
        if (block.payload.action === "camera") return badge("camera", "story.badge.camera", "camera");
        // A screen effect is a property of the scene it happens in (§4.1), so it wears the scene hue;
        // the Sparkles badge is what still tells a `/blink` row apart from a `/bg` row at a glance.
        return badge("effect", "story.badge.effect", "scene");
    }
    if (block.kind === "control") {
        // A label and a goto get their own badges: they read as a destination and a move, and both
        // would otherwise wear the generic "Control" of a container they are not.
        if (block.payload.control === "label") return badge("label", "story.badge.label", "flow");
        if (block.payload.control === "goto") return badge("goto", "story.badge.goto", "flow");
        // Same reasoning as label/goto: a break is an exit, not a container, and the generic
        // "Control" badge would file it beside the group it is trying to leave.
        if (block.payload.control === "break") return badge("break", "story.badge.break", "flow");
        return badge("control", "story.badge.control", "flow");
    }
    if (block.kind === "jump") return badge("jump", "story.badge.jump", "scene");
    if (block.kind === "invalid") return badge("invalid", "story.badge.invalid", null);
    if (block.kind === "declaration") {
        return badge("declaration", `story.badge.declare.${block.payload.scope}` as TranslationKey, "data");
    }
    return badge("note", "story.badge.note", "utils");
}

/** The row's category hue — the badge's tint and the editor's left-edge bar. */
export function storyRowAccentColor(block: StoryBlock): string {
    const group = storyBlockBadge(block).group;
    // Deliberately not a category colour for `invalid`: a build will refuse that row, and it has to
    // read as wrong at a glance rather than as another kind of action.
    return group ? getCommandGroup(group).iconColor : "rgb(var(--nl-danger))";
}

/**
 * The hue a row shows *as a bar*, or `null` for the rows that carry none.
 *
 * Prose keeps zero chrome: narration, dialogue and notes are the text itself, and a colour bar down a
 * page of dialogue is noise rather than a distinction. Everything else — scene, character, sound,
 * flow — earns one. (The editor additionally drops the bar on a dialogue-group continuation row; that
 * is a grouping decision belonging to its reading layer, and the timeline has no groups.)
 */
export function storyRowBarColor(block: StoryBlock): string | null {
    if (block.kind === "note") {
        return null;
    }
    if (block.kind === "nodeAction" && (block.payload.action === "narration" || block.payload.action === "dialogue")) {
        return null;
    }
    return storyRowAccentColor(block);
}

// --- describe -------------------------------------------------------------------------------------

/**
 * Short, user-safe label for a variable reference (never exposes internal ids).
 *
 * v6: the variableId IS a declaration block's id, so the name comes straight off the row - the
 * current scene first, then the rest of the document. This is what made "saved variable += 5" read
 * as `gold += 5`: a row that does not say WHICH variable it touches is a row the author has to open
 * to understand, which fails the first principle.
 */
export function variableRefShortLabel(ref: StoryVariableRef, lookups: StoryVariableNameLookups): string {
    if (ref.scope === "persistent") {
        for (const candidate of Object.values(lookups.scenes ?? {})) {
            for (const block of Object.values(candidate.blocks)) {
                if (block.kind === "declaration" && block.payload.storageKey === ref.variableId) {
                    return block.payload.name;
                }
            }
        }
        // The registry, which since the declaration migration is where persistent variables actually
        // live - a row printing the word "persistent" at its author is the failure this exists to stop.
        return lookups.projectVariableName?.("persistent", ref.variableId)
            ?? translate("story.describe.persistent");
    }
    const inScene = lookups.scene?.blocks[ref.variableId];
    if (inScene?.kind === "declaration") {
        return inScene.payload.name;
    }
    for (const candidate of Object.values(lookups.scenes ?? {})) {
        const block = candidate.blocks[ref.variableId];
        if (block?.kind === "declaration") {
            return block.payload.name;
        }
    }
    // Same story-rows-then-registry order the command line and the compiler resolve a saved name in,
    // so one variable cannot be two things depending on which surface is asking.
    return (ref.scope === "saved" ? lookups.projectVariableName?.("saved", ref.variableId) : null)
        ?? translate("story.describe.variableFallback");
}

/**
 * One-line, id-free summary of a condition - what a `/repeat until` header prints.
 *
 * Deliberately not shared with the editor's own `conditionSummary`: that one is a React component's
 * helper and takes a `t` from the hook, while this module is React-free and reads the active locale
 * through `translate`. The shapes it has to answer for are the same three, and both must stay
 * id-free - a header saying `var_9f3c > 0` is a header the author has to open the inspector to read.
 */
export function storyConditionSummary(
    condition: StoryConditionRef | undefined,
    lookups: StoryVariableNameLookups,
): string {
    if (!condition) {
        return translate("story.condition.summarySet");
    }
    if (condition.kind === "blueprint") {
        return translate("story.condition.summaryGraph");
    }
    if (condition.kind === "expression") {
        // An empty source is the "not filled in yet" state the inspector creates when the author
        // switches a loop to its conditional form, so it reads as a prompt rather than as blank.
        return condition.expression.source.trim() || translate("story.condition.summaryExpression");
    }
    const name = variableRefShortLabel(condition.target, lookups);
    const operator = translate(`story.condition.op${conditionOperatorSuffix(condition.operator)}` as TranslationKey);
    const suffix = condition.operator === "equals" || condition.operator === "notEquals"
        ? ` ${String(condition.value ?? "")}`
        : "";
    return `${name} ${operator}${suffix}`.trim();
}

/** `isTrue` → `IsOn`: the catalog spells these in plain language, not in operator names. */
function conditionOperatorSuffix(operator: Extract<StoryConditionRef, { kind: "variable" }>["operator"]): string {
    switch (operator) {
        case "isTrue": return "IsOn";
        case "isFalse": return "IsOff";
        case "equals": return "Equals";
        case "notEquals": return "NotEquals";
        case "exists": return "Exists";
    }
}

/**
 * How an assignment row reads in the list.
 *
 * `gold = 100` for a constant, and the *shorthand* for the shapes that have one — `/inc gold` rather
 * than `gold = gold + (1)`. The author typed a shorthand; echoing back the desugared form would make
 * the row grow every time they glanced at it and teach them the shorthand does not survive.
 *
 * Recognized structurally rather than from a stored "this was an /inc" flag, so a `/set gold gold + 1`
 * typed longhand reads as an increment too — it *is* one.
 *
 * This mirrors `describeAssignment` in `storySceneProjection`, which formats the same block for the
 * text projection.
 */
function describeAssignment(payload: Extract<StoryActionPayload, { action: "setVariable" }>, name: string): string {
    const ast = payload.expression?.ast;
    if (!ast) {
        return `${name} = ${String(payload.value)}`;
    }
    const targetKey = storyVariableRefKey(payload.target);
    const readsTarget = (node: StoryExpr) => node.kind === "var" && storyVariableRefKey(node.target) === targetKey;

    if (ast.kind === "unary" && ast.op === "!" && readsTarget(ast.operand)) {
        return `${name} = !${name}`;
    }
    if (ast.kind === "binary" && (ast.op === "+" || ast.op === "-") && readsTarget(ast.left)) {
        const step = ast.right.kind === "literal" ? String(ast.right.value) : "…";
        return `${name} ${ast.op}= ${step}`;
    }
    return `${name} = ${payload.expression?.source ?? ""}`;
}

type StagePlacement = "left" | "center" | "right";

/**
 * `xalign → the `at=` word that lands there`, derived from {@link getPresetPosition} — the one forward
 * table for `left/center/right → xalign` — rather than restating its numbers, which would let the two
 * drift and leave this summary quietly naming the wrong side. An xalign no word produces is absent
 * from the table, and the row reads as its raw aligns instead.
 */
const CAMERA_PAN_PLACEMENTS: Record<number, StagePlacement> = (["left", "center", "right"] as const)
    .reduce<Record<number, StagePlacement>>((table, placement) => {
        const xalign = getPresetPosition(placement, {})?.xalign;
        if (xalign !== undefined) {
            table[xalign] = placement;
        }
        return table;
    }, {});

/**
 * The `at=` word a stored camera position lands on, or `null` when it sits somewhere no word names.
 *
 * Exported because two readings of the same row need it — this module's prose summary and the
 * command-line projection that reads the row back as `/camera pan left`. A second copy of the table
 * would be a second answer to "which side is this".
 */
export function storyCameraPanPlacement(position: Extract<StoryActionPayload, { action: "camera" }>["position"]): StagePlacement | null {
    const xalign = position?.xalign ?? 0.5;
    const yalign = position?.yalign ?? 0.5;
    if (yalign !== 0.5 || position?.xoffset || position?.yoffset) {
        return null;
    }
    return CAMERA_PAN_PLACEMENTS[xalign] ?? null;
}

/**
 * How a camera row reads: the operation plus the one value it carries. The verb is NOT repeated from
 * the badge, but the knob is named ("Zoom ×1.5", not "×1.5"), because five operations share one badge.
 */
function describeCamera(
    payload: Extract<StoryActionPayload, { action: "camera" }>,
    motionName?: StoryRowLookups["motionName"],
): string {
    const operation = translate(`story.describe.cameraOp.${payload.operation}` as TranslationKey);
    if (payload.operation === "motion") {
        // The bound motion IS the content of this row; several `/camera motion` rows in a scene are
        // otherwise all just "Motion".
        const animationId = payload.motion?.animationId;
        const name = animationId ? motionName?.(animationId) : undefined;
        return name ? `${operation} ${name}` : operation;
    }
    if (payload.operation === "zoom") {
        return `${operation} ×${payload.zoom ?? 1}`;
    }
    if (payload.operation === "rotate") {
        return `${operation} ${payload.rotation ?? 0}°`;
    }
    if (payload.operation === "darken") {
        return `${operation} ${Math.round(Math.min(1, Math.max(0, payload.darkness ?? 0)) * 100)}%`;
    }
    if (payload.operation === "pan") {
        const xalign = payload.position?.xalign ?? 0.5;
        const yalign = payload.position?.yalign ?? 0.5;
        const placement = storyCameraPanPlacement(payload.position);
        return `${operation} ${placement ? translate(`story.position.${placement}`) : `${Math.round(xalign * 100)}% · ${Math.round(yalign * 100)}%`}`;
    }
    return operation;
}

/**
 * The base sentence of a block — the verb's object and modifiers, without the quick-param tokens.
 *
 * Asset ids resolve to names when {@link StoryRowLookups.assetName} is supplied. Without it a row can
 * say `Set background 4b645b59-…` because the *payload* stores an id; that is tolerable in a list
 * where a background row also paints the picture, and unacceptable as a panel heading — hence the
 * resolver being the caller's to provide rather than a service reached from in here.
 */
/**
 * The verb word a row leads with: the name of the command that would produce it, in the COMMAND
 * language, falling back to `whenUnowned` for the operations no command owns.
 *
 * Vocabulary, not prose — so it follows `editor.localizedCommands` and not the interface language,
 * and it comes from `story.command.<id>.label`, the same string the action creator's menu, the
 * command manual and the parser's localized token table all read. That shared source is the point:
 * the author typed "隐藏", so the row says "隐藏". It used to say "退场".
 */
function verbWord(payload: StoryActionPayload, whenUnowned: string): string {
    const key = storyVerbLabelKey(payload);
    return key === null ? whenUnowned : translateCommand(key);
}

export function describeStoryBlock(block: StoryBlock, lookups: StoryRowLookups): string {
    const { scene, scenes } = lookups;
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "narration") return payload.text.value || translate("story.describe.narration");
        if (payload.action === "dialogue") return `${storyCharacterName(lookups, payload.characterId)}: ${payload.text.value || translate("story.describe.dialogue")}`;
        if (payload.action === "choice") return `${translate("story.describe.choice")}${payload.prompt?.value ? ` - ${payload.prompt.value}` : ""}`;
        return `${translate("story.describe.option")} ${payload.text.value || ""}`;
    }
    if (block.kind === "action") {
        const payload = block.payload;
        if (payload.action === "setBackground") {
            const named = payload.assetId
                ? (lookups.assetName ? lookups.assetName(payload.assetId) ?? translate("story.background.missingImage") : payload.assetId)
                : null;
            return translate("story.describe.setBackground", {
                value: named ?? payload.color ?? translate("story.describe.unassigned"),
            });
        }
        if (payload.action === "character") {
            const name = payload.characterId ? storyCharacterName(lookups, payload.characterId) : (payload.objectName || translate("story.describe.characterFallback"));
            // The command's own name ("Hide Alice"), so the row reads back the word the author typed.
            // `charOp` survives only as the fallback for an operation no command owns.
            const operation = verbWord(payload, translate(`story.describe.charOp.${payload.operation}` as TranslationKey));
            // A rename's whole content is the new label, so the row shows it - "Rename Stranger" would
            // say nothing about what the player is about to read.
            if (payload.operation === "setName") {
                return `${operation} ${name} → ${payload.displayName || translate("story.describe.unnamed")}`;
            }
            // A puppet state row's whole content is the name it requests, and the blank case is not a
            // gap but the meaning: no request, so the model rests.
            if (payload.operation === "setMotion" || payload.operation === "setSkin" || (payload.operation === "expression" && payload.puppetName !== undefined)) {
                return `${operation} ${name} → ${payload.puppetName?.trim() || translate("story.describe.puppetNone")}`;
            }
            // A parameter row's content is a map. The first entry reads in full and the rest are
            // counted: a head turn is three parameters, and printing all three would push the
            // character's own name out of a one-line row.
            if (payload.operation === "setParams") {
                const entries = Object.entries(payload.params ?? {});
                const [first] = entries;
                if (!first) {
                    return `${operation} ${name} → ${translate("story.describe.puppetNone")}`;
                }
                const more = entries.length > 1 ? ` +${entries.length - 1}` : "";
                return `${operation} ${name} → ${first[0]} ${first[1]}${more}`;
            }
            return `${operation} ${name}`;
        }
        if (payload.action === "audio") {
            const named = payload.assetId && lookups.assetName
                ? lookups.assetName(payload.assetId) ?? translate("story.describe.missingAsset")
                : null;
            // `{operation}` used to interpolate the raw enum, so a Chinese author read "setBgm piano".
            return `${verbWord(payload, payload.operation)} ${payload.objectName || named || payload.assetId || translate("story.describe.unassigned")}`;
        }
        if (payload.action === "setVariable") return describeAssignment(payload, variableRefShortLabel(payload.target, lookups));
        if (payload.action === "wait") return payload.mode === "duration" ? translate("story.describe.waitDuration", { seconds: storyMsToSeconds(payload.durationMs ?? 0) }) : translate("story.describe.waitClick");
        if (payload.action === "image") return translate("story.describe.image", { operation: verbWord(payload, payload.operation), name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "displayable") return `${verbWord(payload, payload.operation)} ${resolveDisplayableTargetRef(scene, payload.target).label || translate("story.describe.targetFallback")}`;
        if (payload.action === "text") return translate("story.describe.text", { operation: verbWord(payload, payload.operation), name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "layer") {
            const layerName = payload.operation === "create"
                ? (payload.objectName || translate("story.describe.unnamed"))
                : (resolveStoryLayerRef(scene, layerActionTargetRef(payload.target, payload.objectName)).name || translate("story.describe.unnamed"));
            return translate("story.describe.layer", { operation: verbWord(payload, payload.operation), name: layerName });
        }
        if (payload.action === "video") return translate("story.describe.video", { operation: verbWord(payload, payload.operation), name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "vfx") return translate("story.describe.vfx", { operation: verbWord(payload, payload.operation), name: payload.objectName || translate("story.describe.unnamed") });
        if (payload.action === "nvl") return translate("story.describe.nvl");
        if (payload.action === "blueprint") return translate("story.describe.blueprint");
        if (payload.action === "camera") return describeCamera(payload, lookups.motionName);
        return translate("story.describe.effect", { effect: payload.effect });
    }
    if (block.kind === "control") {
        if (block.payload.control === "condition") return translate("story.describe.condition");
        if (block.payload.control === "conditionBranch") return translate("story.describe.branch", { branch: block.payload.branch });
        // The name IS the row: a label row saying only "Label" would leave the author counting rows
        // to find which one a goto points at.
        if (block.payload.control === "label") return translate("story.describe.label", { name: block.payload.name || translate("story.describe.unnamed") });
        if (block.payload.control === "goto") return translate("story.describe.goto", { name: block.payload.targetLabel || translate("story.describe.unnamed") });
        if (block.payload.control === "break") return translate("story.describe.break");
        return block.payload.control;
    }
    if (block.kind === "jump") {
        return translate("story.describe.jump", { scene: getStorySceneName(scenes, block.payload.targetSceneId) });
    }
    if (block.kind === "invalid") {
        // The author's own text is the most useful thing to show them - it never parsed, so there is
        // nothing to describe in its place.
        return block.payload.source || translate("story.describe.invalid");
    }
    if (block.kind === "declaration") {
        // The row reads as what it declares: `gold: number = 100`. The scope arrives via the badge.
        return describeDeclaration(block);
    }
    return block.payload.text.value || translate("story.describe.note");
}

// --- The row itself -------------------------------------------------------------------------------

/**
 * One piece of a row's sentence: either a run of plain text, or a quick-edit param.
 *
 * The tokens ARE fragments in the same stream, not a second layer appended to a finished string —
 * which is why `Set background outside_s.jpg d 5s` is one sentence in the editor and has to be one
 * sentence in the timeline too.
 */
export type StoryRowFragment =
    | { kind: "text"; text: string }
    | { kind: "quick"; param: QuickParam };

/** The bare verb labels a token replaces; overridable so a React caller can use its own `t`. */
export type StoryRowLabel = (key: "story.quickParam.jumpLabel" | "story.quickParam.waitLabel") => string;

const defaultRowLabel: StoryRowLabel = key => translate(key);

/**
 * The fragment stream a committed *action* row reads as: `[target · modifiers]` with the quick-edit
 * params spliced in.
 *
 * Keyed on payload shape, not a command spec: a committed block carries no command id (bible B11 —
 * no reverse edit) and generic verbs make payload→spec many-to-one, so a payload-shape projection is
 * the honest home — the same shape `describeStoryBlock` / `storyBlockBadge` / `getQuickParams` take.
 */
export function storyActionRowFragments(
    block: StoryBlock,
    lookups: StoryRowLookups,
    label: StoryRowLabel = defaultRowLabel,
): StoryRowFragment[] {
    const params = getQuickParams(block);
    // The bare verb label replaces the description only when a token actually prints the value, or it
    // would show twice. A click-mode `/wait` owns no token, so it keeps its full "Wait for click" text.
    const valueInToken = params.length > 0 && ((block.kind === "action" && block.payload.action === "wait") || block.kind === "jump");
    const base = !valueInToken
        ? describeStoryBlock(block, lookups)
        : block.kind === "jump"
            ? label("story.quickParam.jumpLabel")
            : label("story.quickParam.waitLabel");
    const fragments: StoryRowFragment[] = [];
    if (base) {
        fragments.push({ kind: "text", text: base });
    }
    for (const param of params) {
        fragments.push({ kind: "quick", param });
    }
    return fragments;
}

/**
 * The whole row as the author reads it, in the same order the editor lays it out.
 *
 * The dispatch mirrors the editor's row renderer exactly, because that is the point — a container
 * leads with its plain-language pill, a text row is its rich text (chips and all), a background row
 * names its asset, and everything else is the action fragment stream above. A dialogue row's speaker
 * is NOT included here: the editor draws it as a nametag on its own line, so the caller decides
 * whether to prefix it (the timeline does, having no room for two lines).
 */
export function storyRowFragments(
    block: StoryBlock,
    lookups: StoryRowLookups,
    label: StoryRowLabel = defaultRowLabel,
    options: StoryRowOptions = {},
): StoryRowFragment[] {
    const fragments: StoryRowFragment[] = [];
    const container = getStoryContainerHeaderInfo(block);
    if (container) {
        fragments.push({ kind: "text", text: container.pill });
        if (container.repeatTimes !== undefined) {
            fragments.push({ kind: "text", text: `${container.repeatTimes} ${translate("story.repeat.times")}` });
        }
        if (container.repeatUntil !== undefined) {
            fragments.push({ kind: "text", text: storyConditionSummary(container.repeatUntil, lookups) });
        }
    }
    const segment = getStoryTextSegment(block);
    if (segment) {
        const placeholder = options.editingPlaceholders === false ? "" : getStoryEmptyTextPlaceholder(block);
        fragments.push({
            kind: "text",
            text: segmentHasValue(segment) ? storyTextSegmentPlain(segment, lookups) : placeholder,
        });
        return fragments;
    }
    if (container) {
        return fragments;
    }
    return storyActionRowFragments(block, lookups, label);
}

/** The dialogue speaker of a row, or `null` when it has none. */
export function storyRowSpeaker(block: StoryBlock, lookups: StoryRowLookups): StoryRowCharacter | null {
    if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
        return null;
    }
    const payload = block.payload;
    if (payload.characterId) {
        const character = lookups.character(payload.characterId);
        if (character) {
            return character;
        }
        return { name: payload.speakerName || translate("story.characterName.unknown") };
    }
    return { name: payload.speakerName || translate("story.characterName.unassigned") };
}

/**
 * The row as one line of plain text: the fragments joined by a single space.
 *
 * A space rather than nothing because the fragments are separate boxes on screen — the editor puts a
 * flex gap between the description and each token — so "one space between fragments" is what the eye
 * already reads there.
 */
export function storyRowSentence(block: StoryBlock, lookups: StoryRowLookups, options: StoryRowOptions = {}): string {
    const sceneName = (id: string | undefined) => (id ? lookups.scenes?.[id]?.name || id : "—");
    return storyRowFragments(block, lookups, defaultRowLabel, options)
        .map(fragment => (fragment.kind === "text" ? fragment.text : quickParamText(fragment.param, sceneName)))
        .filter(text => text.length > 0)
        .join(" ");
}

export type StoryRowProjection = {
    /** The row's sentence, exactly as the editor reads it, minus the dialogue nametag. */
    sentence: string;
    /** The dialogue speaker, when there is one. */
    speaker: StoryRowCharacter | null;
    /** The category hue the editor bars this row with, or `null` for the prose rows that carry none. */
    barColor: string | null;
    /** The container pill, when this row opens a container. */
    containerPill: string | null;
};

/** Everything a surface needs to draw one row, from one pass over the block. */
export function projectStoryRow(block: StoryBlock, lookups: StoryRowLookups, options: StoryRowOptions = {}): StoryRowProjection {
    return {
        sentence: storyRowSentence(block, lookups, options),
        speaker: storyRowSpeaker(block, lookups),
        barColor: storyRowBarColor(block),
        containerPill: getStoryContainerHeaderInfo(block)?.pill ?? null,
    };
}
