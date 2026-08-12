import {
    isAppTagExpr,
    isStoryExpressionEvaluable,
    listSceneBlocksInDocumentOrder,
    listScenesInDocumentOrder,
    storyExprChildren,
    storyExpressionMentionsAppTag,
    type StoryBlock,
    type StoryBlockId,
    type StoryConditionRef,
    type StoryControlPayload,
    type StoryDocument,
    type StoryExpr,
    type StoryExpression,
    type StoryScene,
} from "@shared/types/story";
import { evaluateStoryExpression, isTruthy } from "@shared/utils/storyExpressionEval";
import { formatStoryExpr } from "@shared/utils/storyExpressionParser";

/**
 * `AppTag` is decided when the package is produced, and this is the one module that decides it.
 *
 * The story compiler does not run at build time - it runs inside the shipped game, at startup, over
 * the story documents the pack carries as JSON. So *everything an author wrote ships verbatim unless
 * it is removed from that JSON*, and "this line is only in the demo" can only be true if the line is
 * gone from the bytes. That removal is {@link applyAppTagToStoryDocument}, and it happens in the main
 * process between reading a document off disk and putting it in the bundle.
 *
 * Two processes read this file and they must never disagree. The renderer asks
 * {@link collectUnfoldableAppTagUses} whether a build may start at all; the main process asks
 * {@link applyAppTagToStoryDocument} what the bundle contains. One implementation of "does this
 * reduce to a constant" is what keeps a refusal and a removal talking about the same set of rows.
 *
 * # What folds
 *
 * `AppTag` becomes the name of the variant being built, as a string literal, and comparison is the
 * language's ordinary strict string equality - exact, case-sensitive. The author reads back the word
 * they typed in the variant list, and there is no second matching rule to learn.
 *
 * An expression that never mentions `AppTag` comes back untouched, by reference. The game evaluates
 * ordinary conditions, and reducing `1 == 1` here would change shipped bytes for a reason that has
 * nothing to do with variants - as well as delete the `else` an author is still working on.
 *
 * An expression that names the variant and does NOT come out a constant (`AppTag == someVariable`,
 * `AppTag == visited(x)`) is the failure this whole feature exists to prevent: it reads on screen as
 * though the content had been cut, and ships it in every package, because the test it describes is
 * one the player's machine performs. It is reported, never quietly accepted, and it is refused in
 * *every* build including the release one - `AppTag` has no play-time value, so such a comparison is
 * not a leak, it is a line that cannot be compiled at all.
 */

export type AppTagFoldOptions = {
    /** The variant's own name, exactly as the variant list stores it. Release is "Release". */
    tagName: string;
};

/**
 * What folding one tree produced.
 *
 * One shape rather than a success/failure union, because all three facts are wanted at once and by
 * different callers: the transform writes `ast`, the gate reads `unfoldable`, and the static
 * condition reader below needs `mentioned` to keep its hands off ordinary conditions.
 */
export type AppTagFold = {
    /** The folded tree. Reference-identical to the input when it mentions no `AppTag`. */
    ast: StoryExpr;
    /** Whether the input mentioned `AppTag` anywhere. */
    mentioned: boolean;
    /** Whether an expression that named the variant failed to come out a constant. */
    unfoldable: boolean;
};

/** Three-valued, because "the game decides this one" is an answer, not a missing one. */
export type AppTagStaticTruth = "true" | "false" | "unknown";

/** One place in a story where `AppTag` is compared with something the build cannot know. */
export type UnfoldableAppTagUse = {
    storyId: string;
    storyName: string;
    sceneId: string;
    sceneName: string;
    blockId: StoryBlockId;
    /** The expression as the author typed it - the text that identifies the mistake. */
    source: string;
};

export function foldStoryExpression(expr: StoryExpr, options: AppTagFoldOptions): AppTagFold {
    if (!storyExpressionMentionsAppTag(expr)) {
        return { ast: expr, mentioned: false, unfoldable: false };
    }
    const ast = foldNode(expr, options.tagName);
    // The rule, whole: an expression that names the variant has to come out a constant. Not "the
    // `AppTag` node is gone" - substituting the name always removes it, and `"Demo" == gold` would
    // then pass while meaning the opposite of what it reads: a test performed at play time, in every
    // package, with the variant-only content sitting in all of them.
    return { ast, mentioned: true, unfoldable: ast.kind !== "literal" };
}

/**
 * What a condition is worth before the game runs.
 *
 * `unknown` for everything except a condition that mentions `AppTag` and reduces to a literal - a
 * variable read, a `visited(…)`, a blueprint-backed condition and a plain `gold >= 100` are all the
 * game's to answer. The `mentioned` gate is the whole safety of the branch elimination below: without
 * it, `/if true` would delete the author's `else`.
 *
 * An absent condition is `unknown` too. The compiler reads one as a constant false
 * (`conditionToLambda(...) ?? falseCondition`), but that is a half-written row rather than a decision
 * about variants, and deleting it here would remove work the author is in the middle of.
 */
export function staticConditionValue(
    condition: StoryConditionRef | undefined,
    options: AppTagFoldOptions,
): AppTagStaticTruth {
    if (!condition || condition.kind !== "expression") {
        return "unknown";
    }
    const fold = foldStoryExpression(condition.expression.ast, options);
    if (!fold.mentioned || fold.ast.kind !== "literal") {
        return "unknown";
    }
    return isTruthy(fold.ast.value) ? "true" : "false";
}

/**
 * Every row of a story whose expressions mention `AppTag` without reducing to a literal.
 *
 * Sweeps in authoring order and skips a disabled subtree, the same two rules
 * `collectInvalidBlocks` follows and for the same reason: a disabled row is compiled out, so it can
 * no more block a build than it can reach a player.
 */
export function collectUnfoldableAppTagUses(
    document: StoryDocument,
    options: AppTagFoldOptions,
): UnfoldableAppTagUse[] {
    const found: UnfoldableAppTagUse[] = [];
    for (const scene of listScenesInDocumentOrder(document)) {
        const blocks = listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) });
        for (const block of blocks) {
            for (const expression of collectBlockExpressions(block)) {
                if (foldStoryExpression(expression.ast, options).unfoldable) {
                    found.push({
                        storyId: document.id,
                        storyName: document.name,
                        sceneId: scene.id,
                        sceneName: scene.name,
                        blockId: block.id,
                        source: expression.source,
                    });
                }
            }
        }
    }
    return found;
}

/**
 * The document a package under this variant carries.
 *
 * Pure: the project on disk is never touched, and calling this twice with the same arguments gives
 * the same answer. Two passes, in this order:
 *
 *  1. **Elimination.** A condition branch the variant cannot take, and a choice option it can never
 *     show, are deleted outright - block and whole descendant subtree, out of `scene.blocks`.
 *     Unlinking from `childrenIds` alone would leave every line of the branch sitting in the JSON,
 *     which is precisely the shipping-it-anyway this exists to stop.
 *  2. **Folding.** Every remaining expression that mentions `AppTag` reduces to a literal, wherever
 *     it appears - a branch condition, a choice option's `hiddenWhen`, a loop's `until`, an inline
 *     interpolation, an assignment. Folding *everywhere* is what makes "AppTag has no play-time
 *     value" a fact rather than a claim about the places anyone remembered.
 */
export function applyAppTagToStoryDocument(document: StoryDocument, options: AppTagFoldOptions): StoryDocument {
    let changed = false;
    const scenes: Record<string, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
        const next = pruneScene(scene, options);
        changed ||= next !== scene;
        scenes[sceneId] = next;
    }
    const pruned = changed ? { ...document, scenes } : document;
    return foldExpressionsDeep(pruned, options);
}

// ── Folding one tree ──────────────────────────────────────────────────────────────────────────────

/**
 * Rebuild the tree with `AppTag` replaced and every now-constant subtree collapsed.
 *
 * The rebuild is an explicit switch rather than a generic child walk, because folding is the one
 * operation here that has to *construct* nodes, and two of them (`?:` and the short-circuiting
 * operators) collapse in a way no generic rule expresses: a decided test selects a branch that is
 * itself not constant, which is exactly how a variant-only line disappears while the surrounding
 * story keeps reading a variable.
 */
function foldNode(expr: StoryExpr, tagName: string): StoryExpr {
    switch (expr.kind) {
        case "literal":
        case "var":
        case "visited":
        case "invoke":
        case "invalid":
            return expr;

        case "call":
            return isAppTagExpr(expr)
                ? { kind: "literal", value: tagName }
                : constantFold({ kind: "call", fn: expr.fn, args: expr.args.map(arg => foldNode(arg, tagName)) });

        case "unary":
            return constantFold({ kind: "unary", op: expr.op, operand: foldNode(expr.operand, tagName) });

        case "array":
            return constantFold({ kind: "array", items: expr.items.map(item => foldNode(item, tagName)) });

        case "index":
            return constantFold({
                kind: "index",
                target: foldNode(expr.target, tagName),
                index: foldNode(expr.index, tagName),
            });

        case "ternary": {
            const test = foldNode(expr.test, tagName);
            const consequent = foldNode(expr.consequent, tagName);
            const alternate = foldNode(expr.alternate, tagName);
            // A decided test drops the other arm entirely, constant or not. This is the ternary's
            // half of the branch elimination: `AppTag == "Demo" ? demoLine : realLine` keeps one.
            if (test.kind === "literal") {
                return isTruthy(test.value) ? consequent : alternate;
            }
            return { kind: "ternary", test, consequent, alternate };
        }

        case "binary": {
            const left = foldNode(expr.left, tagName);
            const right = foldNode(expr.right, tagName);
            // Short-circuit exactly where the evaluator does, and only where the answer is settled by
            // the left operand alone. `true && x` is NOT `x` in this language (`&&` yields a boolean,
            // not the surviving operand), so it is left to the constant fold below.
            if (expr.op === "&&" && left.kind === "literal" && !isTruthy(left.value)) {
                return { kind: "literal", value: false };
            }
            if (expr.op === "||" && left.kind === "literal" && isTruthy(left.value)) {
                return { kind: "literal", value: true };
            }
            return constantFold({ kind: "binary", op: expr.op, left, right });
        }
    }
}

/** A node whose value is already decided becomes that value. Anything else passes through. */
function constantFold(expr: StoryExpr): StoryExpr {
    if (!isConstantExpr(expr)) {
        return expr;
    }
    // The reader is never called: `isConstantExpr` has already refused every node that reads
    // anything. Evaluation here is the language's own, so a folded value and a played one can never
    // be two different answers to the same expression.
    return { kind: "literal", value: evaluateStoryExpression(expr, { read: () => undefined }) };
}

/**
 * Whether a tree's value is fixed by the tree alone.
 *
 * Three exclusions, each of which would otherwise bake a wrong answer into the package: a `var`,
 * `visited` or `invoke` reads state the build does not have; `random`/`randomInt` would freeze one
 * roll into every play; and an `invalid` subtree never had a value to begin with.
 */
function isConstantExpr(expr: StoryExpr): boolean {
    if (!isStoryExpressionEvaluable(expr)) {
        return false;
    }
    switch (expr.kind) {
        case "var":
        case "visited":
        case "invoke":
            return false;
        case "call":
            if (expr.fn === "random" || expr.fn === "randomInt" || expr.fn === "appTag") {
                return false;
            }
            break;
        default:
            break;
    }
    return storyExprChildren(expr).every(isConstantExpr);
}

// ── Elimination ───────────────────────────────────────────────────────────────────────────────────

/** An `if` branch that always runs - what an `else` becomes when it is the only branch left. */
const ALWAYS: StoryConditionRef = {
    kind: "expression",
    expression: { source: "true", ast: { kind: "literal", value: true } },
};

type ConditionBranchBlock = StoryBlock & { kind: "control"; payload: Extract<StoryControlPayload, { control: "conditionBranch" }> };

function isConditionBlock(block: StoryBlock): boolean {
    return block.kind === "control" && block.payload.control === "condition";
}

function asConditionBranch(block: StoryBlock | undefined): ConditionBranchBlock | null {
    return block?.kind === "control" && block.payload.control === "conditionBranch"
        ? block as ConditionBranchBlock
        : null;
}

function pruneScene(scene: StoryScene, options: AppTagFoldOptions): StoryScene {
    const removed = new Set<StoryBlockId>();
    const rewritten = new Map<StoryBlockId, StoryBlock>();

    for (const block of Object.values(scene.blocks)) {
        if (block.kind === "nodeAction"
            && block.payload.action === "choiceOption"
            && staticConditionValue(block.payload.hiddenWhen, options) === "true") {
            // An option that can never appear takes its text with it. Leaving the row and only
            // hiding it would ship another variant's words inside this one's menu data.
            removed.add(block.id);
            continue;
        }
        if (isConditionBlock(block)) {
            planCondition(scene, block, options, removed, rewritten);
        }
    }

    if (removed.size === 0 && rewritten.size === 0) {
        return scene;
    }
    return rebuildScene(scene, expandToSubtrees(scene, removed), rewritten);
}

/**
 * Which of a condition's branches survive, and what the first survivor has to be called.
 *
 * The walk mirrors what the compiler will do with the result (`compileCondition`): branches in
 * order, disabled ones already gone, the first non-`else` becoming `Condition.If` and the rest
 * `.ElseIf` / `.Else`.
 *
 *  - A branch that folds to `false` is deleted; nothing it contains can run under this variant.
 *  - A branch that folds to `true` is kept, and every branch after it is deleted; nothing after a
 *    branch that always runs can run either.
 *  - Anything else - a condition the game decides, a bare `else`, a half-written row with no
 *    condition at all - is left exactly as it is, condition and all.
 *
 * A disabled branch decides nothing: the compiler drops it before it looks at conditions, so
 * treating one as "taken" would keep a branch the runtime never sees and delete the one it does.
 */
function planCondition(
    scene: StoryScene,
    block: StoryBlock,
    options: AppTagFoldOptions,
    removed: Set<StoryBlockId>,
    rewritten: Map<StoryBlockId, StoryBlock>,
): void {
    const branches = block.childrenIds
        .map(childId => asConditionBranch(scene.blocks[childId]))
        .filter((branch): branch is ConditionBranchBlock => branch !== null);

    const kept: ConditionBranchBlock[] = [];
    let dropped = false;
    let taken = false;
    for (const branch of branches) {
        if (taken) {
            removed.add(branch.id);
            dropped = true;
            continue;
        }
        if (branch.disabled) {
            continue;
        }
        const truth = branch.payload.branch === "else"
            ? "unknown"
            : staticConditionValue(branch.payload.condition, options);
        if (truth === "false") {
            removed.add(branch.id);
            dropped = true;
            continue;
        }
        kept.push(branch);
        taken = truth === "true";
    }

    if (!dropped) {
        return;
    }
    if (kept.length === 0) {
        // Nothing left to run, and an `if`-less condition is a warning plus no statements at the
        // compiler anyway - so the whole block goes, taking any disabled branches with it.
        removed.add(block.id);
        return;
    }
    const head = kept[0];
    if (head.payload.branch === "if") {
        return;
    }
    // The survivor has to read as the head of the chain. An `else` additionally needs a condition:
    // an `if` without one compiles to a constant false, which would delete at play time exactly the
    // branch this fold just proved always runs.
    rewritten.set(head.id, {
        ...head,
        payload: {
            ...head.payload,
            branch: "if",
            condition: head.payload.condition ?? ALWAYS,
        },
    });
}

/** Every removed block plus everything under it. A branch's rows live in the same flat map it does. */
function expandToSubtrees(scene: StoryScene, roots: ReadonlySet<StoryBlockId>): Set<StoryBlockId> {
    const all = new Set<StoryBlockId>();
    const visit = (blockId: StoryBlockId): void => {
        if (all.has(blockId)) {
            return;
        }
        all.add(blockId);
        for (const childId of scene.blocks[blockId]?.childrenIds ?? []) {
            visit(childId);
        }
    };
    roots.forEach(visit);
    return all;
}

function rebuildScene(
    scene: StoryScene,
    removed: ReadonlySet<StoryBlockId>,
    rewritten: ReadonlyMap<StoryBlockId, StoryBlock>,
): StoryScene {
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    for (const [blockId, block] of Object.entries(scene.blocks)) {
        if (removed.has(blockId)) {
            continue;
        }
        const source = rewritten.get(blockId) ?? block;
        const childrenIds = source.childrenIds.filter(childId => !removed.has(childId));
        blocks[blockId] = childrenIds.length === source.childrenIds.length
            ? source
            : { ...source, childrenIds };
    }
    return {
        ...scene,
        rootBlockIds: scene.rootBlockIds.filter(blockId => !removed.has(blockId)),
        blocks,
    };
}

// ── Folding everything a document holds ───────────────────────────────────────────────────────────

/**
 * Whether a value is a stored expression.
 *
 * Structural rather than a list of the fields that hold one, and that is the point: an expression can
 * sit in a branch condition, a choice option's two conditions, a loop's `until`, an assignment's
 * right-hand side and an inline interpolation, and the list has grown with every schema version. A
 * walk that misses a site does not fail - it ships that site's `AppTag` into the package, which is
 * the one outcome this module exists to make impossible.
 */
function isStoryExpression(value: unknown): value is StoryExpression {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const record = value as { source?: unknown; ast?: unknown };
    return typeof record.source === "string"
        && Boolean(record.ast)
        && typeof record.ast === "object"
        && typeof (record.ast as { kind?: unknown }).kind === "string";
}

/** Every expression a block carries, wherever in its payload it sits. */
function collectBlockExpressions(block: StoryBlock): StoryExpression[] {
    const found: StoryExpression[] = [];
    const walk = (value: unknown, seen: Set<object>): void => {
        if (!value || typeof value !== "object") {
            return;
        }
        if (isStoryExpression(value)) {
            found.push(value);
            return;
        }
        if (seen.has(value)) {
            return;
        }
        seen.add(value);
        for (const child of Array.isArray(value) ? value : Object.values(value)) {
            walk(child, seen);
        }
    };
    // The payload only: `childrenIds` and `parentId` are ids, and walking them would re-read the
    // whole scene once per block.
    walk(block.payload, new Set<object>());
    return found;
}

/**
 * Fold every expression anywhere under `value`, returning the same reference when nothing changed.
 *
 * Identity on no-change is not an optimisation: this runs on every Dev Mode reload over every story
 * in the project, and a walk that rebuilt each document wholesale would churn the entire library on
 * a save that touched one line.
 */
function foldExpressionsDeep<T>(value: T, options: AppTagFoldOptions): T {
    if (!value || typeof value !== "object") {
        return value;
    }
    if (isStoryExpression(value)) {
        const fold = foldStoryExpression(value.ast, options);
        if (!fold.mentioned || fold.ast === value.ast) {
            return value;
        }
        // The source is re-printed from the folded tree, not kept: it is what the editor and the
        // diff read back, and a stored `AppTag == "Demo"` beside a tree that says `false` is two
        // answers to one question. An unfoldable tree still prints, and the build gate is what stops
        // one from getting this far.
        return { source: formatStoryExpr(fold.ast), ast: fold.ast } as T;
    }
    if (Array.isArray(value)) {
        let changed = false;
        const items = value.map(item => {
            const next = foldExpressionsDeep(item, options);
            changed ||= next !== item;
            return next;
        });
        return (changed ? items : value) as T;
    }
    let changed = false;
    const record: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const next = foldExpressionsDeep(child, options);
        changed ||= next !== child;
        record[key] = next;
    }
    return (changed ? record : value) as T;
}
