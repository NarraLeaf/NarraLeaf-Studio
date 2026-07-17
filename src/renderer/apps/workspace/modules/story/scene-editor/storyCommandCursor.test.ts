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
        expect(at("/set gold 10|0")).toMatchObject({ kind: "positional", query: "10" });
    });
});

describe("defaultHighlights", () => {
    it("highlights must-pick positions", () => {
        expect(defaultHighlights(at("/b|"))).toBe(true);
        expect(defaultHighlights(at("/bg |"))).toBe(true);
        expect(defaultHighlights(at("/bg forest_day t=|"))).toBe(true);
        expect(defaultHighlights(at("#Ali|"))).toBe(true);
    });

    it("does not highlight the optional next step, so Enter there submits the line", () => {
        // The whole point: with `t=` highlighted, `/bg forest_day` + Enter would grab `t=` and the line
        // could never be committed without an extra Escape.
        expect(defaultHighlights(at("/bg forest_day |"))).toBe(false);
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
        // Matches `getSpeakerCandidates`. The typed name is offered even alongside a partial match —
        // that is what makes the list never empty, so Tab and Enter never need a "nothing matched" rule.
        expect(values("#Ali|")).toEqual(["Alice", "Ali"]);
        expect(values("#Zo|")).toEqual(["Zoe", "Zo"]);
        expect(values("#Zoe|")).toEqual(["Zoe"]);
        expect(values("#Qq|")).toEqual(["Qq"]);
        expect(values("/say Zo|")).toEqual(["Zoe", "Zo"]);
    });

    it("does not offer a bare name where a portrait is required", () => {
        // `/show Zoe` has no image to show — unlike a speaker, it must resolve.
        expect(values("/show Zo|")).toEqual([]);
        expect(values("/show Al|")).toEqual(["Alice"]);
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
        expect(hasCandidateSource(param("set", "value"))).toBe(false);
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
