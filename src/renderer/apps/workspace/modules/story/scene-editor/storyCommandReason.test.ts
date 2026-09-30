import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { storyExpr as en } from "@shared/i18n/catalog/en/storyExpr";
import { createTranslator } from "@shared/i18n";
import type { TranslationKey } from "@shared/i18n";
import { getCommandLineReason } from "./storyCommandReason";
import type { StoryCommandContext } from "./storyCommandResolution";
import { EMPTY_STORY_COMMAND_CONTEXT, EMPTY_STORY_COMMAND_STAGE_OBJECTS } from "./storyCommandResolution";

/**
 * Why a line will not commit.
 *
 * The behaviour this replaces: every failure — a name collision, a typo'd command, an unbalanced
 * paren — showed the same "won't build" badge. An author who typed `/local met 1` where `met` was
 * already taken had no way to find that out from the editor, which is exactly how it was reported.
 */
const CONTEXT: StoryCommandContext = {
    ...EMPTY_STORY_COMMAND_CONTEXT,
    images: [{ id: "i1", name: "forest" }, { id: "i2", name: "twin" }, { id: "i3", name: "twin" }],
    characters: [{ id: "c1", name: "Alice" }],
    variables: [
        { name: "gold", ref: { scope: "saved", variableId: "v1" }, valueType: "number" },
        { name: "met", ref: { scope: "scene", variableId: "v2" }, valueType: "boolean" },
    ],
    appearanceByCharacterId: { c1: [{ id: "t1", name: "smile" }] },
    puppetCharacterIds: [],
    // A layer and an ambience overlay on stage: the two kinds a displayable slot resolves in order to
    // refuse, and the pair that made one shared message impossible to keep true.
    stageObjects: { ...EMPTY_STORY_COMMAND_STAGE_OBJECTS, layer: ["overlay"], vfx: ["petals"] },
};

/** The catalog entry a line resolves to, so a test failure names the message rather than a key. */
function reasonFor(source: string): string | null {
    const reason = getCommandLineReason(source, CONTEXT);
    if (!reason) {
        return null;
    }
    const path = reason.key.replace(/^storyExpr\./, "").split(".");
    const text = path.reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
    expect(typeof text, `no catalog entry for ${reason.key}`).toBe("string");
    return text as string;
}

describe("getCommandLineReason", () => {
    it("names a variable already taken, which is what the generic badge could never say", () => {
        // `met` is the SCENE variable in the context, and scene is the only scope a story row still
        // declares — a name taken at project scope (`gold`, saved) is not this collision and is not
        // refused here, which is why the assertion moved off it when `/save` was retired.
        expect(reasonFor("/local met 1")).toBe(en.reason.duplicateVariable);
        expect(reasonFor("/local gold 1")).toBe(null);
    });

    it("stays silent on a line that is fine", () => {
        expect(reasonFor("/local fresh 1")).toBe(null);
        expect(reasonFor("/set gold gold + 1")).toBe(null);
        expect(reasonFor("/bg forest")).toBe(null);
        // An unfilled command still commits, so it is not a problem to report.
        expect(reasonFor("/bg")).toBe(null);
    });

    it("stays silent on prose and on a half-typed command token", () => {
        // Reporting "there is no /v command" on the first keystroke after the slash would put a red
        // line under every command the author ever types.
        expect(reasonFor("just narration")).toBe(null);
        expect(reasonFor("/va")).toBe(null);
        expect(reasonFor("/")).toBe(null);
        // ...but once they have moved past the token, the verdict is real - and `nope` is one edit
        // from `note`, so the verdict names it rather than stopping at "no such command".
        expect(reasonFor("/nope ")).toBe(en.reason.unknownCommandNear);
        expect(reasonFor("/xqjzzy ")).toBe(en.reason.unknownCommand);
    });

    it("distinguishes the ways a name can fail", () => {
        // `/bg`'s image slot takes a set as well as a file, and says so: an author sent to look for
        // an image row that was never going to be there is an author told the wrong thing.
        expect(reasonFor("/bg nothere")).toBe(en.reason.unknownAssetOrSet);
        // The rule image is the slot that does NOT take one - it writes into the transition ref,
        // which assembly never resolves a set for - so its message stays the narrow one.
        expect(reasonFor("/bg forest rule=nothere")).toBe(en.reason.unknownAsset);
        expect(reasonFor("/bg twin")).toBe(en.reason.ambiguousName);
        expect(reasonFor("/show Zoe")).toBe(en.reason.unknownTarget);
        expect(reasonFor("/face Zoe smile")).toBe(en.reason.unknownCharacter);
        expect(reasonFor("/show Alice frown")).toBe(en.reason.unknownForm);
        expect(reasonFor("/set nothere 1")).toBe(en.reason.unknownVariable);
    });

    /**
     * One code, several verbs, and the message has to hold for each of them.
     *
     * `/transform` and `/reset` refuse a video and an ambience overlay; `/front` refuses those and a
     * layer as well. The message they all shared was written for `/transform` alone - so `/front
     * overlay` read "overlay is a layer, which has no transform. Use show, hide, play or rate", and
     * both halves were false: a layer HAS a transform, and none of those four verbs is what puts one
     * layer in front of another. Now the sentence quotes the verb off the line and picks its advice
     * from what the name resolved to.
     */
    it("answers for the verb the author wrote, not the one the message was written for", () => {
        const cases = [
            { source: "/transform petals", key: "storyExpr.reason.unsupportedTarget" },
            { source: "/front petals", key: "storyExpr.reason.unsupportedTarget" },
            { source: "/front overlay", key: "storyExpr.reason.unsupportedTargetLayer" },
        ] as const;
        for (const { source, key } of cases) {
            const reason = getCommandLineReason(source, CONTEXT);
            expect(reason?.key, source).toBe(key as TranslationKey);
            const text = reason ? createTranslator("en").t(reason.key, reason.params) : "";
            // The verb on this line, never another one.
            expect(text, source).toContain(source.split(" ")[0]);
        }

        const layer = getCommandLineReason("/front overlay", CONTEXT);
        const text = layer ? createTranslator("en").t(layer.key, layer.params) : "";
        // Nothing that is only true of `/transform`: not the word, not its four alternatives.
        expect(text).not.toMatch(/transform/i);
        expect(text).not.toMatch(/play or rate/i);
        expect(text).toContain("/layer z=");
    });

    it("reports the expression's own mistake, not a generic wrapper", () => {
        // An unknown name and an unbalanced paren are different problems with different fixes.
        expect(reasonFor("/set gold nothere + 1")).toBe(en.issue.unknownVariable);
        expect(reasonFor("/set gold (1")).toBe(en.issue.unbalancedParen);
        expect(reasonFor("/set gold nosuchfn(1)")).toBe(en.issue.unknownFunction);
        expect(reasonFor("/set gold abs(1, 2)")).toBe(en.issue.badArity);
    });

    it("reports a value the variable cannot hold, and a condition that is not a test", () => {
        expect(reasonFor("/set gold \"rich\"")).toBe(en.reason.expressionTypeMismatch);
        expect(reasonFor("/if gold")).toBe(en.reason.expressionNotBoolean);
    });

    /**
     * The subject of "holds" is the VARIABLE.
     *
     * The message used to fill that role with the expression source and read
     * `This produces string, but "upper("a")" holds number.` - `upper("a")` is the side that produces
     * a string, and `gold` is the side that holds a number, so the sentence contradicted itself. The
     * assertion is written on the rendered text in both locales rather than on the params, because
     * the defect was in the wording and a params-only check would have passed throughout.
     *
     * Reachable only since `inferStoryExpressionType` gained a per-function result table: while every
     * call inferred as `number`, a function result always fitted a number variable and this branch
     * could not be hit.
     */
    it("names the variable, not the expression, as the thing that holds a type", () => {
        const reason = getCommandLineReason("/set gold upper(\"a\")", CONTEXT);

        expect(reason?.key).toBe("storyExpr.reason.expressionTypeMismatch" as TranslationKey);
        if (!reason) {
            return;
        }
        for (const locale of ["en", "zh"] as const) {
            const text = createTranslator(locale).t(reason.key, reason.params);
            expect(text, locale).toContain("gold");
            expect(text, locale).toContain("number");
            expect(text, locale).toContain("string");
            // The expression source must not appear at all: there is no role left for it to fill.
            expect(text, locale).not.toContain("upper");
        }
    });

    it("reports a malformed line", () => {
        expect(reasonFor("/bg forest nosuchparam=1")).toBe(en.reason.unknownParam);
        expect(reasonFor("/bg \"unclosed")).toBe(en.reason.unterminatedQuote);
    });
});

/**
 * The command a word that did not parse was reaching for.
 *
 * A word an author types is not always a word that ever parsed: `/face` became `/char` and its
 * Chinese label went from 表情 to 外观 with it, so a Chinese author's fingers produce a token nothing
 * answers to and the row said only that no such command exists. What it says now is which command
 * the catalogue thinks was meant - and it says it WITHOUT a table of retired words, because a second,
 * historical vocabulary is a list nobody maintains and every rename has to remember to grow.
 *
 * It comes out of the catalogue as it stands: the word is looked for among today's spellings, and
 * then in what each command's own entry says it does - which is what catches the rename, since the
 * thing /char does has not changed and its description still says 表情 among the appearances it
 * switches. The assertions below are written to fail if that ever becomes a word list: 差分 is
 * another word out of the same sentence and has to answer the same way, and 見た目 - which appears in
 * no Chinese or English string at all - has to answer from the Japanese catalogue.
 */
describe("the nearest match to a word that names no command", () => {
    afterEach(() => {
        commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
        i18nStore.setLocale("en");
    });

    /** The reason, with its params filled - the suggestion is a param and the message is the key. */
    function suggestionFor(source: string): string | null {
        const reason = getCommandLineReason(source, CONTEXT);
        if (!reason || reason.key !== ("storyExpr.reason.unknownCommandNear" as TranslationKey)) {
            return null;
        }
        return String(reason.params.suggestion);
    }

    it("names the command in Chinese for the Chinese word the rename took away", () => {
        i18nStore.setLocale("zh");

        // The whole point: 表情 was /char's label until the rename, and it is still what the command
        // does - so the hint reaches it through the description, in the word an author would type.
        expect(suggestionFor("/表情 ")).toBe("外观");
        // Another word out of the same sentence, which a table of former labels would not hold.
        expect(suggestionFor("/差分 ")).toBe("外观");
    });

    it("reads every locale, not the active one", () => {
        // 見た目 is the Japanese label and appears in no English or Chinese string. Reaching it from
        // an English interface is what shows the table is the catalogue rather than one language of it
        // - and the answer is spelled in the language the author would have to type.
        expect(suggestionFor("/見た目 ")).toBe("char");
    });

    it("names the spelling a typo or an abbreviation is close to", () => {
        expect(suggestionFor("/bgg ")).toBe("bg");
        expect(suggestionFor("/backgroun ")).toBe("bg");
    });

    it("says nothing when nothing in the catalogue is close", () => {
        expect(suggestionFor("/xqjzzy ")).toBe(null);
    });
});
