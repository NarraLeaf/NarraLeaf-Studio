import type { TranslationKey } from "@shared/i18n/catalog";
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
    type StoryExprFunction,
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
 * `variables/name-collision` reads `ctx.persistentNameCollisions` / `ctx.savedNameCollisions`, which
 * are `mergedPersistentView`'s own answer rather than a second scan - the compiler already reports
 * the same list, and two scans that could disagree about what collides would be worse than no rule.
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
 * Scope decides reach, exactly as the compiler resolves it. `scene` binds within its own scene. The
 * other two are PROJECT-level and reach across every story, because both are declared in two places:
 * a story declaration row (`/save`, `/persis`) and the project variable registry, which is a
 * legitimate declaration site of its own with no row to point at. A registry `saved` entry belongs
 * to the project, not to whichever story happens to read it, so a scan that kept saved uses per-story
 * would report it unused in every story but one.
 *
 * `ctx.variableRegistry` carries BOTH project scopes; every read of it here filters on `entry.scope`
 * first. Treating the flat list as persistent identities would let a `saved` entry silently satisfy a
 * persistent reference, which resolves to nothing at runtime - the two scopes are backed by different
 * stores.
 *
 * `variables/random-outside-assignment` is the odd one out: it is about *when* a value is computed
 * rather than whether it resolves. Its reasoning lives above `RANDOM_FUNCTIONS` below.
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
        case "array":
            expr.items.forEach(item => collectExpressionVariableNames(item, into));
            return;
        case "index":
            collectExpressionVariableNames(expr.target, into);
            collectExpressionVariableNames(expr.index, into);
            return;
        case "literal":
        case "invalid":
        // Neither names a variable. `visited`/`picked` address the visited record and `invoke`
        // addresses a blueprint, and a blueprint's own variable reads are already counted by
        // `collectBlueprintVariableUses` scanning its graph nodes - counting them again from the
        // call site would not change any finding, but it would make the two scans disagree about
        // what a "use" is.
        case "visited":
        case "invoke":
            return;
    }
}

/**
 * The two non-pure entries in `STORY_EXPR_FUNCTIONS`, and the criterion for where they may sit.
 *
 * The expression language has no notion of *when* a tree is evaluated, so the same `random()` call
 * means different things in different slots. What separates the legal sites from the reported ones
 * is therefore not *which* slot it is, but whether that slot's evaluation count is the one the
 * author was asking for:
 *
 *  - **Once, deliberately.** A `setVariable` right-hand side compiles to a `Script.execute` and runs
 *    exactly once, writing the roll into the storable. That is a dice roll, and it is what an author
 *    reaches for the function to do.
 *  - **Once per iteration, deliberately.** A `repeat … until` condition is re-tested every time
 *    round the loop, which is what a loop condition *is*. `/repeat until random() < 0.1` - keep
 *    going until we get lucky - is a legitimate and useful line, and a roll that held still there
 *    would hang the loop rather than fix it. Exempt on purpose; the `repeat` case in the scan below
 *    is written out so the exemption is visible rather than inferred from silence.
 *  - **Re-run behind the author's back.** Every other slot compiles to a lambda or an NLR dynamic
 *    word that is evaluated on each test and each render, with nothing in the authored line saying
 *    so: `/if random() < 0.5` takes a fresh branch each time it is reached; a choice option's
 *    `hiddenWhen` / `disabledWhen` re-rolls on every menu paint (`conditionToLambda` in
 *    `storyCompiler.ts`), so the option visibly flickers; an inline `{randomInt(1,6)}` shows a
 *    different number every time the line redraws.
 *
 * Only the third bullet is a finding, and its failure mode is not "wrong value once" - it is a value
 * that will not hold still *within a single playthrough*, which reads to the author as an engine bug
 * rather than as their own mistake. Moving that from runtime weirdness to an authoring-time error is
 * the whole reason the rule exists, and the fix never varies: roll once into a variable with `/set`,
 * then read that variable.
 *
 * The `/set` sugars need no carve-out. `/inc gold randomInt(1,3)` lowers to a `setVariable` carrying
 * an `expression`, i.e. one of the legal sites, so it is accepted for exactly the right reason
 * rather than by being special-cased.
 */
const RANDOM_FUNCTIONS: ReadonlySet<StoryExprFunction> = new Set<StoryExprFunction>(["random", "randomInt"]);

/**
 * The first `random`/`randomInt` call anywhere in a tree, by name, or `null`.
 *
 * First rather than all: an author who wrote `randomInt(1,6) + randomInt(1,6)` in a condition made
 * one mistake, and the repair moves the whole expression regardless of how many calls it holds. The
 * walk mirrors `collectStoryExpressionVariables` node for node - notably it descends into a *pure*
 * call's arguments too, because `max(0, randomInt(1,6))` is just as unstable as the bare call.
 */
function findRandomCall(expr: StoryExpr): StoryExprFunction | null {
    switch (expr.kind) {
        case "call": {
            if (RANDOM_FUNCTIONS.has(expr.fn)) {
                return expr.fn;
            }
            for (const arg of expr.args) {
                const found = findRandomCall(arg);
                if (found) {
                    return found;
                }
            }
            return null;
        }
        case "unary":
            return findRandomCall(expr.operand);
        case "binary":
            return findRandomCall(expr.left) ?? findRandomCall(expr.right);
        case "ternary":
            return findRandomCall(expr.test)
                ?? findRandomCall(expr.consequent)
                ?? findRandomCall(expr.alternate);
        case "array":
            // A list literal is as good a hiding place as an argument list: `[randomInt(1,6)]` in a
            // condition re-rolls on every test exactly like the bare call would.
            for (const item of expr.items) {
                const found = findRandomCall(item);
                if (found) {
                    return found;
                }
            }
            return null;
        case "index":
            // Both halves, and the index especially - `table[randomInt(0, 2)]` is the idiomatic way
            // to write "pick one at random", and it is unstable for the same reason.
            return findRandomCall(expr.target) ?? findRandomCall(expr.index);
        case "literal":
        case "var":
        case "invalid":
        case "visited":
            return null;
        case "invoke":
            // NOT a finding, and this is a decision rather than an oversight.
            //
            // The rule is about a value that will not hold still across re-evaluations of the same
            // slot. An `invoke` in a condition or an interpolation is re-run on every test and every
            // repaint - but that is what naming a blueprint in those two slots has ALWAYS meant
            // (`StoryConditionRef` and `StoryInterpolationRef` have had a `blueprint` arm since
            // before this rule existed, and neither is reported), and `invoke` is a second spelling
            // of the same call, not a new capability. Reporting it here would make the spelling
            // decide the verdict on identical behaviour.
            //
            // Nor can this walk tell a stable graph from an unstable one: the instability would live
            // inside the graph, behind a `Random` node this scan cannot see. Whether *that* deserves
            // a rule is a blueprint-side question, and answering it half-way here - reporting every
            // call because some calls might roll - would fire on the overwhelmingly common case of a
            // graph that just reads state.
            return null;
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
                } else if (block.payload.control === "repeat") {
                    // `repeat.until` is the fourth `StoryConditionRef` slot, and it must be scanned
                    // here even though `random-outside-assignment` below deliberately exempts the very
                    // same slot. The two scans ask different questions: that rule is about *when* a
                    // value is recomputed (a loop condition is meant to be re-tested, so a roll in one
                    // is fine), while this one is about *whether* a variable is read at all - and a
                    // read is a read however many times it happens. Leaving it out reported
                    // `/repeat until gold >= 10`'s only reader as `variables/unused`, and would have
                    // let `undeclared` miss a deleted variable the loop still names.
                    pushCondition(block.payload.until, block.id);
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
 * The identities a reference of one project scope may resolve against: the registry entries of that
 * scope plus every story declaration row of it, project-wide because both scopes outlive any one
 * story.
 *
 * Both `id` and `storageKey` are accepted. The compiler validates against the merged storage keys
 * only, and for both surfaces the two are the same value unless an author changed one - so the extra
 * arm costs nothing and cannot turn a working reference into an error.
 *
 * Scope-filtered rather than scope-blind: a `saved` entry accepted as a persistent identity would
 * turn a reference that reads app-level storage into one that silently finds nothing there.
 */
function collectProjectScopeIdentities(ctx: LintContext, scope: "saved" | "persistent"): Set<string> {
    const identities = new Set<string>();
    for (const entry of ctx.variableRegistry) {
        if (entry.scope !== scope) {
            continue;
        }
        identities.add(entry.id);
        identities.add(entry.storageKey);
    }
    const rowsOf = scope === "saved" ? savedVariableDefs : storyPersistentDefs;
    for (const story of ctx.stories) {
        for (const def of Object.values(rowsOf(story.document))) {
            identities.add(def.id);
            identities.add(def.storageKey);
        }
    }
    return identities;
}

/** The two ids one project-scoped declaration answers to. */
function variableAliases(id: string, storageKey: string | undefined): string[] {
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
            const persistentIdentities = collectProjectScopeIdentities(ctx, "persistent");
            // Project-wide, like the persistent set beside it and for the same reason: a saved
            // variable may be declared in the registry with no row anywhere, so "is it declared"
            // cannot be answered out of the document doing the reading. It also has to agree with
            // `unused` below - a row that rule counts as used from another story must not be an
            // undeclared reference here.
            const savedIdentities = collectProjectScopeIdentities(ctx, "saved");
            const findings: LintFinding[] = [];

            for (const entry of ctx.stories) {
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
                                    ? savedIdentities.has(use.ref.variableId)
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
            //
            // Saved uses are NOT keyed by story, and that is the fix for a real false positive: a
            // saved variable declared in the project registry belongs to no story at all, so a
            // per-story tally would find it unused in every story except the one that reads it and
            // warn the author to delete a variable the project depends on.
            const sceneUses = new Map<string, Set<string>>();
            const savedUses = new Set<string>();
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
                            savedUses.add(use.ref.variableId);
                        } else {
                            persistentUses.add(use.ref.variableId);
                        }
                    }
                }
            }

            /**
             * Whether anything in the project reads or writes this project-scoped variable.
             *
             * The scope picks the tally, and getting that wrong is not a near miss: a saved entry
             * checked against `persistentUses` is checked against a set its refs can never land in,
             * so every saved variable in the project would be reported dead.
             */
            const usedAtProjectScope = (
                scope: "saved" | "persistent",
                id: string,
                storageKey: string | undefined,
            ): boolean => {
                const uses = scope === "saved" ? savedUses : persistentUses;
                const fromBlueprint = scope === "saved" ? blueprintUses.saved : blueprintUses.persistent;
                return variableAliases(id, storageKey).some(alias => uses.has(alias) || fromBlueprint.has(alias));
            };

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
                return usedAtProjectScope(declaration.payload.scope, declaration.id, declaration.payload.storageKey);
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

            // Registry entries are the one declaration site with no row to jump to, so they are
            // reported against the project rather than a story. Each is checked against ITS OWN
            // scope's use set: a saved entry read by a `/set` is used, and reading it off the
            // persistent tally would report every saved variable in the project as dead.
            for (const registryEntry of ctx.variableRegistry) {
                if (usedAtProjectScope(registryEntry.scope, registryEntry.id, registryEntry.storageKey)) {
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
            // Both project scopes, each against its own declaration rows. The finding reads the same
            // either way - a name means two things - so the scope only decides which row to jump to.
            const byScope = [
                { scope: "persistent" as const, collisions: ctx.persistentNameCollisions },
                { scope: "saved" as const, collisions: ctx.savedNameCollisions },
            ];
            for (const { scope, collisions } of byScope) {
                for (const collision of collisions) {
                    const site = findDeclarationSite(ctx, scope, collision.storageKeys);
                    findings.push({
                        ruleId: "variables/name-collision",
                        messageKey: "lint.rule.variablesNameCollision.message",
                        messageParams: { variable: collision.name },
                        location: site ? storyLocation(site.entry, site.scene, site.block.id) : { kind: "project" },
                        ...(site ? { target: blockTarget(site.entry, site.scene, site.block.id) } : {}),
                    });
                }
            }
            return findings;
        },
    },
    {
        id: "variables/random-outside-assignment",
        category: "variables",
        defaultSeverity: "error",
        slug: "variablesRandomOutsideAssignment",
        run(ctx) {
            const findings: LintFinding[] = [];

            for (const entry of ctx.stories) {
                for (const scene of listScenesInDocumentOrder(entry.document)) {
                    if (!scene) {
                        continue;
                    }

                    const report = (fn: StoryExprFunction, blockId: StoryBlockId, messageKey: TranslationKey) => {
                        findings.push({
                            ruleId: "variables/random-outside-assignment",
                            messageKey,
                            messageParams: { fn },
                            location: storyLocation(entry, scene, blockId),
                            target: blockTarget(entry, scene, blockId),
                        });
                    };

                    // One finding per condition slot, not per call: `hiddenWhen` and `disabledWhen`
                    // are separate mistakes, but two rolls inside one of them are still one.
                    const checkCondition = (
                        condition: StoryConditionRef | undefined,
                        blockId: StoryBlockId,
                        messageKey: TranslationKey,
                    ) => {
                        if (condition?.kind !== "expression") {
                            return;
                        }
                        const fn = findRandomCall(condition.expression.ast);
                        if (fn) {
                            report(fn, blockId, messageKey);
                        }
                    };

                    const checkSegment = (segment: StoryTextSegment | undefined, blockId: StoryBlockId) => {
                        for (const run of segment?.rich ?? []) {
                            if (!("interpolation" in run) || run.interpolation.kind !== "expression") {
                                continue;
                            }
                            const fn = findRandomCall(run.interpolation.expression.ast);
                            if (fn) {
                                report(fn, blockId, "lint.rule.variablesRandomOutsideAssignment.messageInterpolation");
                            }
                        }
                    };

                    // Live rows only, for the same reason `undeclared` reads them: a disabled row is
                    // compiled out, so nothing it holds can be re-evaluated at runtime, and an
                    // error-severity finding against a row that cannot run is a false positive.
                    //
                    // `note` blocks carry text segments too and are deliberately absent: the compiler
                    // has no `note` case at all, so an expression in one never evaluates even once.
                    for (const block of liveBlocks(scene)) {
                        switch (block.kind) {
                            case "nodeAction":
                                if (block.payload.action === "narration" || block.payload.action === "dialogue") {
                                    checkSegment(block.payload.text, block.id);
                                } else if (block.payload.action === "choice") {
                                    checkSegment(block.payload.prompt, block.id);
                                } else {
                                    checkSegment(block.payload.text, block.id);
                                    checkCondition(
                                        block.payload.hiddenWhen,
                                        block.id,
                                        "lint.rule.variablesRandomOutsideAssignment.messageChoiceOption",
                                    );
                                    checkCondition(
                                        block.payload.disabledWhen,
                                        block.id,
                                        "lint.rule.variablesRandomOutsideAssignment.messageChoiceOption",
                                    );
                                }
                                break;
                            case "control":
                                switch (block.payload.control) {
                                    case "conditionBranch":
                                        checkCondition(
                                            block.payload.condition,
                                            block.id,
                                            "lint.rule.variablesRandomOutsideAssignment.message",
                                        );
                                        break;
                                    case "repeat":
                                        // `repeat.until` is a fourth `StoryConditionRef` slot and the
                                        // one condition a roll belongs in, so it is skipped - spelled
                                        // out as its own case rather than swallowed by `default`,
                                        // because a reader who finds `until` unchecked has to be able
                                        // to tell a decision from an oversight. A loop condition is
                                        // *meant* to be re-tested each iteration: that is not a value
                                        // failing to hold still, it is the loop working. See the
                                        // `RANDOM_FUNCTIONS` header for the full criterion.
                                        //
                                        // The exemption is THIS rule's alone. `collectVariableUses`
                                        // scans the same slot unconditionally, and must: it asks
                                        // whether a variable is read, not how often, so skipping
                                        // `until` there would report a loop's only reader as unused.
                                        break;
                                    default:
                                        break;
                                }
                                break;
                            default:
                                break;
                        }
                    }
                }
            }

            return findings;
        },
    },
];

/**
 * The story declaration row behind one of a collision's storage keys, so the finding has somewhere to
 * jump to. A collision always spans both surfaces, and only the story side has a row.
 */
function findDeclarationSite(
    ctx: LintContext,
    scope: "saved" | "persistent",
    storageKeys: readonly string[],
): { entry: LintStoryEntry; scene: StoryScene; block: StoryDeclarationBlock } | null {
    const wanted = new Set(storageKeys);
    for (const entry of ctx.stories) {
        for (const scene of listScenesInDocumentOrder(entry.document)) {
            if (!scene) {
                continue;
            }
            for (const block of listSceneDeclarationBlocks(scene)) {
                if (block.payload.scope !== scope) {
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
