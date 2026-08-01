import type { BlueprintDocument, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    collectStoryExpressionVariables,
    listSceneBlocksInDocumentOrder,
    listSceneDeclarationBlocks,
    listScenesInDocumentOrder,
    savedVariableDefs,
    sceneVariableDefs,
    storyPersistentDefs,
    storyVariableRefKey,
    type StoryBlock,
    type StoryBlockId,
    type StoryConditionRef,
    type StoryDeclarationBlock,
    type StoryExpr,
    type StoryScene,
    type StorySceneId,
    type StoryTextSegment,
    type StoryVariableRef,
} from "@shared/types/story";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import type { LintContext, LintStoryEntry } from "../context";
import type { LintFinding, LintLocation, LintRule } from "../types";

/**
 * `variables` - the story's state: declared, used, and unambiguous.
 *
 * `variables/name-collision` reads `ctx.persistentNameCollisions`, which is
 * `mergedPersistentView`'s own answer rather than a second scan - the compiler already reports the
 * same list, and two scans that could disagree about what collides would be worse than no rule.
 *
 * The two scans here are deliberately asymmetric about disabled rows, for the same reason
 * `declarations.ts` refuses to skip a disabled declaration:
 *
 *  - **`undeclared` reads live rows only.** A disabled row is compiled out, so it cannot break a
 *    build and must not produce an error.
 *  - **`unused` reads every row, disabled included.** A row an author switched off for the afternoon
 *    is still a place the variable is wanted; reporting the variable as unused would invite them to
 *    delete the declaration out from under it.
 *
 * Scope decides reach, exactly as the compiler resolves it: `scene` binds within its own scene,
 * `saved` within its document, `persistent` across the project - story `/persis` rows AND the
 * project variable registry, which is a legitimate declaration site of its own.
 */

/** One place a variable is read or written. */
type VariableUse = {
    ref: StoryVariableRef;
    /** Author-facing name, when the site carried one (an expression's `var` node). */
    name?: string;
    sceneId: StorySceneId;
    blockId: StoryBlockId;
};

/** Blueprint node params that name a story variable, by scope. See `storyVariableNodes.ts`. */
const BLUEPRINT_VARIABLE_PARAMS = {
    scene: "sceneVariableId",
    saved: "savedVariableId",
    persistent: "persistentVariableId",
} as const;

/**
 * The author-facing names an expression tree carries for the variables it reads.
 *
 * `collectStoryExpressionVariables` is the shared, authoritative answer to *which* variables a tree
 * reads and is what the scans below use; it returns refs, and a ref carries no name. This walk exists
 * only to recover the display name the author typed, which is the difference between a finding that
 * reads "gold is used but never declared" and one that reads a raw block uuid.
 */
function collectExpressionVariableNames(expr: StoryExpr, into: Map<string, string>): void {
    switch (expr.kind) {
        case "var": {
            const key = storyVariableRefKey(expr.target);
            if (expr.name && !into.has(key)) {
                into.set(key, expr.name);
            }
            return;
        }
        case "unary":
            collectExpressionVariableNames(expr.operand, into);
            return;
        case "binary":
            collectExpressionVariableNames(expr.left, into);
            collectExpressionVariableNames(expr.right, into);
            return;
        case "ternary":
            collectExpressionVariableNames(expr.test, into);
            collectExpressionVariableNames(expr.consequent, into);
            collectExpressionVariableNames(expr.alternate, into);
            return;
        case "call":
            expr.args.forEach(arg => collectExpressionVariableNames(arg, into));
            return;
        case "literal":
        case "invalid":
            return;
    }
}

/** Every variable read or written by the blocks handed in, in encounter order. */
function collectVariableUses(scene: StoryScene, blocks: readonly StoryBlock[]): VariableUse[] {
    const uses: VariableUse[] = [];

    const push = (ref: StoryVariableRef, blockId: StoryBlockId, name?: string) => {
        uses.push({ ref, sceneId: scene.id, blockId, ...(name ? { name } : {}) });
    };

    const pushExpression = (expr: StoryExpr, blockId: StoryBlockId) => {
        const names = new Map<string, string>();
        collectExpressionVariableNames(expr, names);
        for (const ref of collectStoryExpressionVariables(expr)) {
            push(ref, blockId, names.get(storyVariableRefKey(ref)));
        }
    };

    const pushCondition = (condition: StoryConditionRef | undefined, blockId: StoryBlockId) => {
        if (!condition) {
            return;
        }
        if (condition.kind === "variable") {
            push(condition.target, blockId);
            return;
        }
        if (condition.kind === "expression") {
            pushExpression(condition.expression.ast, blockId);
        }
    };

    const pushSegment = (segment: StoryTextSegment | undefined, blockId: StoryBlockId) => {
        for (const run of segment?.rich ?? []) {
            if (!("interpolation" in run)) {
                continue;
            }
            const interpolation = run.interpolation;
            if (interpolation.kind === "variable") {
                push(interpolation.target, blockId);
            } else if (interpolation.kind === "expression") {
                pushExpression(interpolation.expression.ast, blockId);
            }
        }
    };

    for (const block of blocks) {
        switch (block.kind) {
            case "action":
                if (block.payload.action === "setVariable") {
                    push(block.payload.target, block.id);
                    if (block.payload.expression) {
                        pushExpression(block.payload.expression.ast, block.id);
                    }
                }
                break;
            case "nodeAction":
                if (block.payload.action === "narration" || block.payload.action === "dialogue") {
                    pushSegment(block.payload.text, block.id);
                } else if (block.payload.action === "choice") {
                    pushSegment(block.payload.prompt, block.id);
                } else {
                    pushSegment(block.payload.text, block.id);
                    pushCondition(block.payload.hiddenWhen, block.id);
                    pushCondition(block.payload.disabledWhen, block.id);
                }
                break;
            case "control":
                if (block.payload.control === "conditionBranch") {
                    pushCondition(block.payload.condition, block.id);
                }
                break;
            case "note":
                pushSegment(block.payload.text, block.id);
                break;
            default:
                break;
        }
    }

    return uses;
}

function liveBlocks(scene: StoryScene): StoryBlock[] {
    return listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) });
}

/** Every graph node of a blueprint document, across events, functions and macros. */
function* eachBlueprintNode(document: BlueprintDocument | null): Generator<BlueprintGraphNode> {
    if (!document) {
        return;
    }
    for (const blueprint of Object.values(document.blueprints ?? {})) {
        if (blueprint?.program?.kind !== "graph") {
            continue;
        }
        const graphs = blueprint.program.graphs;
        const carriers = [
            ...Object.values(graphs.events ?? {}),
            ...Object.values(graphs.functions ?? {}),
            ...Object.values(graphs.macros ?? {}),
        ];
        for (const carrier of carriers) {
            for (const node of Object.values(carrier?.graph?.nodes ?? {})) {
                if (node) {
                    yield node;
                }
            }
        }
    }
}

/** The variable ids blueprint graph nodes name, per scope. A node param IS a use. */
function collectBlueprintVariableUses(document: BlueprintDocument | null): Record<keyof typeof BLUEPRINT_VARIABLE_PARAMS, Set<string>> {
    const found = {
        scene: new Set<string>(),
        saved: new Set<string>(),
        persistent: new Set<string>(),
    };
    for (const node of eachBlueprintNode(document)) {
        for (const [scope, paramKey] of Object.entries(BLUEPRINT_VARIABLE_PARAMS) as [keyof typeof BLUEPRINT_VARIABLE_PARAMS, string][]) {
            const value = node.params?.[paramKey];
            if (typeof value === "string" && value.trim()) {
                found[scope].add(value.trim());
            }
        }
    }
    return found;
}

/**
 * The persistent identities a reference may resolve against: the project registry plus every story
 * `/persis` row, project-wide because persistent state is app-level and shared.
 *
 * Both `id` and `storageKey` are accepted. The compiler validates against the merged storage keys
 * only, and for both surfaces the two are the same value unless an author changed one - so the extra
 * arm costs nothing and cannot turn a working reference into an error.
 */
function collectPersistentIdentities(ctx: LintContext): Set<string> {
    const identities = new Set<string>();
    for (const entry of ctx.variableRegistry) {
        identities.add(entry.id);
        identities.add(entry.storageKey);
    }
    for (const story of ctx.stories) {
        for (const def of Object.values(storyPersistentDefs(story.document))) {
            identities.add(def.id);
            identities.add(def.storageKey);
        }
    }
    return identities;
}

/** The two ids one persistent declaration answers to. */
function persistentAliases(id: string, storageKey: string | undefined): string[] {
    return storageKey && storageKey !== id ? [id, storageKey] : [id];
}

function storyLocation(entry: LintStoryEntry, scene: StoryScene, blockId?: StoryBlockId): LintLocation {
    return {
        kind: "story",
        storyId: entry.id,
        storyName: entry.name,
        sceneId: scene.id,
        sceneName: scene.name,
        ...(blockId ? { blockId } : {}),
    };
}

function blockTarget(entry: LintStoryEntry, scene: StoryScene, blockId: StoryBlockId): SearchJumpTarget {
    return {
        kind: "storyBlock",
        storyId: entry.id,
        sceneId: scene.id,
        blockId,
        storyName: entry.name,
        sceneName: scene.name,
    };
}

/**
 * A display name for a variable a reference could not resolve.
 *
 * The ref itself carries no name, so this reads the declaration the author probably meant: a row
 * with that block id anywhere in the story (a scene variable addressed from the wrong scene, or a
 * row whose scope was changed), then the registry. Falling back to the raw id is the honest last
 * resort - it is what the row is actually pointing at.
 */
function buildVariableNameIndex(ctx: LintContext, entry: LintStoryEntry): Map<string, string> {
    const names = new Map<string, string>();
    for (const scene of listScenesInDocumentOrder(entry.document)) {
        if (!scene) {
            continue;
        }
        for (const block of listSceneDeclarationBlocks(scene)) {
            names.set(block.id, block.payload.name);
            if (block.payload.storageKey) {
                names.set(block.payload.storageKey, block.payload.name);
            }
        }
    }
    for (const registryEntry of ctx.variableRegistry) {
        names.set(registryEntry.id, registryEntry.name);
        names.set(registryEntry.storageKey, registryEntry.name);
    }
    return names;
}

export const VARIABLES_LINT_RULES: readonly LintRule[] = [
    {
        id: "variables/undeclared",
        category: "variables",
        defaultSeverity: "error",
        slug: "variablesUndeclared",
        run(ctx) {
            const persistentIdentities = collectPersistentIdentities(ctx);
            const findings: LintFinding[] = [];

            for (const entry of ctx.stories) {
                const saved = savedVariableDefs(entry.document);
                const names = buildVariableNameIndex(ctx, entry);
                for (const scene of listScenesInDocumentOrder(entry.document)) {
                    if (!scene) {
                        continue;
                    }
                    const sceneDefs = sceneVariableDefs(scene);
                    // One finding per undeclared variable per scene, anchored at its first live use:
                    // a variable deleted out from under twenty rows is one mistake, not twenty.
                    const reported = new Set<string>();
                    for (const use of collectVariableUses(scene, liveBlocks(scene))) {
                        const declared =
                            use.ref.scope === "scene"
                                ? Boolean(sceneDefs[use.ref.variableId])
                                : use.ref.scope === "saved"
                                    ? Boolean(saved[use.ref.variableId])
                                    : persistentIdentities.has(use.ref.variableId);
                        if (declared) {
                            continue;
                        }
                        const key = storyVariableRefKey(use.ref);
                        if (reported.has(key)) {
                            continue;
                        }
                        reported.add(key);
                        findings.push({
                            ruleId: "variables/undeclared",
                            messageKey: "lint.rule.variablesUndeclared.message",
                            messageParams: {
                                variable: use.name ?? names.get(use.ref.variableId) ?? use.ref.variableId,
                            },
                            location: storyLocation(entry, scene, use.blockId),
                            target: blockTarget(entry, scene, use.blockId),
                        });
                    }
                }
            }
            return findings;
        },
    },
    {
        id: "variables/unused",
        category: "variables",
        defaultSeverity: "warning",
        slug: "variablesUnused",
        run(ctx) {
            const blueprintUses = collectBlueprintVariableUses(ctx.blueprintDocument);

            // Uses, gathered from EVERY row (disabled included - see the file header). Scene-scoped
            // uses are keyed by their scene, because that is the only place they can resolve.
            const sceneUses = new Map<string, Set<string>>();
            const savedUses = new Map<string, Set<string>>();
            const persistentUses = new Set<string>();

            const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
                const set = map.get(key);
                if (set) {
                    set.add(value);
                } else {
                    map.set(key, new Set([value]));
                }
            };

            for (const entry of ctx.stories) {
                for (const scene of listScenesInDocumentOrder(entry.document)) {
                    if (!scene) {
                        continue;
                    }
                    const blocks = listSceneBlocksInDocumentOrder(scene);
                    for (const use of collectVariableUses(scene, blocks)) {
                        if (use.ref.scope === "scene") {
                            addTo(sceneUses, `${entry.id}:${scene.id}`, use.ref.variableId);
                        } else if (use.ref.scope === "saved") {
                            addTo(savedUses, entry.id, use.ref.variableId);
                        } else {
                            persistentUses.add(use.ref.variableId);
                        }
                    }
                }
            }

            const isUsed = (
                declaration: StoryDeclarationBlock,
                storyId: string,
                sceneId: StorySceneId,
            ): boolean => {
                if (declaration.payload.scope === "scene") {
                    return (
                        Boolean(sceneUses.get(`${storyId}:${sceneId}`)?.has(declaration.id))
                        || blueprintUses.scene.has(declaration.id)
                    );
                }
                if (declaration.payload.scope === "saved") {
                    return Boolean(savedUses.get(storyId)?.has(declaration.id)) || blueprintUses.saved.has(declaration.id);
                }
                return persistentAliases(declaration.id, declaration.payload.storageKey).some(
                    alias => persistentUses.has(alias) || blueprintUses.persistent.has(alias),
                );
            };

            const findings: LintFinding[] = [];
            for (const entry of ctx.stories) {
                for (const scene of listScenesInDocumentOrder(entry.document)) {
                    if (!scene) {
                        continue;
                    }
                    for (const declaration of listSceneDeclarationBlocks(scene)) {
                        if (isUsed(declaration, entry.id, scene.id)) {
                            continue;
                        }
                        findings.push({
                            ruleId: "variables/unused",
                            messageKey: "lint.rule.variablesUnused.message",
                            messageParams: { variable: declaration.payload.name },
                            location: storyLocation(entry, scene, declaration.id),
                            target: blockTarget(entry, scene, declaration.id),
                        });
                    }
                }
            }

            // Registry entries are the one persistent declaration site with no row to jump to, so they
            // are reported against the project rather than a story.
            for (const registryEntry of ctx.variableRegistry) {
                const used = persistentAliases(registryEntry.id, registryEntry.storageKey).some(
                    alias => persistentUses.has(alias) || blueprintUses.persistent.has(alias),
                );
                if (used) {
                    continue;
                }
                findings.push({
                    ruleId: "variables/unused",
                    messageKey: "lint.rule.variablesUnused.message",
                    messageParams: { variable: registryEntry.name },
                    location: { kind: "project" },
                });
            }

            return findings;
        },
    },
    {
        id: "variables/name-collision",
        category: "variables",
        defaultSeverity: "error",
        slug: "variablesNameCollision",
        run(ctx) {
            const findings: LintFinding[] = [];
            for (const collision of ctx.persistentNameCollisions) {
                const site = findPersistentDeclarationSite(ctx, collision.storageKeys);
                findings.push({
                    ruleId: "variables/name-collision",
                    messageKey: "lint.rule.variablesNameCollision.message",
                    messageParams: { variable: collision.name },
                    location: site ? storyLocation(site.entry, site.scene, site.block.id) : { kind: "project" },
                    ...(site ? { target: blockTarget(site.entry, site.scene, site.block.id) } : {}),
                });
            }
            return findings;
        },
    },
];

/**
 * The story `/persis` row behind one of a collision's storage keys, so the finding has somewhere to
 * jump to. A collision always spans both surfaces, and only the story side has a row.
 */
function findPersistentDeclarationSite(
    ctx: LintContext,
    storageKeys: readonly string[],
): { entry: LintStoryEntry; scene: StoryScene; block: StoryDeclarationBlock } | null {
    const wanted = new Set(storageKeys);
    for (const entry of ctx.stories) {
        for (const scene of listScenesInDocumentOrder(entry.document)) {
            if (!scene) {
                continue;
            }
            for (const block of listSceneDeclarationBlocks(scene)) {
                if (block.payload.scope !== "persistent") {
                    continue;
                }
                if (wanted.has(block.payload.storageKey) || wanted.has(block.id)) {
                    return { entry, scene, block };
                }
            }
        }
    }
    return null;
}
