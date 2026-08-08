import { describe, expect, it } from "vitest";
import { getCommandCandidates, hasCandidateSource } from "./storyCommandCandidates";
import { getCommandDef } from "./commands/registry";
import { completionFor, defaultHighlights, getCommandCursor, type StoryCommandCursor } from "./storyCommandCursor";
import { argMenuOffer } from "./StorySceneEditorRows";
import type { StoryCommandContext } from "./storyCommandResolution";

const CONTEXT: StoryCommandContext = {
    images: [{ id: "i1", name: "forest_day" }, { id: "i2", name: "forest_night" }, { id: "i3", name: "city rain" }],
    audio: [{ id: "a1", name: "theme" }],
    videos: [],
    // Doll is drawn by a runtime the author supplied and her model has answered; Ghost is a puppet too
    // but nobody could ask hers (no runtime on this machine) - the pair is what the puppet arms need.
    characters: [{ id: "c1", name: "Alice" }, { id: "c2", name: "Bob" }, { id: "c3", name: "Doll" }, { id: "c4", name: "Ghost" }],
    tempSpeakers: ["Zoe"],
    scenes: [{ id: "s1", name: "Chapter 2" }],
    choiceOptions: [{ id: "o1", name: "Refuse her" }, { id: "o2", name: "Say yes" }],
    valueBlueprints: [{ id: "bp1", name: "Bonus" }, { id: "bp2", name: "Story Value" }],
    audioTracks: [{ id: "bgm", name: "Music" }, { id: "sound", name: "SFX" }, { id: "t_amb", name: "Ambience" }],
    labels: ["intro", "retry"],
    variables: [{ name: "gold", ref: { scope: "scene", variableId: "v1" }, valueType: "number" }],
    appearanceByCharacterId: { c1: [{ id: "t1", name: "smile" }, { id: "t2", name: "angry" }] },
    puppetCharacterIds: ["c3", "c4"],
    puppetByCharacterId: {
        c3: {
            motions: ["idle", "run", "sit idle"],
            expressions: ["smile"],
            skins: [],
            params: [{ id: "ParamAngleX", min: -30, max: 30, default: 0 }],
        },
    },
    stageObjects: { image: ["hero", "portrait"], text: ["title"], layer: ["fx"], video: ["intro"], audio: ["sound", "music"], vfx: ["rain"] },
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

    it("widens the caret inside a single-quoted name to the whole quoted region", () => {
        // Word-by-word replacement inside `'Complex Var'` would splice a full name into the middle of
        // the old one; the region - quotes included - is what a completion must replace.
        expect(at("/set gold 'Comp|lex Var' + 1")).toMatchObject({
            kind: "expression",
            query: "Comp",
            replace: { start: 10, end: 23 },
        });
        // Unterminated: the open quote lexically owns the rest of the line, so the region runs to it.
        expect(at("/set gold 'Comp|")).toMatchObject({ kind: "expression", query: "Comp", replace: { start: 10, end: 15 } });
        // An apostrophe inside a double-quoted string is data, not an opening quote.
        expect(at("/set gold \"don't\" + go|")).toMatchObject({ kind: "expression", query: "go" });
    });

    it("knows when the caret is inside a visited / picked argument", () => {
        // The one piece of enclosing syntax the cursor tracks, because inside those two calls the
        // vocabulary is entirely different - an entity name, never a variable or a function.
        expect(at("/set flag visited(Chap|)")).toMatchObject({ kind: "expression", query: "Chap", call: "visited" });
        expect(at("/set flag picked( Ref|")).toMatchObject({ kind: "expression", query: "Ref", call: "picked" });
        // Quoted argument: the region rule still applies, and the enclosing call is still known.
        expect(at("/set flag visited('Chap|ter 2')")).toMatchObject({ kind: "expression", query: "Chap", call: "visited" });
        // A real function call is not one of the two, and a bare fragment has no enclosing call.
        const enclosing = (marked: string) => (at(marked) as { call?: string }).call;
        expect(enclosing("/set gold min(go|)")).toBeUndefined();
        expect(enclosing("/set gold go|")).toBeUndefined();
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
        // Reported from real use: `/local gold ` offers true/false, and with one highlighted there was
        // no key left meaning "I am done" - Enter declared a boolean nobody asked for.
        expect(defaultHighlights(at("/local gold |"), items(real(), real()))).toBe(false);
        expect(defaultHighlights(at("/bg |"), items(real()))).toBe(false);
    });

    it("does not highlight when the slot found nothing to offer", () => {
        // `/local gold 1` - `1` matches neither true nor false, and it is a perfectly good default.
        expect(defaultHighlights(at("/local gold 1|"), [])).toBe(false);
    });

    it("does not highlight when the typed text already IS the top candidate", () => {
        // `/local met true` - taking `true` changes nothing, so Enter must submit, not complete.
        expect(defaultHighlights(at("/local met true|"), [{ value: "true" }, { value: "false" }] as never)).toBe(false);
        // A prefix still highlights: `/local met tr` completing to `true` is a real completion.
        expect(defaultHighlights(at("/local met tr|"), [{ value: "true" }] as never)).toBe(true);
    });

    it("does not highlight when the best offer is the author's own text echoed back", () => {
        // Taking a free echo and submitting the line build the same block, so Enter should submit.
        expect(defaultHighlights(at("/say Zoe|"), items(freeEcho()))).toBe(false);
        // ...but a real match still wins: `/say Ali` puts Alice first, so Enter picks Alice.
        expect(defaultHighlights(at("/say Ali|"), items(real(), freeEcho()))).toBe(true);
    });

    it("never highlights inside an expression, whatever it is offering", () => {
        // A ruling, not a gap in the rule: in an expression the author is writing rather than picking,
        // so Enter has to keep meaning "commit this line". Asserted with a full, real-looking list
        // precisely because every other reason this function returns false (nothing typed, nothing
        // offered, the top offer is an echo) is absent here - the arm itself is the reason.
        expect(defaultHighlights(at("/set gold go|"), items(real(), real()))).toBe(false);
        expect(defaultHighlights(at("/set flag visited(Chap|)"), items(real()))).toBe(false);
    });
});

describe("argMenuOffer", () => {
    const offer = (marked: string, resolved = {}) => argMenuOffer(at(marked), CONTEXT, resolved);

    // The defect this exists to pin: `getCommandCursor` answers `expression` for every `/set`, `/if`
    // and `/until` right-hand side, and the render gate used to admit `positional` / `paramValue` /
    // `paramName` only - so the candidates the model had ready never reached a menu, in any expression
    // slot, ever. The model was right and had no way out.
    it("opens with candidates in an expression slot", () => {
        const inCall = offer("/set flag visited(Chap|)");
        expect(inCall.open).toBe(true);
        expect(inCall.candidates.map(candidate => candidate.value)).toEqual(["Chapter 2"]);

        const bare = offer("/set gold go|");
        expect(bare.open).toBe(true);
        expect(bare.candidates.map(candidate => candidate.value)).toContain("gold");
    });

    it("still opens the positional slot it always opened", () => {
        // The control from the bug report: `/set g` worked all along, because that caret is
        // `positional`. If this ever goes red the fix has traded one arm for another.
        const positional = offer("/set g|");
        expect(positional.open).toBe(true);
        expect(positional.candidates.map(candidate => candidate.value)).toContain("gold");
    });

    it("leaves an expression slot with NOTHING highlighted, so Enter still commits the line", () => {
        // The core of the ruling, kept here as well as on `defaultHighlights` because this is the
        // value the component actually feeds the menu. Flip it to true and `/set gold gold + 1` +
        // Enter stops submitting and inserts whatever the menu happened to be showing instead.
        expect(offer("/set gold go|").autoHighlight).toBe(false);
        expect(offer("/set flag visited(Chap|)").autoHighlight).toBe(false);
        // ...and the positional beside it does highlight, so the two above are not both false for some
        // unrelated reason (an empty list, say) that would hide a regression.
        expect(offer("/set g|").autoHighlight).toBe(true);
    });

    it("stays shut where there is nothing to offer", () => {
        expect(offer("/say Alice hello |").open).toBe(false);
        expect(offer("he said |so").open).toBe(false);
    });
});

describe("getCommandCandidates", () => {
    it("lists commands by token and alias", () => {
        expect(values("/b|")).toContain("bg");
        expect(values("/backg|")).toContain("bg");
        expect(values("/ente|")).toContain("show");
    });

    it("offers assets for the image slot, prefix matches first", () => {
        expect(values("/bg |")).toEqual(["forest_day", "forest_night", "city rain"]);
        expect(values("/bg fo|")).toEqual(["forest_day", "forest_night"]);
        expect(values("/bg rain|")).toEqual(["city rain"]);
    });

    it("offers transitions by the alias an author would type", () => {
        expect(values("/bg forest_day t=|")).toContain("fade");
        // "fa" prefixes both `fade` and the 0.16.0 `fan` transition; a longer prefix narrows to one.
        expect(values("/bg forest_day t=fa|")).toEqual(["fade", "fan"]);
        expect(values("/bg forest_day t=fad|")).toEqual(["fade"]);
    });

    it("offers the remaining param names", () => {
        expect(values("/bg forest_day |")).toEqual(["t", "d"]);
        expect(values("/bg forest_day t=fade |")).toEqual(["d"]);
    });

    it("offers a speaker's forms only once the speaker resolves", () => {
        expect(values("/show Alice form=|")).toEqual([]);
        const resolvedTarget = { target: { kind: "target" as const, target: { type: "character" as const, characterId: "c1", name: "Alice" } } };
        expect(values("/show Alice form=|", resolvedTarget)).toEqual(["smile", "angry"]);
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

    it("does not offer a bare name where the target must resolve", () => {
        // `/show Zoe` has nothing on stage to dispatch on - unlike a speaker, it must resolve.
        expect(values("/show Zo|")).toEqual([]);
        expect(values("/show Al|")).toEqual(["Alice"]);
    });

    it("offers a generic verb everything it accepts: characters first, then each object kind", () => {
        // The headline of the generic verbs (bible B3): `/show` is one pick from everything on stage.
        // Puppet characters are in the list like any other: `/show` puts a model on stage the same way
        // it puts a sprite there, and the box is the engine's regardless of who draws its inside.
        expect(values("/show |")).toEqual(["Alice", "Bob", "Doll", "Ghost", "hero", "portrait", "title", "intro", "fx", "rain"]);
        expect(values("/show he|")).toEqual(["hero"]);
        expect(values("/swap |")).toEqual(["hero", "portrait", "title"]);
        // The sound controls lead with the reserved BGM channel - the explicit spelling of the default -
        // and reach video too, since `/stop` `/pause` `/resume` are the transport verbs for both.
        expect(values("/stop |")).toEqual(["bgm", "sound", "music", "intro"]);
    });

    it("says which world a name lives in when the slot spans several", () => {
        // `/pause intro` pausing a clip rather than the music is only right if "intro" was visibly a
        // video. Read off `accepts`, so a single-kind slot stays label-free. The KIND is carried, not a
        // display string - the menu translates it, so a zh author never sees a bare "audio".
        const details = (marked: string) => getCommandCandidates(at(marked), CONTEXT, {}).map(c => `${c.value}:${c.detailKind ?? ""}`);
        expect(details("/stop |")).toEqual(["bgm:audio", "sound:audio", "music:audio", "intro:video"]);
        expect(details("/play |")).toEqual(["intro:"]);
    });

    it("offers a typed name back where the kind is knowable without the stage", () => {
        // `/play new` can only mean a video; `/stop other` spans two kinds but declares audio as the
        // fallback, so a sound made elsewhere stays addressable. `/show new` declares neither, and has
        // nothing to dispatch the block type on, so nothing is offered.
        expect(values("/play new|")).toEqual(["new"]);
        expect(values("/stop other|")).toEqual(["other"]);
        expect(values("/show new|")).toEqual([]);
    });

    it("offers Alice's forms as the positional after her name once she resolves", () => {
        // `form` is positional now (`/expr Alice angry`), so it depends on the resolved character just
        // as `form=` did - an empty list until the speaker is known.
        expect(values("/face Alice |")).toEqual([]);
        expect(values("/face Alice |", { character: { kind: "character", characterId: "c1" } })).toEqual(["smile", "angry"]);
    });

    it("offers the variables in scope inside an expression, leading with true/false for a boolean target", () => {
        const variable = (valueType: "number" | "boolean") => ({
            variable: { kind: "variable" as const, ref: { scope: "scene" as const, variableId: "v1" }, valueType, name: "gold" },
        });
        // Every slot in the command line should be a pick rather than a memory test, and an
        // expression's operands are names - so the variable list is always on offer, and with it the
        // two other things a bare identifier position accepts: a value blueprint (a name the project
        // declares, offered like a variable) and the two record reads (syntax nobody can guess at).
        // The whitelist stays hidden until something is typed - see the next test for why.
        expect(values("/set gold |")).toEqual(["gold", "Bonus()", "'Story Value'()", "visited(", "picked("]);
        expect(values("/set gold |", variable("number"))).toEqual(["gold", "Bonus()", "'Story Value'()", "visited(", "picked("]);
        // A boolean target leads with its constants: setting a flag to true is the common case, and
        // it must not sit below a list of variable names. This is the behaviour the old dependent
        // literal slot had, kept intact.
        expect(values("/set gold |", variable("boolean"))[0]).toBe("true");
        expect(values("/set gold |", variable("boolean"))[1]).toBe("false");
    });

    it("swaps the whole vocabulary inside visited( / picked(", () => {
        // Not "adds scenes to the list": a variable name cannot go there at all, so offering one
        // would be offering a line that then refuses to resolve.
        expect(values("/set flag visited(|)")).toEqual(["Chapter 2"]);
        expect(values("/set flag picked(|)")).toEqual(["Refuse her", "Say yes"]);
        expect(values("/set flag picked(Say|)")).toEqual(["Say yes"]);
    });

    it("completes a blueprint call whole, quoting the name only where the lexer needs it", () => {
        // `'Story Value'()` must be taken verbatim; the expression slot's usual "quote a value with a
        // space" rule would wrap it a second time and produce `''Story Value'()'`.
        expect(completionFor(at("/set gold Sto|"), "'Story Value'()")).toEqual({
            text: "'Story Value'()",
            replace: { start: 10, end: 13 },
        });
        // A scene name with spaces, inside `visited(`, still goes through the quoting rule.
        expect(completionFor(at("/set flag visited(Chap|)"), "Chapter 2")).toEqual({
            text: "'Chapter 2'",
            replace: { start: 18, end: 22 },
        });
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

    /**
     * The names a puppet character's model reported. Before this the arm was a hard `return []` and the
     * author typed a motion name from memory - which is the one thing about these rows that made them
     * unlike every other action in the editor.
     */
    describe("a puppet's own vocabulary", () => {
        const doll = { character: { kind: "character" as const, characterId: "c3" } };
        const ghost = { character: { kind: "character" as const, characterId: "c4" } };

        it("offers the channel the command asked for, and only that channel", () => {
            expect(values("/motion Doll |", doll)).toEqual(["idle", "run", "sit idle"]);
            expect(values("/face Doll |", doll)).toEqual(["smile"]);
            // The model reported no skins at all. Not a failure and not free text either - there is
            // simply nothing on that channel to offer.
            expect(values("/skin Doll |", doll)).toEqual([]);
        });

        it("puts prefix matches first, the way every other name list does", () => {
            expect(values("/motion Doll i|", doll)).toEqual(["idle", "sit idle"]);
            expect(values("/motion Doll ru|", doll)).toEqual(["run"]);
        });

        it("offers nothing the model did not name - a typo is not dressed up as a choice", () => {
            // The row still commits (an empty menu leaves Enter meaning submit); it is the row's
            // `unknownPuppetName` mark that says the name is wrong, not the completion menu.
            expect(values("/motion Doll runn|", doll)).toEqual([]);
        });

        it("says nothing at all for a model nobody could ask", () => {
            // Ghost is a puppet, but her runtime is not installed here. Every name is plausible, so
            // offering none of them is the honest answer - and `hasCandidateSource` keeps the menu shut
            // rather than telling the author their name "does not match".
            expect(values("/motion Ghost |", ghost)).toEqual([]);
            expect(values("/motion Ghost id|", ghost)).toEqual([]);
        });

        it("offers nothing until the line has named a character", () => {
            // The caret is on the name slot, but nothing has resolved into the owner slot - offering
            // every motion of every puppet in the project would be worse than offering none.
            expect(values("/motion Nobody |")).toEqual([]);
        });
    });
});

/**
 * What each candidate says it IS — the menu draws a picture from it where one exists and a glyph
 * otherwise, so a wrong mark is a wrong picture.
 *
 * Pinned here rather than in the view because the fact being asserted is the model's: the arm that
 * produced a candidate is the only thing that knows what it is, and the last version read the mark off
 * the param instead — which gave every row of a mixed `/show` list the same glyph.
 */
describe("candidate marks", () => {
    const marks = (marked: string, resolved = {}) =>
        getCommandCandidates(at(marked), CONTEXT, resolved).map(candidate => candidate.mark);

    it("carries the id an asset can be pictured by", () => {
        expect(marks("/bg fo|")).toEqual([
            { kind: "asset", assetType: "image", assetId: "i1" },
            { kind: "asset", assetType: "image", assetId: "i2" },
        ]);
        expect(marks("/bgm |")).toEqual([{ kind: "asset", assetType: "audio", assetId: "a1" }]);
    });

    it("marks each row of a mixed list by what that row is", () => {
        // `/show` reaches characters and every stage kind at once, which is exactly the list a
        // param-level reading got wrong: four faces followed by six object glyphs, not ten of either.
        expect(marks("/show |")).toEqual([
            { kind: "character", characterId: "c1" },
            { kind: "character", characterId: "c2" },
            { kind: "character", characterId: "c3" },
            { kind: "character", characterId: "c4" },
            { kind: "stageObject", objectKind: "image" },
            { kind: "stageObject", objectKind: "image" },
            { kind: "stageObject", objectKind: "text" },
            { kind: "stageObject", objectKind: "video" },
            { kind: "stageObject", objectKind: "layer" },
            { kind: "stageObject", objectKind: "vfx" },
        ]);
    });

    it("carries both ids a look needs: whose it is, and which look", () => {
        // A preset character's ref is a pose (no axis); a layered one's is a tag on `axisId`, and the
        // menu composites the stack from it. Either way the picture is of THIS look, not of the default.
        expect(marks("/face Alice |", { character: { kind: "character", characterId: "c1" } })).toEqual([
            { kind: "appearance", characterId: "c1", refId: "t1", axisId: undefined },
            { kind: "appearance", characterId: "c1", refId: "t2", axisId: undefined },
        ]);
    });

    it("names a free name as one, so it is never pictured as somebody", () => {
        // A temp speaker backs no character record - there is nothing to draw, and drawing the last
        // character's face beside it would be a lie about what Enter is going to insert.
        expect(marks("#Qq|")).toEqual([{ kind: "freeName" }]);
    });

    it("keys a word on the canonical value, whatever the row is showing", () => {
        // The glyph table is keyed on the grammar's own spelling, so 向左滑动 and `slide-left` draw the
        // same arrow - the locale changes the word, never what the word means.
        expect(marks("/bg forest_day t=fad|")).toEqual([{ kind: "word", value: "fade" }]);
        expect(marks("/wait cl|")).toEqual([{ kind: "word", value: "click" }]);
    });

    it("gives a param NAME the mark of what its slot holds", () => {
        // `t` `d` is two letters to decode; a word list and a stopwatch is a glance. The unit is what
        // separates "how long" from "how many", which is the same thing the ghost hint prints, and the
        // leading option is what stops every word list from wearing one interchangeable glyph.
        expect(marks("/bg forest_day |")).toEqual([{ kind: "options", lead: "fade" }, { kind: "number", duration: true }]);
        expect(marks("/show Alice smile |")).toEqual([
            { kind: "options", lead: "left" },
            { kind: "options", lead: "fade" },
            { kind: "number", duration: true },
        ]);
    });

    it("marks a variable by the type it holds", () => {
        expect(marks("/set |")).toEqual([{ kind: "variable", valueType: "number" }]);
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
        // A target reference has a source (the objects on stage); a create's invented name does not.
        expect(hasCandidateSource(param("play", "target"))).toBe(true);
        expect(hasCandidateSource(param("swap", "content"))).toBe(true);
        expect(hasCandidateSource(param("image", "name"))).toBe(false);
    });

    it("counts a union enumerable when any branch is", () => {
        // `/wait` is `click` or a number: `click` is worth offering.
        expect(hasCandidateSource(param("wait", "seconds"))).toBe(true);
    });

    /**
     * The one param whose answer is not a property of the grammar: whether a model has been asked and
     * answered. Getting this wrong is visible - `true` for an undescribed model shows "no matches" for
     * every name the author types, which reads as "your name is wrong" when the truth is "Studio never
     * loaded your runtime".
     */
    it("asks the model, not the grammar, whether a puppet name has a source", () => {
        const motion = param("motion", "name");
        expect(hasCandidateSource(motion, CONTEXT, { character: { kind: "character", characterId: "c3" } })).toBe(true);
        // Described, but with nothing on this channel: no list, so no empty state either.
        expect(hasCandidateSource(param("skin", "name"), CONTEXT, { character: { kind: "character", characterId: "c3" } })).toBe(false);
        // A puppet nobody could ask, and a line that has not named anyone yet.
        expect(hasCandidateSource(motion, CONTEXT, { character: { kind: "character", characterId: "c4" } })).toBe(false);
        expect(hasCandidateSource(motion, CONTEXT)).toBe(false);
        // No context at all (a caller that has none) must not claim a source.
        expect(hasCandidateSource(motion)).toBe(false);
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
        // Single quotes: what the menu completes is an entity name, and `'…'` is the entity-reference
        // spelling. A name that itself carries an apostrophe falls back to double quotes.
        expect(completionFor(at("/bg |"), "city rain")?.text).toBe("'city rain' ");
        expect(completionFor(at("/bg |"), "forest_day")?.text).toBe("forest_day ");
        expect(completionFor(at("/bg |"), "Bob's Bar")?.text).toBe("\"Bob's Bar\" ");
        expect(completionFor(at("/bg t=|"), "city rain")?.text).toBe("'city rain' ");
    });

    it("single-quotes a completed identifier with spaces inside an expression, with no trailing space", () => {
        expect(completionFor(at("/set gold |"), "Complex Var Name")?.text).toBe("'Complex Var Name'");
        expect(completionFor(at("/set gold |"), "gold")?.text).toBe("gold");
        expect(completionFor(at("/set gold mi|"), "min(")?.text).toBe("min(");
    });

    it("replaces the whole token being typed, not just what follows the caret", () => {
        expect(completionFor(at("/bg fo|"), "forest_day")).toEqual({ text: "forest_day ", replace: { start: 4, end: 6 } });
    });

    it("has nothing to complete in prose", () => {
        expect(completionFor(at("/say Alice hi |"), "x")).toBeNull();
    });
});
