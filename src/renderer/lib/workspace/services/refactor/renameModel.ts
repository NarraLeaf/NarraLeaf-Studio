import {
    APP_TAG_EXPR_KEYWORD,
    collectStoryExpressionVariables,
    listSceneBlocksInDocumentOrder,
    listSceneDeclarationBlocks,
    listScenesInDocumentOrder,
    storyRowAssignedVariable,
    storyVariableRefKey,
    type StoryBlock,
    type StoryBlockId,
    type StoryConditionRef,
    type StoryDocument,
    type StoryExpression,
    type StoryId,
    type StoryScene,
    type StorySceneId,
    type StoryTextSegment,
    type StoryVariableRef,
} from "@shared/types/story";
import type { BlueprintDocument, BlueprintGraphNode } from "@shared/types/blueprint/document";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { renameInStoryExpression, type StoryExpressionRenameTarget } from "@shared/utils/storyExpressionRename";
import type { SearchJumpTarget } from "../search/searchJumpTarget";

/**
 * Rename refactor and find-references: the pure model.
 *
 * # What a rename has to rewrite
 *
 * Almost nothing in a story names a thing by its name. A variable is read through `StoryVariableRef`
 * (an id), a scene is jumped to by id, a character is spoken by id, a blueprint node holds a variable
 * id in a param. All of those follow a rename on their own, and the plan lists them as
 * {@link RenamePlan.followers} so the author sees them without being asked to approve a change that is
 * not one.
 *
 * What does carry a name, and is rewritten here:
 *
 *  - the declaration itself (a `/local` row, a legacy `/save` `/global` row, a registry entry, a
 *    `/label` row, the scene record, the character record);
 *  - every stored expression's source text - the `gold` in `/if gold >= 100`, the `Corridor` in
 *    `visited(Corridor)` - together with the display name on the tree's node
 *    (`storyExpressionRename.ts` does the token work);
 *  - `/goto` rows, which address a label by its exact name;
 *  - dialogue rows that speak as a bare name equal to a renamed character's name (offered, because
 *    such a row is not bound to the character).
 *
 * Translation units are keyed by text id and interpolations travel as positional `{n}` placeholders,
 * so localization keys hold no variable, scene, label or character name and need no rewrite.
 *
 * # Known and not covered
 *
 *  - A script-layer blueprint's source is not read, so a variable it names by string is not found.
 *  - An `invalid` expression subtree (one that never resolved) is kept as the author's raw text; it
 *    references nothing, so it is neither counted nor rewritten.
 *  - Text inside dialogue prose is prose: a line that says "gold" is not a reference to `gold`.
 */

export type RenameStory = { id: StoryId; name: string; document: StoryDocument };

export type ReferenceAccess = "declaration" | "read" | "write";

/** Where in a row (or outside one) a reference sits. Names its label in the interface. */
export type ReferenceSlot =
    | "declaration"
    | "registry"
    | "assignTarget"
    | "assignValue"
    | "inputTarget"
    | "pageTarget"
    | "condition"
    | "loopCondition"
    | "hiddenWhen"
    | "disabledWhen"
    | "text"
    | "label"
    | "goto"
    | "sceneName"
    | "characterName"
    | "speaker"
    | "blueprintNode";

export type ReferenceSite = {
    /** Stable unique key: React key and the edit's identity. */
    id: string;
    access: ReferenceAccess;
    slot: ReferenceSlot;
    storyId?: StoryId;
    storyName?: string;
    sceneId?: StorySceneId;
    sceneName?: string;
    blockId?: StoryBlockId;
    /** The row's 1-based position in its scene, in document order. */
    line?: number;
    /** What the site says, for the list: an expression's source, a label's name. */
    excerpt?: string;
    blueprintName?: string;
    target?: SearchJumpTarget;
};

// ── Slots of one row ────────────────────────────────────────────────────────────────────────────

type ExpressionSlot = {
    key: string;
    slot: ReferenceSlot;
    expression: StoryExpression;
    /** The payload with this one expression replaced. */
    write: (payload: StoryBlock["payload"], next: StoryExpression) => StoryBlock["payload"];
};

type RefSlot = { slot: ReferenceSlot; access: "read" | "write"; ref: StoryVariableRef };

function conditionSlots(
    condition: StoryConditionRef | undefined,
    key: string,
    slot: ReferenceSlot,
    write: (payload: StoryBlock["payload"], next: StoryConditionRef) => StoryBlock["payload"],
    expressions: ExpressionSlot[],
    refs: RefSlot[],
): void {
    if (!condition) {
        return;
    }
    if (condition.kind === "variable") {
        refs.push({ slot, access: "read", ref: condition.target });
    } else if (condition.kind === "expression") {
        expressions.push({
            key,
            slot,
            expression: condition.expression,
            write: (payload, next) => write(payload, { kind: "expression", expression: next }),
        });
    }
}

function segmentSlots(
    segment: StoryTextSegment | undefined,
    key: string,
    write: (payload: StoryBlock["payload"], next: StoryTextSegment) => StoryBlock["payload"],
    read: (payload: StoryBlock["payload"]) => StoryTextSegment | undefined,
    expressions: ExpressionSlot[],
    refs: RefSlot[],
): void {
    (segment?.rich ?? []).forEach((run, index) => {
        if (!("interpolation" in run)) {
            return;
        }
        const interpolation = run.interpolation;
        if (interpolation.kind === "variable") {
            refs.push({ slot: "text", access: "read", ref: interpolation.target });
        } else if (interpolation.kind === "expression") {
            expressions.push({
                key: `${key}:${index}`,
                slot: "text",
                expression: interpolation.expression,
                write: (payload, next) => {
                    const live = read(payload);
                    const rich = [...(live?.rich ?? [])];
                    const current = rich[index];
                    if (!live || !current || !("interpolation" in current) || current.interpolation.kind !== "expression") {
                        return payload;
                    }
                    rich[index] = { ...current, interpolation: { kind: "expression", expression: next } };
                    return write(payload, { ...live, rich });
                },
            });
        }
    });
}

/**
 * Every place one row holds an expression or a variable id, in the slots the lint's
 * `collectVariableUses` walks (and the compiler compiles): assignments, `into=` targets, conditions,
 * loop conditions, option guards and inline interpolations, notes included.
 */
export function blockReferenceSlots(block: StoryBlock): { expressions: ExpressionSlot[]; refs: RefSlot[] } {
    const expressions: ExpressionSlot[] = [];
    const refs: RefSlot[] = [];
    switch (block.kind) {
        case "action": {
            const payload = block.payload;
            const written = storyRowAssignedVariable(block);
            if (written) {
                refs.push({
                    slot: payload.action === "setVariable" ? "assignTarget" : payload.action === "page" ? "pageTarget" : "inputTarget",
                    access: "write",
                    ref: written,
                });
            }
            if (payload.action === "setVariable" && payload.expression) {
                expressions.push({
                    key: "value",
                    slot: "assignValue",
                    expression: payload.expression,
                    write: (live, next) => ({ ...live, expression: next }) as StoryBlock["payload"],
                });
            }
            break;
        }
        case "nodeAction": {
            const payload = block.payload;
            if (payload.action === "choice") {
                segmentSlots(
                    payload.prompt,
                    "prompt",
                    (live, next) => ({ ...live, prompt: next }) as StoryBlock["payload"],
                    live => (live as { prompt?: StoryTextSegment }).prompt,
                    expressions,
                    refs,
                );
            } else {
                segmentSlots(
                    payload.text,
                    "text",
                    (live, next) => ({ ...live, text: next }) as StoryBlock["payload"],
                    live => (live as { text?: StoryTextSegment }).text,
                    expressions,
                    refs,
                );
            }
            if (payload.action === "choiceOption") {
                conditionSlots(payload.hiddenWhen, "hiddenWhen", "hiddenWhen",
                    (live, next) => ({ ...live, hiddenWhen: next }) as StoryBlock["payload"], expressions, refs);
                conditionSlots(payload.disabledWhen, "disabledWhen", "disabledWhen",
                    (live, next) => ({ ...live, disabledWhen: next }) as StoryBlock["payload"], expressions, refs);
            }
            break;
        }
        case "control": {
            const payload = block.payload;
            if (payload.control === "conditionBranch") {
                conditionSlots(payload.condition, "condition", "condition",
                    (live, next) => ({ ...live, condition: next }) as StoryBlock["payload"], expressions, refs);
            } else if (payload.control === "repeat") {
                conditionSlots(payload.until, "until", "loopCondition",
                    (live, next) => ({ ...live, until: next }) as StoryBlock["payload"], expressions, refs);
            }
            break;
        }
        case "note":
            segmentSlots(
                block.payload.text,
                "text",
                (live, next) => ({ ...live, text: next }) as StoryBlock["payload"],
                live => (live as { text?: StoryTextSegment }).text,
                expressions,
                refs,
            );
            break;
        default:
            break;
    }
    return { expressions, refs };
}

// ── Walking ─────────────────────────────────────────────────────────────────────────────────────

type RowVisit = { story: RenameStory; scene: StoryScene; block: StoryBlock; line: number };

/**
 * Every row of every scene, disabled ones included: a rename that skipped a disabled row would leave
 * it broken the day the author enables it again.
 */
function eachRow(stories: readonly RenameStory[], onlyScene?: { storyId: StoryId; sceneId: StorySceneId }): RowVisit[] {
    const rows: RowVisit[] = [];
    for (const story of stories) {
        if (onlyScene && story.id !== onlyScene.storyId) {
            continue;
        }
        for (const scene of listScenesInDocumentOrder(story.document)) {
            if (!scene || (onlyScene && scene.id !== onlyScene.sceneId)) {
                continue;
            }
            listSceneBlocksInDocumentOrder(scene).forEach((block, index) => {
                rows.push({ story, scene, block, line: index + 1 });
            });
        }
    }
    return rows;
}

function rowSite(visit: RowVisit, partial: Omit<ReferenceSite, "storyId" | "storyName" | "sceneId" | "sceneName" | "blockId" | "line" | "target">): ReferenceSite {
    return {
        ...partial,
        storyId: visit.story.id,
        storyName: visit.story.name,
        sceneId: visit.scene.id,
        sceneName: visit.scene.name,
        blockId: visit.block.id,
        line: visit.line,
        target: {
            kind: "storyBlock",
            storyId: visit.story.id,
            sceneId: visit.scene.id,
            blockId: visit.block.id,
            storyName: visit.story.name,
            sceneName: visit.scene.name,
        },
    };
}

// ── Variables ───────────────────────────────────────────────────────────────────────────────────

/** Where a variable is declared, which decides how its name is written and how far its reads reach. */
export type VariableDeclaration =
    | { source: "registry"; entryId: string }
    | { source: "story"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId };

export type VariableSubject = {
    kind: "variable";
    ref: StoryVariableRef;
    name: string;
    declaration: VariableDeclaration;
};

/** The project-scoped identities a ref may also be stored under (a registry entry's storage key). */
function refAliases(ref: StoryVariableRef, registry: readonly VariableRegistryEntry[]): Set<string> {
    const keys = new Set([storyVariableRefKey(ref)]);
    for (const entry of registry) {
        if (entry.scope !== ref.scope || (entry.id !== ref.variableId && entry.storageKey !== ref.variableId)) {
            continue;
        }
        keys.add(storyVariableRefKey({ scope: ref.scope, variableId: entry.id } as StoryVariableRef));
        keys.add(storyVariableRefKey({ scope: ref.scope, variableId: entry.storageKey } as StoryVariableRef));
    }
    return keys;
}

const BLUEPRINT_VARIABLE_PARAMS: Record<StoryVariableRef["scope"], string> = {
    scene: "sceneVariableId",
    saved: "savedVariableId",
    persistent: "persistentVariableId",
};

function* eachBlueprintNode(document: BlueprintDocument | null | undefined): Generator<{
    blueprintId: string;
    blueprintName: string;
    graphKind: "events" | "functions" | "macros";
    graphId: string;
    node: BlueprintGraphNode;
}> {
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        if (!blueprint) {
            continue;
        }
        const graphs = blueprint.graphs as unknown as Record<string, Record<string, { graph?: { nodes?: Record<string, BlueprintGraphNode> } }> | undefined>;
        for (const graphKind of ["events", "functions", "macros"] as const) {
            for (const [graphId, carrier] of Object.entries(graphs?.[graphKind] ?? {})) {
                for (const node of Object.values(carrier?.graph?.nodes ?? {})) {
                    if (node) {
                        yield { blueprintId: blueprint.id, blueprintName: blueprint.name ?? "", graphKind, graphId, node };
                    }
                }
            }
        }
    }
}

export type VariableReferenceInput = {
    stories: readonly RenameStory[];
    ref: StoryVariableRef;
    /** For a scene variable, the one scene its reads can reach. */
    declaration?: VariableDeclaration;
    registry?: readonly VariableRegistryEntry[];
    blueprints?: BlueprintDocument | null;
};

/**
 * Every place that reads or writes a variable, with its declaration first.
 *
 * Reads and writes are told apart the way the rest of Studio tells them: a write is what
 * `storyRowAssignedVariable` answers (assignments, `into=` of a wait or a page) or a blueprint
 * `*.set` node; everything else that names the variable reads it.
 */
export function collectVariableReferences(input: VariableReferenceInput): ReferenceSite[] {
    const { stories, ref, declaration, registry = [], blueprints } = input;
    const keys = refAliases(ref, registry);
    const matches = (candidate: StoryVariableRef) => keys.has(storyVariableRefKey(candidate));
    const sites: ReferenceSite[] = [];
    const onlyScene = ref.scope === "scene" && declaration?.source === "story"
        ? { storyId: declaration.storyId, sceneId: declaration.sceneId }
        : undefined;

    if (declaration?.source === "registry") {
        sites.push({ id: `registry:${declaration.entryId}`, access: "declaration", slot: "registry" });
    }

    for (const visit of eachRow(stories, onlyScene)) {
        const { block } = visit;
        if (block.kind === "declaration") {
            if (declaration?.source === "story" && block.id === declaration.blockId && visit.story.id === declaration.storyId) {
                sites.push(rowSite(visit, { id: `${visit.story.id}/${block.id}/declaration`, access: "declaration", slot: "declaration", excerpt: block.payload.name }));
            }
            continue;
        }
        const { expressions, refs } = blockReferenceSlots(block);
        refs.forEach((slot, index) => {
            if (matches(slot.ref)) {
                sites.push(rowSite(visit, { id: `${visit.story.id}/${block.id}/ref:${slot.slot}:${index}`, access: slot.access, slot: slot.slot }));
            }
        });
        for (const slot of expressions) {
            if (collectStoryExpressionVariables(slot.expression.ast).some(matches)) {
                sites.push(rowSite(visit, {
                    id: `${visit.story.id}/${block.id}/expr:${slot.key}`,
                    access: "read",
                    slot: slot.slot,
                    excerpt: slot.expression.source,
                }));
            }
        }
    }

    const param = BLUEPRINT_VARIABLE_PARAMS[ref.scope];
    const ids = new Set([...keys].map(key => key.slice(key.indexOf(":") + 1)));
    const ownerKeys = new Map<string, string>();
    for (const [ownerKey, record] of Object.entries(blueprints?.ownerRecords ?? {})) {
        if (record?.blueprintId) {
            ownerKeys.set(record.blueprintId, ownerKey);
        }
    }
    for (const { blueprintId, blueprintName, graphKind, graphId, node } of eachBlueprintNode(blueprints)) {
        const value = node.params?.[param];
        if (typeof value !== "string" || !ids.has(value.trim())) {
            continue;
        }
        const ownerKey = ownerKeys.get(blueprintId);
        sites.push({
            id: `bp/${blueprintId}/${node.id}`,
            access: node.type.endsWith(".set") ? "write" : "read",
            slot: "blueprintNode",
            blueprintName,
            excerpt: node.type,
            ...(ownerKey ? {
                target: {
                    kind: "blueprint",
                    blueprintId,
                    ownerKey,
                    ...(graphKind === "events" ? { focusEventId: graphId } : graphKind === "functions" ? { focusFunctionId: graphId } : {}),
                    focusNodeId: node.id,
                },
            } : {}),
        });
    }
    return sites;
}

// ── Plans ───────────────────────────────────────────────────────────────────────────────────────

/** One write the plan will make, with both sides so it can be shown and taken back. */
export type RenameChange =
    | { kind: "blockExpression"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId; key: string; before: StoryExpression; after: StoryExpression }
    | { kind: "declarationName"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId; before: string; after: string }
    | { kind: "labelName"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId; before: string; after: string }
    | { kind: "gotoTarget"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId; before: string; after: string }
    | { kind: "sceneName"; storyId: StoryId; sceneId: StorySceneId; before: string; after: string }
    | { kind: "registryName"; entryId: string; before: string; after: string }
    | { kind: "characterName"; characterId: string; before: string; after: string }
    | { kind: "speakerName"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId; before: string; after: string };

export type RenameEdit = {
    id: string;
    site: ReferenceSite;
    /** What the site reads as now, and after the rename. */
    before: string;
    after: string;
    /** The author's spacing could not be kept; the expression was printed from its tree. */
    reformatted?: boolean;
    change: RenameChange;
    /** Required edits (the declaration itself) cannot be unticked. */
    required?: boolean;
};

export type LabelSubject = { kind: "label"; storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId; name: string };
export type SceneSubject = { kind: "scene"; storyId: StoryId; sceneId: StorySceneId; name: string };
export type CharacterSubject = { kind: "character"; characterId: string; name: string };
export type RenameSubject = VariableSubject | LabelSubject | SceneSubject | CharacterSubject;

export type RenamePlan = {
    subject: RenameSubject;
    newName: string;
    edits: RenameEdit[];
    /** References by id: they follow the rename and are listed, not rewritten. */
    followers: ReferenceSite[];
    /** Expressions that reference the subject and could not be rewritten. Non-empty blocks the apply. */
    failures: ReferenceSite[];
};

function expressionEdits(
    stories: readonly RenameStory[],
    target: StoryExpressionRenameTarget,
    onlyScene: { storyId: StoryId; sceneId: StorySceneId } | undefined,
    plan: Pick<RenamePlan, "edits" | "failures">,
): Set<string> {
    const rewritten = new Set<string>();
    for (const visit of eachRow(stories, onlyScene)) {
        for (const slot of blockReferenceSlots(visit.block).expressions) {
            const result = renameInStoryExpression(slot.expression, target);
            if (result.status === "unchanged") {
                continue;
            }
            const id = `${visit.story.id}/${visit.block.id}/expr:${slot.key}`;
            const site = rowSite(visit, { id, access: "read", slot: slot.slot, excerpt: slot.expression.source });
            if (result.status === "failed") {
                plan.failures.push(site);
                continue;
            }
            rewritten.add(id);
            plan.edits.push({
                id,
                site,
                before: slot.expression.source,
                after: result.expression.source,
                ...(result.reformatted ? { reformatted: true } : {}),
                change: {
                    kind: "blockExpression",
                    storyId: visit.story.id,
                    sceneId: visit.scene.id,
                    blockId: visit.block.id,
                    key: slot.key,
                    before: slot.expression,
                    after: result.expression,
                },
            });
        }
    }
    return rewritten;
}

export function planVariableRename(input: {
    subject: VariableSubject;
    newName: string;
    stories: readonly RenameStory[];
    registry?: readonly VariableRegistryEntry[];
    blueprints?: BlueprintDocument | null;
}): RenamePlan {
    const { subject, stories } = input;
    const newName = input.newName.trim();
    const plan: RenamePlan = { subject, newName, edits: [], followers: [], failures: [] };
    const declaration = subject.declaration;

    if (declaration.source === "registry") {
        plan.edits.push({
            id: `registry:${declaration.entryId}`,
            site: { id: `registry:${declaration.entryId}`, access: "declaration", slot: "registry" },
            before: subject.name,
            after: newName,
            required: true,
            change: { kind: "registryName", entryId: declaration.entryId, before: subject.name, after: newName },
        });
    } else {
        const story = stories.find(entry => entry.id === declaration.storyId);
        const scene = story?.document.scenes[declaration.sceneId];
        const block = scene?.blocks[declaration.blockId];
        if (story && scene && block?.kind === "declaration") {
            const line = listSceneBlocksInDocumentOrder(scene).findIndex(row => row.id === block.id) + 1;
            const site = rowSite({ story, scene, block, line }, {
                id: `${story.id}/${block.id}/declaration`,
                access: "declaration",
                slot: "declaration",
                excerpt: block.payload.name,
            });
            plan.edits.push({
                id: site.id,
                site,
                before: block.payload.name,
                after: newName,
                required: true,
                change: { kind: "declarationName", storyId: story.id, sceneId: scene.id, blockId: block.id, before: block.payload.name, after: newName },
            });
        }
    }

    const onlyScene = subject.ref.scope === "scene" && declaration.source === "story"
        ? { storyId: declaration.storyId, sceneId: declaration.sceneId }
        : undefined;
    const rewritten = expressionEdits(stories, { kind: "variable", ref: subject.ref, newName }, onlyScene, plan);

    plan.followers = collectVariableReferences({
        stories,
        ref: subject.ref,
        declaration,
        registry: input.registry,
        blueprints: input.blueprints,
    }).filter(site => site.access !== "declaration" && !rewritten.has(site.id) && !plan.failures.some(failure => failure.id === site.id));
    return plan;
}

export function planLabelRename(input: { subject: LabelSubject; newName: string; stories: readonly RenameStory[] }): RenamePlan {
    const { subject, stories } = input;
    const newName = input.newName.trim();
    const plan: RenamePlan = { subject, newName, edits: [], followers: [], failures: [] };
    for (const visit of eachRow(stories, { storyId: subject.storyId, sceneId: subject.sceneId })) {
        const { block } = visit;
        if (block.kind !== "control") {
            continue;
        }
        const payload = block.payload;
        if (payload.control === "label" && block.id === subject.blockId) {
            const site = rowSite(visit, { id: `${visit.story.id}/${block.id}/label`, access: "declaration", slot: "label", excerpt: payload.name });
            plan.edits.push({
                id: site.id, site, before: payload.name, after: newName, required: true,
                change: { kind: "labelName", storyId: visit.story.id, sceneId: visit.scene.id, blockId: block.id, before: payload.name, after: newName },
            });
        } else if (payload.control === "goto" && payload.targetLabel === subject.name) {
            // Exact, case included: the engine keys labels on the declared string (see `labels.ts`).
            const site = rowSite(visit, { id: `${visit.story.id}/${block.id}/goto`, access: "read", slot: "goto", excerpt: payload.targetLabel });
            plan.edits.push({
                id: site.id, site, before: payload.targetLabel, after: newName,
                change: { kind: "gotoTarget", storyId: visit.story.id, sceneId: visit.scene.id, blockId: block.id, before: payload.targetLabel, after: newName },
            });
        }
    }
    return plan;
}

export function planSceneRename(input: { subject: SceneSubject; newName: string; stories: readonly RenameStory[] }): RenamePlan {
    const { subject, stories } = input;
    const newName = input.newName.trim();
    const plan: RenamePlan = { subject, newName, edits: [], followers: [], failures: [] };
    const story = stories.find(entry => entry.id === subject.storyId);
    const scene = story?.document.scenes[subject.sceneId];
    if (!story || !scene) {
        return plan;
    }
    plan.edits.push({
        id: `${story.id}/scene:${scene.id}`,
        site: {
            id: `${story.id}/scene:${scene.id}`,
            access: "declaration",
            slot: "sceneName",
            storyId: story.id,
            storyName: story.name,
            sceneId: scene.id,
            sceneName: scene.name,
            target: { kind: "storyScene", storyId: story.id, sceneId: scene.id, storyName: story.name, sceneName: scene.name },
        },
        before: scene.name,
        after: newName,
        required: true,
        change: { kind: "sceneName", storyId: story.id, sceneId: scene.id, before: scene.name, after: newName },
    });
    // `visited(…)` resolves against the scenes of its own story.
    expressionEdits([story], { kind: "scene", sceneId: scene.id, newName }, undefined, plan);
    return plan;
}

/** A character rename: the record, and the rows that speak as its old name with no character bound. */
export function planCharacterRename(input: {
    subject: CharacterSubject;
    newName: string;
    stories: readonly RenameStory[];
}): RenamePlan {
    const { subject, stories } = input;
    const newName = input.newName.trim();
    const plan: RenamePlan = { subject, newName, edits: [], followers: [], failures: [] };
    plan.edits.push({
        id: `character:${subject.characterId}`,
        site: { id: `character:${subject.characterId}`, access: "declaration", slot: "characterName", target: { kind: "character", characterId: subject.characterId } },
        before: subject.name,
        after: newName,
        required: true,
        change: { kind: "characterName", characterId: subject.characterId, before: subject.name, after: newName },
    });
    const wanted = subject.name.trim();
    for (const visit of eachRow(stories)) {
        const { block } = visit;
        if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
            const payload = block.payload;
            if (payload.characterId === subject.characterId) {
                plan.followers.push(rowSite(visit, { id: `${visit.story.id}/${block.id}/speaker`, access: "read", slot: "speaker" }));
            } else if (!payload.characterId && payload.speakerName?.trim() === wanted && wanted) {
                const site = rowSite(visit, { id: `${visit.story.id}/${block.id}/speakerName`, access: "read", slot: "speaker", excerpt: payload.speakerName });
                plan.edits.push({
                    id: site.id, site, before: payload.speakerName, after: newName,
                    change: { kind: "speakerName", storyId: visit.story.id, sceneId: visit.scene.id, blockId: block.id, before: payload.speakerName, after: newName },
                });
            }
        }
    }
    return plan;
}

/** How many places the plan changes - the number the confirm button states. */
export function countSelected(plan: RenamePlan, excluded: ReadonlySet<string>): number {
    return plan.edits.filter(edit => edit.required || !excluded.has(edit.id)).length;
}

// ── Validation ──────────────────────────────────────────────────────────────────────────────────

export type RenameNameProblem =
    | { code: "empty" }
    | { code: "unchanged" }
    | { code: "reserved" }
    | { code: "taken" };

const RESERVED_VARIABLE_NAMES = new Set(["true", "false", "null", APP_TAG_EXPR_KEYWORD.toLowerCase()]);

const normalize = (name: string) => name.trim().toLowerCase();

/**
 * Whether `newName` may replace the subject's name.
 *
 * `takenNames` is every other name in the namespace the subject competes in: for a variable, every
 * variable a read of the new name could resolve to instead (the scene's, the project's); for a label,
 * the scene's other labels; for a scene, the story's other scenes; for a character, the other
 * characters. Compared case-insensitively except for labels, which the engine compares exactly.
 */
export function validateRenameName(subject: RenameSubject, newName: string, takenNames: readonly string[]): RenameNameProblem | null {
    const trimmed = newName.trim();
    if (!trimmed) {
        return { code: "empty" };
    }
    if (trimmed === subject.name.trim()) {
        return { code: "unchanged" };
    }
    if (subject.kind === "variable" && RESERVED_VARIABLE_NAMES.has(trimmed.toLowerCase())) {
        return { code: "reserved" };
    }
    const taken = subject.kind === "label"
        ? takenNames.some(name => name.trim() === trimmed)
        : takenNames.some(name => normalize(name) === normalize(trimmed)
            // A case-only rename of the subject itself is allowed.
            && normalize(name) !== normalize(subject.name));
    return taken ? { code: "taken" } : null;
}

/** The names a variable rename competes with: every variable visible where the subject is read. */
export function variableNamesInReach(input: {
    subject: VariableSubject;
    stories: readonly RenameStory[];
    registry: readonly VariableRegistryEntry[];
}): string[] {
    const { subject, stories, registry } = input;
    const names: string[] = [];
    const subjectKey = storyVariableRefKey(subject.ref);
    for (const entry of registry) {
        if (subject.declaration.source === "registry" && entry.id === subject.declaration.entryId) {
            continue;
        }
        names.push(entry.name);
    }
    for (const story of stories) {
        for (const scene of listScenesInDocumentOrder(story.document)) {
            if (!scene) {
                continue;
            }
            for (const block of listSceneDeclarationBlocks(scene)) {
                if (subject.declaration.source === "story" && block.id === subject.declaration.blockId) {
                    continue;
                }
                const scope = block.payload.scope;
                // A scene variable competes with its own scene's variables and with the project's; a
                // project variable competes with every scene variable, since any scene may read it.
                if (scope === "scene" && subject.ref.scope === "scene" && subject.declaration.source === "story"
                    && scene.id !== subject.declaration.sceneId) {
                    continue;
                }
                if (storyVariableRefKey({ scope: scope, variableId: block.id } as StoryVariableRef) === subjectKey) {
                    continue;
                }
                names.push(block.payload.name);
            }
        }
    }
    return names;
}
