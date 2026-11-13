import type { StoryVariableRef } from "@shared/types/story";
import { describe, expect, it } from "vitest";
import { createStoryExpressionScope, parseStoryExpression } from "./storyExpressionParser";
import { renameInStoryExpression } from "./storyExpressionRename";

const GOLD_SCENE: StoryVariableRef = { scope: "scene", variableId: "v_gold" };
const GOLD_SAVED: StoryVariableRef = { scope: "saved", variableId: "s_gold" };
const MET: StoryVariableRef = { scope: "scene", variableId: "v_met" };

const SCOPE = createStoryExpressionScope(
    [
        { name: "gold", ref: GOLD_SCENE },
        { name: "gold", ref: GOLD_SAVED },
        { name: "met", ref: MET },
    ],
    { scenes: [{ id: "sc_one", name: "Corridor" }, { id: "sc_two", name: "Hall" }] },
);

const parse = (source: string) => parseStoryExpression(source, SCOPE).expression;

describe("renameInStoryExpression", () => {
    it("rewrites only the token that resolved to the variable, keeping the author's spacing", () => {
        const result = renameInStoryExpression(parse("gold   >= 100 && met"), { kind: "variable", ref: GOLD_SCENE, newName: "coins" });
        expect(result).toMatchObject({ status: "rewritten", occurrences: 1, reformatted: false });
        if (result.status !== "rewritten") throw new Error("unreachable");
        expect(result.expression.source).toBe("coins   >= 100 && met");
        expect(result.expression.ast).toMatchObject({ kind: "binary", left: { left: { kind: "var", name: "coins", target: GOLD_SCENE } } });
    });

    it("tells a shadowed name from the variable it shadows", () => {
        const expression = parse("gold + saved.gold");
        const saved = renameInStoryExpression(expression, { kind: "variable", ref: GOLD_SAVED, newName: "bank" });
        expect(saved.status === "rewritten" && saved.expression.source).toBe("gold + saved.bank");
        const scene = renameInStoryExpression(expression, { kind: "variable", ref: GOLD_SCENE, newName: "purse" });
        expect(scene.status === "rewritten" && scene.expression.source).toBe("purse + saved.gold");
    });

    it("quotes a new name that does not lex as one identifier", () => {
        const result = renameInStoryExpression(parse("gold * 2"), { kind: "variable", ref: GOLD_SCENE, newName: "my gold" });
        expect(result.status === "rewritten" && result.expression.source).toBe("'my gold' * 2");
    });

    it("falls back to printing the tree when a prefixed read cannot keep its prefix", () => {
        const result = renameInStoryExpression(parse("saved.gold > 1"), { kind: "variable", ref: GOLD_SAVED, newName: "my bank" });
        expect(result).toMatchObject({ status: "rewritten", reformatted: true });
        if (result.status !== "rewritten") throw new Error("unreachable");
        expect(result.expression.ast).toMatchObject({ left: { kind: "var", name: "my bank", target: GOLD_SAVED } });
    });

    it("leaves an expression that does not read the variable alone", () => {
        expect(renameInStoryExpression(parse("met"), { kind: "variable", ref: GOLD_SCENE, newName: "x" })).toEqual({ status: "unchanged" });
    });

    it("repairs a source still carrying a name from an earlier rename", () => {
        // The declaration became `coins` without the text following; the tree still knows the read.
        const stale = parse("gold + 1");
        const result = renameInStoryExpression(stale, { kind: "variable", ref: GOLD_SCENE, newName: "money" });
        expect(result.status === "rewritten" && result.expression.source).toBe("money + 1");
    });

    it("renames a scene inside visited() and nothing else", () => {
        const result = renameInStoryExpression(parse("visited(Corridor) || visited(Hall)"), { kind: "scene", sceneId: "sc_one", newName: "Long Corridor" });
        expect(result.status === "rewritten" && result.expression.source).toBe("visited('Long Corridor') || visited(Hall)");
    });
});
