import { describe, expect, it } from "vitest";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    type StoryBlock,
    type StoryConditionRef,
    type StoryDocument,
    type StoryScene,
    type StoryTextSegment,
} from "@shared/types/story";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";
import {
    applyAppTagToStoryDocument,
    collectUnfoldableAppTagUses,
    foldStoryExpression,
    staticConditionValue,
} from "./appTagFold";

/**
 * The fold, and the elimination it drives.
 *
 * The assertion that matters most, and the reason this file exists, is that an eliminated branch is
 * gone from `scene.blocks` - not merely unlinked from `childrenIds`. The story compiler runs inside
 * the shipped game, so a block left in that map ships its every line to the player whatever the
 * parent points at, and a test that only checked the links would pass on a package that still
 * carried the demo's dialogue.
 */

const SCOPE = createStoryExpressionScope(
    [{ name: "gold", ref: { scope: "scene", variableId: "var-gold" } }],
    { scenes: [{ id: "scene-1", name: "Intro" }] },
);

function parse(source: string) {
    return parseStoryExpression(source, SCOPE).expression;
}

function condition(source: string): StoryConditionRef {
    return { kind: "expression", expression: parse(source) };
}

function segment(value: string): StoryTextSegment {
    return { textId: `text-${value}`, value, role: "narration" };
}

let nextId = 0;

function block(partial: Partial<StoryBlock> & Pick<StoryBlock, "kind" | "payload">): StoryBlock {
    nextId += 1;
    return {
        id: partial.id ?? `b${nextId}`,
        parentId: partial.parentId ?? null,
        childrenIds: partial.childrenIds ?? [],
        ...partial,
    } as StoryBlock;
}

function scene(blocks: StoryBlock[], rootBlockIds: string[]): StoryScene {
    return {
        id: "scene-1",
        name: "Intro",
        runtimeName: "intro",
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(entry => [entry.id, entry])),
    };
}

function document(built: StoryScene): StoryDocument {
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Story",
        chapters: [],
        scenes: { [built.id]: built },
    };
}

/** `if <source> { narration }` `else { narration }`, as the flat block map a scene really holds. */
function conditionScene(branches: { branch: "if" | "elseIf" | "else"; source?: string; line: string; disabled?: boolean }[]): StoryScene {
    const blocks: StoryBlock[] = [];
    const branchIds: string[] = [];
    branches.forEach((entry, index) => {
        const branchId = `branch-${index}`;
        const lineId = `line-${index}`;
        branchIds.push(branchId);
        blocks.push(block({
            id: branchId,
            kind: "control",
            parentId: "cond",
            childrenIds: [lineId],
            payload: {
                control: "conditionBranch",
                branch: entry.branch,
                ...(entry.source ? { condition: condition(entry.source) } : {}),
            },
            ...(entry.disabled ? { disabled: true } : {}),
        }));
        blocks.push(block({
            id: lineId,
            kind: "nodeAction",
            parentId: branchId,
            payload: { action: "narration", text: segment(entry.line) },
        }));
    });
    blocks.push(block({ id: "cond", kind: "control", childrenIds: branchIds, payload: { control: "condition" } }));
    return scene(blocks, ["cond"]);
}

describe("foldStoryExpression", () => {
    it("returns an expression that never names the variant untouched", () => {
        const ast = parse("gold >= 100").ast;
        const fold = foldStoryExpression(ast, { tagName: "Demo" });
        expect(fold.ast).toBe(ast);
        expect(fold.mentioned).toBe(false);
        expect(fold.unfoldable).toBe(false);
    });

    it("reduces the constant to the variant's name", () => {
        expect(foldStoryExpression(parse("AppTag").ast, { tagName: "Demo" }).ast)
            .toEqual({ kind: "literal", value: "Demo" });
    });

    it("decides a comparison exactly and case-sensitively", () => {
        const ast = parse("AppTag == \"Demo\"").ast;
        expect(foldStoryExpression(ast, { tagName: "Demo" }).ast).toEqual({ kind: "literal", value: true });
        expect(foldStoryExpression(ast, { tagName: "Release" }).ast).toEqual({ kind: "literal", value: false });
        expect(foldStoryExpression(ast, { tagName: "demo" }).ast).toEqual({ kind: "literal", value: false });
    });

    it("reports a comparison the build cannot decide", () => {
        for (const source of ["AppTag == gold", "AppTag == visited(Intro)", "gold > 0 ? AppTag : \"x\""]) {
            const fold = foldStoryExpression(parse(source).ast, { tagName: "Demo" });
            expect(fold.mentioned, source).toBe(true);
            expect(fold.unfoldable, source).toBe(true);
        }
    });

    it("keeps only the arm a decided test selects, so the other's variable read never survives", () => {
        const fold = foldStoryExpression(parse("AppTag == \"Demo\" ? \"demo\" : gold").ast, { tagName: "Demo" });
        expect(fold.unfoldable).toBe(false);
        expect(fold.ast).toEqual({ kind: "literal", value: "demo" });
    });

    it("short-circuits where the evaluator does", () => {
        expect(foldStoryExpression(parse("AppTag == \"Demo\" && gold > 0").ast, { tagName: "Release" }).ast)
            .toEqual({ kind: "literal", value: false });
        expect(foldStoryExpression(parse("AppTag == \"Demo\" || gold > 0").ast, { tagName: "Demo" }).ast)
            .toEqual({ kind: "literal", value: true });
    });

    it("never freezes a random roll into the package", () => {
        // Reported rather than evaluated: baking one roll into the bytes would make every play of
        // every copy take the same branch.
        expect(foldStoryExpression(parse("AppTag == \"Demo\" ? random() : 0").ast, { tagName: "Demo" }).unfoldable)
            .toBe(true);
        expect(foldStoryExpression(parse("AppTag == \"Demo\" ? random() : 0").ast, { tagName: "Release" }).ast)
            .toEqual({ kind: "literal", value: 0 });
    });
});

describe("staticConditionValue", () => {
    it("leaves every condition the game decides alone", () => {
        expect(staticConditionValue(condition("gold >= 100"), { tagName: "Demo" })).toBe("unknown");
        expect(staticConditionValue(undefined, { tagName: "Demo" })).toBe("unknown");
        expect(staticConditionValue({ kind: "blueprint", blueprintId: "bp" }, { tagName: "Demo" })).toBe("unknown");
    });

    it("does not fold an ordinary condition that happens to be constant", () => {
        // `/if true` is the author's own row, not a variant decision. Deciding it here would delete
        // the `else` they are still writing.
        expect(staticConditionValue(condition("true"), { tagName: "Demo" })).toBe("unknown");
    });

    it("decides a condition that names the variant", () => {
        expect(staticConditionValue(condition("AppTag == \"Demo\""), { tagName: "Demo" })).toBe("true");
        expect(staticConditionValue(condition("AppTag == \"Demo\""), { tagName: "Release" })).toBe("false");
    });
});

describe("collectUnfoldableAppTagUses", () => {
    it("names the story, the scene, the row and the author's own text", () => {
        const built = document(conditionScene([{ branch: "if", source: "AppTag == gold", line: "demo" }]));
        expect(collectUnfoldableAppTagUses(built, { tagName: "Demo" })).toEqual([{
            storyId: "story-1",
            storyName: "Story",
            sceneId: "scene-1",
            sceneName: "Intro",
            blockId: "branch-0",
            source: "AppTag == gold",
        }]);
    });

    it("says nothing about a disabled row", () => {
        const built = document(conditionScene([{ branch: "if", source: "AppTag == gold", line: "demo", disabled: true }]));
        expect(collectUnfoldableAppTagUses(built, { tagName: "Demo" })).toEqual([]);
    });

    it("says nothing about a comparison that decides", () => {
        const built = document(conditionScene([{ branch: "if", source: "AppTag == \"Demo\"", line: "demo" }]));
        expect(collectUnfoldableAppTagUses(built, { tagName: "Release" })).toEqual([]);
    });
});

describe("applyAppTagToStoryDocument", () => {
    it("deletes a branch the variant cannot take, and its whole subtree, from the block map", () => {
        const built = document(conditionScene([
            { branch: "if", source: "AppTag == \"Demo\"", line: "only in the demo" },
            { branch: "else", line: "everywhere else" },
        ]));
        const out = applyAppTagToStoryDocument(built, { tagName: "Release" });
        const result = out.scenes["scene-1"];

        expect(Object.keys(result.blocks)).not.toContain("branch-0");
        // The row INSIDE the branch is the whole point: unlinking the branch would leave this here,
        // and the package would carry the demo's line.
        expect(Object.keys(result.blocks)).not.toContain("line-0");
        expect(result.blocks.cond.childrenIds).toEqual(["branch-1"]);
        expect(result.blocks["line-1"]).toBeTruthy();
    });

    it("keeps a branch that always runs and drops everything after it", () => {
        const built = document(conditionScene([
            { branch: "if", source: "AppTag == \"Demo\"", line: "demo" },
            { branch: "elseIf", source: "gold > 0", line: "rich" },
            { branch: "else", line: "poor" },
        ]));
        const result = applyAppTagToStoryDocument(built, { tagName: "Demo" }).scenes["scene-1"];

        expect(result.blocks.cond.childrenIds).toEqual(["branch-0"]);
        expect(result.blocks["line-1"]).toBeUndefined();
        expect(result.blocks["line-2"]).toBeUndefined();
    });

    it("makes the surviving else a head the compiler can build from", () => {
        const built = document(conditionScene([
            { branch: "if", source: "AppTag == \"Demo\"", line: "demo" },
            { branch: "else", line: "everywhere else" },
        ]));
        const result = applyAppTagToStoryDocument(built, { tagName: "Release" }).scenes["scene-1"];
        const head = result.blocks["branch-1"];

        expect(head.kind === "control" && head.payload.control === "conditionBranch" && head.payload.branch).toBe("if");
        // An `if` with no condition compiles to a constant false, which would delete at play time
        // exactly the branch the fold just proved always runs.
        expect(head.kind === "control" && head.payload.control === "conditionBranch" && head.payload.condition)
            .toEqual({ kind: "expression", expression: { source: "true", ast: { kind: "literal", value: true } } });
    });

    it("drops the whole condition when no branch survives", () => {
        const built = document(conditionScene([{ branch: "if", source: "AppTag == \"Demo\"", line: "demo" }]));
        const result = applyAppTagToStoryDocument(built, { tagName: "Release" }).scenes["scene-1"];

        expect(result.rootBlockIds).toEqual([]);
        expect(Object.keys(result.blocks)).toEqual([]);
    });

    it("leaves a condition the game decides exactly as it was", () => {
        const built = document(conditionScene([
            { branch: "if", source: "gold > 0", line: "rich" },
            { branch: "else", line: "poor" },
        ]));
        expect(applyAppTagToStoryDocument(built, { tagName: "Release" })).toBe(built);
    });

    it("does not let a disabled branch decide the chain", () => {
        // The compiler drops a disabled branch before it looks at conditions, so treating this one
        // as taken would keep a branch the runtime never sees and delete the one it does.
        const built = document(conditionScene([
            { branch: "if", source: "AppTag == \"Demo\"", line: "demo", disabled: true },
            { branch: "elseIf", source: "AppTag == \"Demo\"", line: "also demo" },
            { branch: "else", line: "everywhere else" },
        ]));
        const result = applyAppTagToStoryDocument(built, { tagName: "Demo" }).scenes["scene-1"];

        expect(result.blocks["line-1"]).toBeTruthy();
        expect(result.blocks["line-2"]).toBeUndefined();
    });

    it("removes a choice option it can never show, text and all", () => {
        const built = document(scene([
            block({ id: "choice", kind: "nodeAction", childrenIds: ["opt"], payload: { action: "choice" } }),
            block({
                id: "opt",
                kind: "nodeAction",
                parentId: "choice",
                childrenIds: ["opt-line"],
                payload: {
                    action: "choiceOption",
                    text: segment("Buy the full game"),
                    hiddenWhen: condition("AppTag != \"Demo\""),
                },
            }),
            block({ id: "opt-line", kind: "nodeAction", parentId: "opt", payload: { action: "narration", text: segment("thanks") } }),
        ], ["choice"]));
        const result = applyAppTagToStoryDocument(built, { tagName: "Release" }).scenes["scene-1"];

        expect(result.blocks.opt).toBeUndefined();
        expect(result.blocks["opt-line"]).toBeUndefined();
        expect(result.blocks.choice.childrenIds).toEqual([]);
    });

    it("folds a loop's stop condition and an inline interpolation, source included", () => {
        const built = document(scene([
            block({ id: "loop", kind: "control", payload: { control: "repeat", until: condition("AppTag == \"Demo\"") } }),
            block({
                id: "line",
                kind: "nodeAction",
                payload: {
                    action: "narration",
                    text: {
                        textId: "t1",
                        value: "edition",
                        role: "narration",
                        rich: [{ interpolation: { kind: "expression", expression: parse("AppTag") } }],
                    },
                },
            }),
        ], ["loop", "line"]));
        const result = applyAppTagToStoryDocument(built, { tagName: "Demo" }).scenes["scene-1"];
        const loop = result.blocks.loop;
        const line = result.blocks.line;

        expect(loop.kind === "control" && loop.payload.control === "repeat" && loop.payload.until)
            .toEqual({ kind: "expression", expression: { source: "true", ast: { kind: "literal", value: true } } });
        // The stored source is re-printed from the folded tree: a source still reading `AppTag`
        // beside a tree that says `"Demo"` would be two answers to one question.
        expect(line.kind === "nodeAction" && line.payload.action === "narration" && line.payload.text.rich)
            .toEqual([{ interpolation: { kind: "expression", expression: { source: "\"Demo\"", ast: { kind: "literal", value: "Demo" } } } }]);
    });
});
