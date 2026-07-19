import { describe, expect, it } from "vitest";
import { getCommandCandidates, hasCandidateSource } from "./storyCommandCandidates";
import { getCommandDef } from "./storyCommandGrammar";
import { completionFor, defaultHighlights, getCommandCursor, type StoryCommandCursor } from "./storyCommandCursor";
import type { StoryCommandContext } from "./storyCommandResolution";

const CONTEXT: StoryCommandContext = {
    images: [{ id: "i1", name: "forest_day" }, { id: "i2", name: "forest_night" }, { id: "i3", name: "city rain" }],
    audio: [{ id: "a1", name: "theme" }],
    videos: [],
    characters: [{ id: "c1", name: "Alice" }, { id: "c2", name: "Bob" }],
    tempSpeakers: ["Zoe"],
    scenes: [{ id: "s1", name: "Chapter 2" }],
    variables: [{ name: "gold", ref: { scope: "scene", variableId: "v1" }, valueType: "number" }],
    formsByCharacterId: { c1: ["smile", "angry"] },
    stageObjects: { image: ["hero", "portrait"], text: ["title"], layer: ["fx"], video: ["intro"], audio: ["sound", "music"] },
};

/** Caret marked with `|`. */
function at(marked: string): StoryCommandCursor {
    const caret = marked.indexOf("|");
    if (caret < 0) {
        throw new Error("mark the caret with |");
    }
    return getCommandCursor(marked.replace("|", ""), caret);
}

function values(marked: string, resolved = {}): string[] {
    return getCommandCandidates(at(marked), CONTEXT, resolved).map(candidate => candidate.value);
}

describe("getCommandCursor", () => {
    it("is naming the command right after the slash and while typing it", () => {
        expect(at("/|")).toMatchObject({ kind: "commandName", query: "" });
        expect(at("/b|")).toMatchObject({ kind: "commandName", query: "b" });
        expect(at("/bg|")).toMatchObject({ kind: "commandName", query: "bg" });
    });

    it("moves to the first positional once the command is followed by a space", () => {
        expect(at("/bg |")).toMatchObject({ kind: "positional", query: "" });
        expect(at("/bg fo|")).toMatchObject({ kind: "positional", query: "fo" });
    });

    it("offers param names once every positional is given", () => {
        const cursor = at("/bg forest_day |");
        expect(cursor.kind).toBe("paramName");
        expect((cursor as Extract<StoryCommandCursor, { kind: "paramName" }>).params.map(p => p.name)).toEqual(["t", "d"]);
    });

    it("drops a param name that the line already carries", () => {
        const cursor = at("/bg forest_day t=fade |");
        expect((cursor as Extract<StoryCommandCursor, { kind: "paramName" }>).params.map(p => p.name)).toEqual(["d"]);
    });

    it("switches to the value once the caret is past the equals", () => {
        expect(at("/bg forest_day t=|")).toMatchObject({ kind: "paramValue", query: "" });
        expect(at("/bg forest_day t=fa|")).toMatchObject({ kind: "paramValue", query: "fa" });
    });

    it("is still naming the param while the caret sits before the equals", () => {
        expect(at("/bg forest_day t|=fade")).toMatchObject({ kind: "paramName" });
    });

    it("reads a greedy body as prose with nothing to offer", () => {
        expect(at("/say Alice hello |there")).toEqual({ kind: "greedy" });
        expect(at("/say Alice |")).toEqual({ kind: "greedy" });
    });

    it("names the speaker after a hash and treats the rest as the line", () => {
        expect(at("#Ali|")).toMatchObject({ kind: "characterName", query: "Ali" });
        expect(at("#Alice hello |")).toEqual({ kind: "greedy" });
    });

    it("offers nothing for prose, an empty line, or an unknown command", () => {
        expect(at("he said |so")).toEqual({ kind: "none" });
        expect(at("|")).toEqual({ kind: "none" });
        expect(at("/bgg |")).toEqual({ kind: "none" });
    });

    it("counts positionals by their own token, so editing an earlier one stays put", () => {
        expect(at("/set go|ld 100")).toMatchObject({ kind: "positional", query: "go" });
        // `/set`'s right-hand side is a greedy expression, so the caret there is in an `expression`
        // slot rather than a plain positional - but it still reports the fragment under the caret, so
        // editing an earlier character stays put exactly as it did.
        expect(at("/set gold 10|0")).toMatchObject({ kind: "expression", query: "10" });
    });

    it("narrows an expression to the identifier under the caret, not the whole line", () => {
        // This is what lets a completion replace `go` with `gold` in the middle of `gold + 1` rather
        // than clobbering the expression the author is halfway through writing.
        expect(at("/set gold go| + 1")).toMatchObject({ kind: "expression", query: "go" });
        expect(at("/set gold gold + go|")).toMatchObject({ kind: "expression", query: "go" });
        // Sitting on an operator is not sitting on a name: nothing to complete.
        expect(at("/set gold gold +| 1")).toMatchObject({ kind: "expression", query: "" });
    });
});

describe("defaultHighlights", () => {
    /** The candidate list the slot would be showing, which the rule reads along with the cursor. */
    const items = (...values: ({ free?: true })[]) => values;
    const real = () => ({});
    const freeEcho = () => ({ free: true as const });

    it("highlights a partly-typed value that has to resolve to something in the list", () => {
        expect(defaultHighlights(at("/b|"))).toBe(true);
        expect(defaultHighlights(at("/bg fo|"), items(real(), real()))).toBe(true);
        expect(defaultHighlights(at("/bg forest_day t=fa|"), items(real()))).toBe(true);
        expect(defaultHighlights(at("#Ali|"))).toBe(true);
    });

    it("does not highlight the optional next step, so Enter there submits the line", () => {
        // The whole point: with `t=` highlighted, `/bg forest_day` + Enter would grab `t=` and the line
        // could never be committed without an extra Escape.
        expect(defaultHighlights(at("/bg forest_day |"))).toBe(false);
    });

    it("does not highlight a slot the author has not typed into, so an optional param can be skipped", () => {
        // Reported from real use: `/var gold ` offers true/false, and with one highlighted there was no
        // key left meaning "I am done" - Enter declared a boolean nobody asked for.
        expect(defaultHighlights(at("/var gold |"), items(real(), real()))).toBe(false);
        expect(defaultHighlights(at("/bg |"), items(real()))).toBe(false);
    });

    it("does not highlight when the slot found nothing to offer", () => {
        // `/var gold 1` - `1` matches neither true nor false, and it is a perfectly good default.
        expect(defaultHighlights(at("/var gold 1|"), [])).toBe(false);
    });

    it("does not highlight when the best offer is the author's own text echoed back", () => {
        // Taking a free echo and submitting the line build the same block, so Enter should submit.
        expect(defaultHighlights(at("/say Zoe|"), items(freeEcho()))).toBe(false);
        // ...but a real match still wins: `/say Ali` puts Alice first, so Enter picks Alice.
        expect(defaultHighlights(at("/say Ali|"), items(real(), freeEcho()))).toBe(true);
    });
});

describe("getCommandCandidates", () => {
    it("lists commands by token, alias and id", () => {
        expect(values("/b|")).toContain("bg");
        expect(values("/backg|")).toContain("bg");
        expect(values("/characterEn|")).toContain("show");
    });

    it("offers assets for the image slot, prefix matches first", () => {
        expect(values("/bg |")).toEqual(["forest_day", "forest_night", "city rain"]);
        expect(values("/bg fo|")).toEqual(["forest_day", "forest_night"]);
        expect(values("/bg rain|")).toEqual(["city rain"]);
    });

    it("offers transitions by the alias an author would type", () => {
        expect(values("/bg forest_day t=|")).toContain("fade");
        expect(values("/bg forest_day t=fa|")).toEqual(["fade"]);
    });

    it("offers the remaining param names", () => {
        expect(values("/bg forest_day |")).toEqual(["t", "d"]);
        expect(values("/bg forest_day t=fade |")).toEqual(["d"]);
    });

    it("offers a speaker's forms only once the speaker resolves", () => {
        expect(values("/show Alice form=|")).toEqual([]);
        expect(values("/show Alice form=|", { character: { kind: "character", characterId: "c1" } })).toEqual(["smile", "angry"]);
    });

    it("offers the speaker picker's order: characters, then names used in the story, then the typed name", () => {
        // Matches `getSpeakerCandidates`. The typed name is offered even alongside a partial match -
        // that is what makes the list never empty, so Tab and Enter never need a "nothing matched" rule.
        expect(values("#Ali|")).toEqual(["Alice", "Ali"]);
        expect(values("#Zo|")).toEqual(["Zoe", "Zo"]);
        expect(values("#Zoe|")).toEqual(["Zoe"]);
        expect(values("#Qq|")).toEqual(["Qq"]);
        expect(values("/say Zo|")).toEqual(["Zoe", "Zo"]);
    });

    it("does not offer a bare name where a portrait is required", () => {
        // `/show Zoe` has no image to show - unlike a speaker, it must resolve.
        expect(values("/show Zo|")).toEqual([]);
        expect(values("/show Al|")).toEqual(["Alice"]);
    });

    it("leads a show/hide/set with the objects on stage, each kind its own list", () => {
        // The headline of this pass: `/imgshow` is a pick from what exists, like `/bg`'s asset picker -
        // not a remembered string. A text name is never offered to an image slot.
        expect(values("/imgshow |")).toEqual(["hero", "portrait"]);
        // The typed fragment is offered back alongside the match, exactly as the speaker picker does -
        // that is the never-empty invariant, applied to object references.
        expect(values("/imgshow he|")).toEqual(["hero", "he"]);
        expect(values("/settext |")).toEqual(["title"]);
        expect(values("/vidshow |")).toEqual(["intro"]);
        expect(values("/stop |")).toEqual(["sound", "music"]);
    });

    it("offers a typed object name back, so an unknown reference is still a valid pick", () => {
        // As with speakers: the object may be created dynamically or in another scene, so the list is
        // never empty and Tab/Enter never need a "nothing matched" rule.
        expect(values("/imgshow new|")).toEqual(["new"]);
        expect(values("/stop other|")).toEqual(["other"]);
    });

    it("offers Alice's forms as the positional after her name once she resolves", () => {
        // `form` is positional now (`/expr Alice angry`), so it depends on the resolved character just
        // as `form=` did - an empty list until the speaker is known.
        expect(values("/expr Alice |")).toEqual([]);
        expect(values("/expr Alice |", { character: { kind: "character", characterId: "c1" } })).toEqual(["smile", "angry"]);
    });

    it("offers the variables in scope inside an expression, leading with true/false for a boolean target", () => {
        const variable = (valueType: "number" | "boolean") => ({
            variable: { kind: "variable" as const, ref: { scope: "scene" as const, variableId: "v1" }, valueType, name: "gold" },
        });
        // Every slot in the command line should be a pick rather than a memory test, and an
        // expression's operands are names - so the variable list is always on offer.
        expect(values("/set gold |")).toEqual(["gold"]);
        expect(values("/set gold |", variable("number"))).toEqual(["gold"]);
        // A boolean target leads with its constants: setting a flag to true is the common case, and
        // it must not sit below a list of variable names. This is the behaviour the old dependent
        // literal slot had, kept intact.
        expect(values("/set gold |", variable("boolean"))).toEqual(["true", "false", "gold"]);
    });

    it("offers the function whitelist once the author starts typing one", () => {
        // Only once something is typed - an unprompted list of ten function names would bury the
        // variables, which are what an author reaches for far more often.
        // The inserted text carries the open paren so the caret lands ready for arguments; the label
        // the author reads is the bare name.
        expect(values("/set gold mi|")).toEqual(["min("]);
        expect(values("/set gold cl|")).toEqual(["clamp("]);
    });

    it("offers nothing inside a greedy body", () => {
        expect(values("/say Alice hello |")).toEqual([]);
    });
});

describe("hasCandidateSource", () => {
    /** `/<token>`'s param by name. */
    function param(token: string, name: string) {
        const def = getCommandDef(token);
        const found = def?.params.find(entry => entry.name === name);
        if (!found) {
            throw new Error(`no param ${name} on /${token}`);
        }
        return found;
    }

    it("separates a name that found nothing from a value with nothing to find", () => {
        // Drives whether an empty list is worth an empty state: "no matches" is useful for an asset
        // name, and nonsense for a half-typed duration.
        expect(hasCandidateSource(param("bg", "image"))).toBe(true);
        expect(hasCandidateSource(param("bg", "t"))).toBe(true);
        expect(hasCandidateSource(param("bg", "d"))).toBe(false);
        expect(hasCandidateSource(param("say", "text"))).toBe(false);
        // An expression always has the variable list behind it, so an empty result really does mean
        // "nothing matched what you typed" - unlike a half-typed duration.
        expect(hasCandidateSource(param("set", "value"))).toBe(true);
        // A stage-object reference has a source (the objects on stage); a create's invented name does not.
        expect(hasCandidateSource(param("imgshow", "name"))).toBe(true);
        expect(hasCandidateSource(param("image", "name"))).toBe(false);
    });

    it("counts a union enumerable when any branch is", () => {
        // `/wait` is `click` or a number: `click` is worth offering.
        expect(hasCandidateSource(param("wait", "seconds"))).toBe(true);
    });
});

describe("completionFor", () => {
    it("completes a command name and moves on to its arguments", () => {
        expect(completionFor(at("/b|"), "bg")).toEqual({ text: "bg ", replace: { start: 1, end: 2 } });
    });

    it("completes a param name to `key=` with no space, so its values open at once", () => {
        // The two-stage Tab: name, then value.
        expect(completionFor(at("/bg forest_day |"), "t")?.text).toBe("t=");
    });

    it("quotes a value with spaces, or the tokenizer would split it back apart", () => {
        expect(completionFor(at("/bg |"), "city rain")?.text).toBe("\"city rain\" ");
        expect(completionFor(at("/bg |"), "forest_day")?.text).toBe("forest_day ");
    });

    it("replaces the whole token being typed, not just what follows the caret", () => {
        expect(completionFor(at("/bg fo|"), "forest_day")).toEqual({ text: "forest_day ", replace: { start: 4, end: 6 } });
    });

    it("has nothing to complete in prose", () => {
        expect(completionFor(at("/say Alice hi |"), "x")).toBeNull();
    });
});
