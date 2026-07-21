import { afterEach, describe, expect, it } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { allowsFreeValue } from "./storyCommandGrammar";
import { listCommandDefs } from "./commands/registry";
import { canCommit, getArgValue, missingCoreParams, parseCommandLine, tokenizeCommandLine, unfilledParams } from "./storyCommandParser";

function command(source: string) {
    const line = parseCommandLine(source);
    if (line.kind !== "command") {
        throw new Error(`expected a command line, got ${line.kind}`);
    }
    return line;
}

function codes(source: string): string[] {
    return command(source).issues.map(issue => issue.code);
}

describe("tokenizeCommandLine", () => {
    it("splits on unquoted spaces and keeps absolute spans", () => {
        const { tokens } = tokenizeCommandLine("/bg forest t=fade", 1);
        expect(tokens.map(token => token.text)).toEqual(["bg", "forest", "t=fade"]);
        expect(tokens[1].span).toEqual({ start: 4, end: 10 });
    });

    it("groups quoted values and reports the raw text with quotes intact", () => {
        const { tokens, unterminatedQuote } = tokenizeCommandLine("/bg \"city rain\"", 1);
        expect(tokens[1]).toMatchObject({ text: "city rain", raw: "\"city rain\"", quoted: true, quote: "double" });
        expect(unterminatedQuote).toBe(false);
    });

    it("groups single-quoted entity references exactly like double quotes, recording the kind", () => {
        const { tokens, unterminatedQuote } = tokenizeCommandLine("/set 'Complex Var Name' 5", 1);
        expect(tokens.map(token => token.text)).toEqual(["set", "Complex Var Name", "5"]);
        expect(tokens[1]).toMatchObject({ text: "Complex Var Name", raw: "'Complex Var Name'", quoted: true, quote: "single" });
        expect(tokens[2].quote).toBeUndefined();
        expect(tokens[2].quoted).toBe(false);
        expect(unterminatedQuote).toBe(false);
    });

    it("treats the other quote kind as data inside a quoted token", () => {
        // An apostrophe inside a string, and quote marks inside an entity name, are just characters.
        expect(tokenizeCommandLine("/bg \"Bob's Bar\"", 1).tokens[1]).toMatchObject({ text: "Bob's Bar", quote: "double" });
        expect(tokenizeCommandLine("/bg 'say \"hi\"'", 1).tokens[1]).toMatchObject({ text: "say \"hi\"", quote: "single" });
    });

    it("flags an unterminated quote of either kind", () => {
        expect(tokenizeCommandLine("/bg \"city", 1).unterminatedQuote).toBe(true);
        expect(codes("/bg \"city")).toContain("unterminatedQuote");
        expect(tokenizeCommandLine("/jump 'Chapter", 1).unterminatedQuote).toBe(true);
        expect(codes("/jump 'Chapter")).toContain("unterminatedQuote");
    });

    it("collapses runs of spaces", () => {
        expect(tokenizeCommandLine("/bg   forest", 1).tokens.map(t => t.text)).toEqual(["bg", "forest"]);
    });
});

describe("parseCommandLine - classification", () => {
    it("classifies empty, narration, character and command lines", () => {
        expect(parseCommandLine("")).toEqual({ kind: "empty" });
        expect(parseCommandLine("他/她走了")).toMatchObject({ kind: "narration", text: "他/她走了" });
        expect(parseCommandLine("/bg")).toMatchObject({ kind: "command", token: "bg" });
        expect(parseCommandLine("#alice 你好")).toMatchObject({ kind: "character", query: "alice", text: "你好" });
    });

    it("treats a bare slash as a command with no token yet", () => {
        expect(parseCommandLine("/")).toMatchObject({ kind: "command", token: null, def: null, issues: [] });
    });

    it("reads a character line with no line of dialogue yet", () => {
        expect(parseCommandLine("#ali")).toMatchObject({ kind: "character", query: "ali", text: "" });
    });
});

describe("parseCommandLine - command resolution", () => {
    it("resolves the canonical token and its aliases to the same command", () => {
        expect(command("/bg").def?.commandId).toBe("background");
        expect(command("/background").def?.commandId).toBe("background");
        expect(command("/BG").def?.commandId).toBe("background");
    });

    it("resolves every spec token and alias to its owning command", () => {
        // The registry is the whole vocabulary now: every commit runs one path, and the old
        // palette-id spellings (`/characterEnter`) were retired with the seam that accepted them.
        for (const def of listCommandDefs()) {
            expect(command(`/${def.token}`).def?.commandId, `/${def.token}`).toBe(def.commandId);
            for (const alias of def.aliases ?? []) {
                expect(command(`/${alias}`).def?.commandId, `/${alias}`).toBe(def.commandId);
            }
        }
    });

    it("keeps the note aliases working", () => {
        expect(command("/note").def?.commandId).toBe("note");
        expect(command("//").def?.commandId).toBe("note");
        expect(command("/note some text here").def?.commandId).toBe("note");
    });

    it("resolves a command by its spec id as well as its token", () => {
        expect(command("/volume").def?.commandId).toBe("volume");
        expect(command("/vol").def?.commandId).toBe("volume");
        expect(command("/show").def?.commandId).toBe("show");
        expect(command("/set").def?.commandId).toBe("set");
    });

    it("lets a paramless container commit through the same path as everything else", () => {
        // No second behaviour hides behind `params.length === 0` any more: `/parallel` has a spec, an
        // empty grammar, and commits exactly as `/bg forest` does.
        expect(command("/parallel").def?.params).toEqual([]);
        expect(canCommit(parseCommandLine("/parallel"))).toBe(true);
    });

    it("reports an unknown command and stops", () => {
        const line = command("/bgg forest");
        expect(line.def).toBeNull();
        expect(line.issues).toEqual([{ code: "unknownCommand", span: { start: 1, end: 4 }, token: "bgg" }]);
    });
});

describe("parseCommandLine - a command named in the active locale", () => {
    // The command TOKEN localizes (its menu label doubles as an inline alias); params and their values
    // stay English. The label the parser accepts is the same `story.command.<id>.label` the slash menu
    // shows, so the two can never disagree about what `/背景` means.
    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("resolves a Chinese command token to its canonical command", () => {
        i18nStore.setLocale("zh");
        expect(command("/背景").def?.commandId).toBe("background");
        expect(command("/跳转").def?.commandId).toBe("jump");
        expect(command("/对话").def?.commandId).toBe("say");
    });

    it("parses a Chinese token's arguments exactly as the English token would - keys stay English", () => {
        i18nStore.setLocale("zh");
        const localized = command("/背景 forest t=fade");
        const english = command("/bg forest t=fade");
        expect(localized.def?.commandId).toBe("background");
        expect(getArgValue(localized, "image")).toBe("forest");
        expect(getArgValue(localized, "t")).toBe("fade");
        // The localized token is a pure front door onto the same grammar: same args, no new issues.
        expect(localized.args.map(arg => [arg.param?.name, arg.value])).toEqual(english.args.map(arg => [arg.param?.name, arg.value]));
        expect(localized.issues).toEqual([]);
    });

    it("still accepts the canonical English token in a non-English locale", () => {
        i18nStore.setLocale("zh");
        expect(command("/bg forest").def?.commandId).toBe("background");
    });

    it("does not accept a foreign-locale token once the locale changes back", () => {
        // `/背景` is only a command while the menu is Chinese; in English it is prose-with-a-slash.
        i18nStore.setLocale("en");
        expect(command("/背景").def).toBeNull();
        expect(codes("/背景")).toContain("unknownCommand");
    });
});

describe("parseCommandLine - lines that must become invalid rows", () => {
    // Ported from `resolveActionCommandToken.test.ts`: the command line took over that seam, so these
    // are now the parser's to get right. A line that resolves to nothing must never become prose.
    it.each([
        ["an unknown command", "/bgg"],
        ["prose that happens to start with a slash", "/this is not a command"],
        ["a bare slash", "/"],
    ])("does not resolve %s", (_label, source) => {
        const line = parseCommandLine(source);
        expect(line.kind).toBe("command");
        expect((line as Extract<typeof line, { kind: "command" }>).def).toBeNull();
        expect(canCommit(line)).toBe(false);
    });

    it("leaves a line with no slash as prose, and an empty line as nothing", () => {
        expect(parseCommandLine("note")).toMatchObject({ kind: "narration" });
        expect(parseCommandLine("")).toEqual({ kind: "empty" });
    });
});

describe("parseCommandLine - args", () => {
    it("fills positional params in declaration order", () => {
        const line = command("/set gold 100");
        expect(line.args.map(arg => [arg.param?.name, arg.value])).toEqual([["variable", "gold"], ["value", "100"]]);
    });

    it("reads named args and their aliases", () => {
        const line = command("/bg forest t=fade duration=500");
        expect(getArgValue(line, "image")).toBe("forest");
        expect(getArgValue(line, "t")).toBe("fade");
        expect(getArgValue(line, "d")).toBe("500");
        expect(line.issues).toEqual([]);
    });

    it("lets a named arg address a positional param", () => {
        expect(getArgValue(command("/bg image=forest"), "image")).toBe("forest");
    });

    it("keeps a quoted value with spaces in one arg", () => {
        expect(getArgValue(command("/bg \"city rain\" t=fade"), "image")).toBe("city rain");
    });

    it("addresses an entity name with spaces through single quotes", () => {
        expect(getArgValue(command("/set 'Complex Var Name' 5"), "variable")).toBe("Complex Var Name");
        expect(getArgValue(command("/set 'Complex Var Name' 5"), "value")).toBe("5");
        expect(getArgValue(command("/jump 'Scene Name'"), "scene")).toBe("Scene Name");
        expect(getArgValue(command("/show 'My Poster'"), "target")).toBe("My Poster");
        expect(codes("/jump 'Scene Name'")).toEqual([]);
    });

    it("keeps a = inside single quotes as data, same as inside double quotes", () => {
        expect(getArgValue(command("/bg image='city rain'"), "image")).toBe("city rain");
        expect(getArgValue(command("/jump 'a=b'"), "scene")).toBe("a=b");
    });

    it("anchors a named arg's spans to the key and the value separately", () => {
        const arg = command("/bg forest t=fade").args[1];
        expect(arg.keySpan).toEqual({ start: 11, end: 12 });
        expect(arg.valueSpan).toEqual({ start: 13, end: 17 });
    });
});

describe("parseCommandLine - greedy text", () => {
    it("takes the rest of the line verbatim, spaces included", () => {
        expect(getArgValue(command("/say alice 你好 世界"), "text")).toBe("你好 世界");
    });

    it("does not read key=value inside dialogue as an arg", () => {
        const line = command("/say alice 3 = 5 d=1");
        expect(getArgValue(line, "text")).toBe("3 = 5 d=1");
        expect(line.issues).toEqual([]);
    });

    it("leaves the greedy param unfilled when only the character is typed", () => {
        expect(getArgValue(command("/say alice"), "text")).toBeUndefined();
    });

    it("does not read an apostrophe in dialogue as an open quote", () => {
        // `'` is quote syntax on the command line now, but greedy prose is taken verbatim - so the
        // unterminated-quote issue must not surface for a contraction inside the line of dialogue.
        const line = command("/say alice don't worry");
        expect(getArgValue(line, "text")).toBe("don't worry");
        expect(line.issues).toEqual([]);
        expect(canCommit(line)).toBe(true);
    });
});

describe("parseCommandLine - grammar-level validation", () => {
    it("rejects a value no branch of the union accepts", () => {
        expect(codes("/wait abc")).toEqual(["badValue"]);
        expect(codes("/bgm track fade=soon")).toEqual(["badValue"]);
        expect(codes("/sound se loop=maybe")).toEqual(["badValue"]);
        expect(codes("/bg forest t=zoom")).toEqual(["badValue"]);
    });

    it("accepts every branch of a union", () => {
        expect(codes("/wait click")).toEqual([]);
        expect(codes("/wait 500")).toEqual([]);
        expect(codes("/bg #1a1a1a")).toEqual([]);
    });

    it("stays silent on a value whose only checkable branch fails but whose context-dependent branch might not", () => {
        // `forest_day` is not a color, but the asset branch is unresolvable here - flagging it would
        // be the parser overstepping into the resolution layer's job.
        expect(codes("/bg forest_day")).toEqual([]);
    });

    it("accepts an enum alias without rewriting it - normalization is the resolver's job", () => {
        expect(codes("/bg forest t=fade")).toEqual([]);
        expect(getArgValue(command("/bg forest t=fade"), "t")).toBe("fade");
    });

    it("enforces a number's bounds", () => {
        expect(codes("/sound se vol=0.5")).toEqual([]);
        expect(codes("/sound se vol=2")).toEqual(["badValue"]);
        expect(codes("/bg forest d=-1")).toEqual(["badValue"]);
    });

    it("reports unknown, duplicate and surplus args", () => {
        expect(codes("/bg forest x=1")).toEqual(["unknownParam"]);
        expect(codes("/bg forest t=fade t=dissolve")).toEqual(["duplicateParam"]);
        expect(codes("/wait 500 extra")).toEqual(["extraPositional"]);
    });

    it("says nothing about a name it cannot resolve", () => {
        expect(codes("/bg nonexistent")).toEqual([]);
        expect(codes("/set gold 100")).toEqual([]);
    });

    it("never faults an unknown speaker - a bare name is a temp speaker, not an error", () => {
        // From the interaction model: a dialogue row carries `characterId` XOR `speakerName`, so a name
        // matching no character is a valid line. `#Zoe` and `/say Zoe` must agree on that.
        expect(codes("/say Zoe 你好")).toEqual([]);
        expect(codes("/show Zoe")).toEqual([]);
        expect(canCommit(parseCommandLine("/say Zoe 你好"))).toBe(true);
    });
});

describe("allowsFreeValue", () => {
    it("lets a speaker stand unresolved but not an asset, scene or variable", () => {
        expect(allowsFreeValue({ kind: "character", allowTemp: true })).toBe(true);
        expect(allowsFreeValue({ kind: "text" })).toBe(true);
        expect(allowsFreeValue({ kind: "asset", assetType: "image" })).toBe(false);
        expect(allowsFreeValue({ kind: "scene" })).toBe(false);
        expect(allowsFreeValue({ kind: "variable" })).toBe(false);
    });

    it("is opt-in per param: a speaker may be bare, a portrait may not", () => {
        // `/say Zoe` is a temp speaker; `/show Zoe` has no image to show and must fail to resolve.
        expect(allowsFreeValue({ kind: "character", allowTemp: true })).toBe(true);
        expect(allowsFreeValue({ kind: "character" })).toBe(false);
    });
});

describe("unfilledParams", () => {
    it("lists what has not been given yet", () => {
        expect(unfilledParams(command("/bg forest")).map(param => param.name)).toEqual(["t", "d"]);
        expect(unfilledParams(command("/bg forest t=fade d=1")).map(param => param.name)).toEqual([]);
    });
});

describe("canCommit", () => {
    it("blocks empty lines and lets non-empty narration through", () => {
        expect(canCommit(parseCommandLine(""))).toBe(false);
        expect(canCommit(parseCommandLine("   "))).toBe(false);
        expect(canCommit(parseCommandLine("他走了"))).toBe(true);
    });

    it("blocks a command that has an issue", () => {
        expect(canCommit(parseCommandLine("/bgg"))).toBe(false);
        expect(canCommit(parseCommandLine("/wait abc"))).toBe(false);
    });

    it("allows a command whose non-core params are merely unfilled", () => {
        expect(canCommit(parseCommandLine("/bg forest"))).toBe(true);
        expect(canCommit(parseCommandLine("/wait"))).toBe(true);
        expect(canCommit(parseCommandLine("/say Zoe"))).toBe(true);
    });

    it("blocks a command whose required core is unfilled, and names the missing slot", () => {
        // Bible B9: a committed row is always a complete instruction. `/bg` alone lands as a draft,
        // and the draft's reason line reads the missing core off this list.
        expect(canCommit(parseCommandLine("/bg"))).toBe(false);
        expect(missingCoreParams(parseCommandLine("/bg")).map(param => param.name)).toEqual(["image"]);
        expect(missingCoreParams(parseCommandLine("/bg forest"))).toEqual([]);
    });

    it("reads a bare flag as a named boolean (bible B5)", () => {
        const line = command("/bgm battle loop");
        expect(getArgValue(line, "loop")).toBe("true");
        expect(line.issues).toEqual([]);
        // Before any positional is filled, a flag-shaped word is a value, not a flag.
        expect(getArgValue(command("/bgm loop"), "audio")).toBe("loop");
    });

    it("skips an omissible leading target when the value slot matches instead (bible B4)", () => {
        // `/vol 0.5` is a volume with the default target; `/vol piano 0.5` names the sound.
        expect(getArgValue(command("/vol 0.5"), "volume")).toBe("0.5");
        expect(getArgValue(command("/vol 0.5"), "target")).toBeUndefined();
        expect(getArgValue(command("/vol piano 0.5"), "target")).toBe("piano");
        expect(getArgValue(command("/vol piano 0.5"), "volume")).toBe("0.5");
    });

    it("blocks a slash with no command token", () => {
        expect(canCommit(parseCommandLine("/"))).toBe(false);
    });
});
