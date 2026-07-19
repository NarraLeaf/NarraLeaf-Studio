import { describe, expect, it } from "vitest";
import { ACTION_COMMANDS } from "./storyActionCommands";
import { allowsFreeValue } from "./storyCommandGrammar";
import { canCommit, getArgValue, parseCommandLine, tokenizeCommandLine, unfilledParams } from "./storyCommandParser";

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
        expect(tokens[1]).toMatchObject({ text: "city rain", raw: "\"city rain\"", quoted: true });
        expect(unterminatedQuote).toBe(false);
    });

    it("flags an unterminated quote", () => {
        expect(tokenizeCommandLine("/bg \"city", 1).unterminatedQuote).toBe(true);
        expect(codes("/bg \"city")).toContain("unterminatedQuote");
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

    it("still resolves every token the old seam did - short tokens are additive, not a replacement", () => {
        // `resolveActionCommandToken` matched any ActionCommandId plus the palette aliases. The command
        // line replaced it, so nothing an author already types may stop resolving.
        for (const entry of ACTION_COMMANDS) {
            expect(command(`/${entry.id}`).def?.commandId, `/${entry.id}`).toBe(entry.id);
        }
    });

    it("keeps the note aliases working", () => {
        expect(command("/note").def?.commandId).toBe("note");
        expect(command("//").def?.commandId).toBe("note");
        expect(command("/note some text here").def?.commandId).toBe("note");
    });

    it("resolves a P0 command by its long id as well as its short token", () => {
        expect(command("/characterEnter").def?.commandId).toBe("characterEnter");
        expect(command("/show").def?.commandId).toBe("characterEnter");
        expect(command("/setVariable").def?.commandId).toBe("setVariable");
        expect(command("/set").def?.commandId).toBe("setVariable");
    });

    it("gives the paramless remainder no params, so the caller can route them to the menu path", () => {
        // `displayableShow` needs a resolved displayable target, so it stays out of the grammar and keeps
        // the menu path until that candidate work lands (see the P1 section note in the grammar).
        expect(command("/displayableShow").def?.params).toEqual([]);
        expect(command("/bg").def?.params.length).toBeGreaterThan(0);
    });

    it("reports an unknown command and stops", () => {
        const line = command("/bgg forest");
        expect(line.def).toBeNull();
        expect(line.issues).toEqual([{ code: "unknownCommand", span: { start: 1, end: 4 }, token: "bgg" }]);
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

    it("allows a command whose params are merely unfilled", () => {
        // Committing an unfilled block is what picking the action from the palette does today; the
        // command line must not regress that.
        expect(canCommit(parseCommandLine("/bg"))).toBe(true);
        expect(canCommit(parseCommandLine("/bg forest"))).toBe(true);
    });

    it("blocks a slash with no command token", () => {
        expect(canCommit(parseCommandLine("/"))).toBe(false);
    });
});
