import { describe, expect, it } from "vitest";
import { story as en } from "@shared/i18n/catalog/en/story";
import { getCommandGhost, paramHintKey } from "./storyCommandGhost";
import { listCommandDefs } from "./storyCommandGrammar";

/**
 * The ghost hint's contract, written the way the author experiences it: type a prefix, see (or not
 * see) the name of the slot the next token would fill.
 *
 * `|` marks the caret. Every case here is a position the author actually passes through while typing
 * a line, which is why the "shows nothing" cases outnumber the rest — the hint is decoration over a
 * text field, and being wrong is worse than being absent.
 */
function ghostAt(sourceWithCaret: string): string | null {
    const caret = sourceWithCaret.indexOf("|");
    const source = sourceWithCaret.replace("|", "");
    return getCommandGhost(source, caret)?.hintKey ?? null;
}

describe("getCommandGhost", () => {
    it("names the first slot once the command token is complete", () => {
        // The case the whole feature exists for: `/local ` used to be a blank line with an empty menu.
        expect(ghostAt("/local |")).toBe("variableName");
        expect(ghostAt("/var |")).toBe("variableName");
        expect(ghostAt("/persis |")).toBe("variableName");
        expect(ghostAt("/set |")).toBe("variable");
        expect(ghostAt("/if |")).toBe("condition");
        expect(ghostAt("/bg |")).toBe("imageOrColor");
        expect(ghostAt("/say |")).toBe("speaker");
    });

    it("advances to the next slot as positionals are filled", () => {
        expect(ghostAt("/local hp |")).toBe("defaultValue");
        expect(ghostAt("/set gold |")).toBe("expressionValue");
        expect(ghostAt("/inc gold |")).toBe("amount");
        expect(ghostAt("/say alice |")).toBe("lineText");
    });

    it("advertises the named modifiers once the positionals are done", () => {
        // A finished line should still say what else it can take, or `t=`/`d=` stay undiscoverable.
        expect(ghostAt("/local hp 100 |")).toBe("valueType");
        expect(ghostAt("/bg forest |")).toBe("transition");
    });

    it("does not count a key=value token as filling a positional", () => {
        // `type=` is named; the default is still unfilled and is still what comes next.
        expect(ghostAt("/local hp type=number |")).toBe("defaultValue");
    });

    it("shows nothing mid-word, where the candidate menu is already answering", () => {
        // Two hints for one slot in the same place would fight; the menu is the better answer because
        // it lists actual values.
        expect(ghostAt("/loc|")).toBe(null);
        expect(ghostAt("/local h|")).toBe(null);
        expect(ghostAt("/set gol|")).toBe(null);
    });

    it("shows nothing when the caret is not at the end of the line", () => {
        // The ghost renders after the text, so anywhere else it would describe the wrong slot.
        expect(ghostAt("/local | hp")).toBe(null);
        expect(ghostAt("/set |gold 100")).toBe(null);
    });

    it("shows nothing after a greedy param has claimed the line", () => {
        expect(ghostAt("/say alice hello there |")).toBe(null);
        expect(ghostAt("/if gold >= 100 |")).toBe(null);
        expect(ghostAt("/set gold gold + 1 |")).toBe(null);
    });

    it("shows nothing on a line that is not a command, or does not parse as one", () => {
        expect(ghostAt("just narration |")).toBe(null);
        expect(ghostAt("#alice |")).toBe(null);
        expect(ghostAt("/nosuchcommand |")).toBe(null);
        expect(ghostAt("|")).toBe(null);
        // A line already carrying an error has a worse problem than a missing hint.
        expect(ghostAt("/bg forest bogus=1 |")).toBe(null);
    });

    it("shows nothing once every slot is filled", () => {
        expect(ghostAt("/toggle met |")).toBe(null);
    });
});

describe("hint keys", () => {
    it("gives every declared param a hint key that the catalog actually defines", () => {
        // The renderer resolves `story.paramHint.<key>`; a key with no entry would render the raw
        // dotted path into the row, which is worse than showing nothing at all.
        const defined = new Set(Object.keys(en.paramHint));
        const missing: string[] = [];
        for (const def of listCommandDefs()) {
            for (const param of def.params) {
                const key = paramHintKey(param);
                if (!defined.has(key)) {
                    missing.push(`/${def.token} ${param.name} → ${key}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });
});
