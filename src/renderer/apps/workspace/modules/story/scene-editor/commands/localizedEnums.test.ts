import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { getArgValue, parseCommandLine } from "../storyCommandParser";
import { resolveCommandLine, EMPTY_STORY_COMMAND_CONTEXT } from "../storyCommandResolution";
import { paramTypes, type StoryCommandParamType } from "../storyCommandGrammar";
import { getCommandDef, listCommandDefs } from "./registry";
import { localizedEnumValue, matchEnumOptionLocalized } from "./localizedEnums";

/**
 * The last of the three alias tables. Commands and param keys already spoke the author's language;
 * the value did not, so a Chinese line had to switch back to English for its last word — and `t=淡变`
 * failed as a value no option matched rather than as an error anything could name.
 */

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

/** The enum type behind a def's param, for the tests that poke the table directly. */
function enumType(commandId: string, paramName: string): Extract<StoryCommandParamType, { kind: "enum" }> {
    const param = getCommandDef(commandId)!.params.find(candidate => candidate.name === paramName)!;
    const type = paramTypes(param).find(candidate => candidate.kind === "enum");
    if (!type || type.kind !== "enum") {
        throw new Error(`${commandId}.${paramName} is not an enum`);
    }
    return type;
}

afterEach(() => {
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

describe("matchEnumOptionLocalized", () => {
    it("resolves a translated value to its canonical option", () => {
        i18nStore.setLocale("zh");
        const t = enumType("bg", "t");
        expect(matchEnumOptionLocalized(t, "淡变")?.value).toBe("fade");
        expect(matchEnumOptionLocalized(t, "百叶")?.value).toBe("blinds");
        expect(matchEnumOptionLocalized(t, "黑场")?.value).toBe("black");
    });

    it("keeps canonical values and English aliases working in every locale", () => {
        for (const locale of ["en", "zh"] as const) {
            i18nStore.setLocale(locale);
            const t = enumType("bg", "t");
            expect(matchEnumOptionLocalized(t, "fade")?.value, locale).toBe("fade");
            expect(matchEnumOptionLocalized(t, "dissolve")?.value, locale).toBe("fade");
            expect(matchEnumOptionLocalized(t, "FADE")?.value, locale).toBe("fade");
        }
    });

    it("stops accepting the translation once the vocabulary is switched off", () => {
        i18nStore.setLocale("zh");
        expect(matchEnumOptionLocalized(enumType("bg", "t"), "淡变")?.value).toBe("fade");
        commandI18nStore.setPreference(false);
        expect(matchEnumOptionLocalized(enumType("bg", "t"), "淡变")).toBeNull();
        expect(matchEnumOptionLocalized(enumType("bg", "t"), "fade")?.value).toBe("fade");
    });

    it("keeps two values that share a Chinese word reachable, because the table is per option set", () => {
        // `darken` (a camera operation) and `darkness` (a transition) are both 压暗. They never share
        // an option set, and a single global table would have made whichever came second unreachable.
        i18nStore.setLocale("zh");
        expect(matchEnumOptionLocalized(enumType("camera", "op"), "压暗")?.value).toBe("darken");
        expect(matchEnumOptionLocalized(enumType("bg", "t"), "压暗")?.value).toBe("darkness");
    });
});

describe("the parse, end to end", () => {
    it("reads a fully Chinese command line", () => {
        i18nStore.setLocale("zh");
        // Verb, param key and value, all translated — the sentence that was impossible before.
        expect(codes("/背景 forest 转场=淡变 持续时间=1")).toEqual([]);
        const line = command("/背景 forest 转场=淡变 持续时间=1");
        expect(line.def?.commandId).toBe("background");
        expect(getArgValue(line, "t")).toBe("淡变");
    });

    it("stores the canonical English value however it was spelled (bible B6)", () => {
        const stored = (source: string) => {
            const line = command(source);
            return resolveCommandLine(line, EMPTY_STORY_COMMAND_CONTEXT).args.t;
        };
        i18nStore.setLocale("zh");
        expect(stored("/背景 forest 转场=淡变")).toMatchObject({ kind: "enum", value: "fade" });
        expect(stored("/bg forest t=fade")).toMatchObject({ kind: "enum", value: "fade" });
        expect(stored("/bg forest t=dissolve")).toMatchObject({ kind: "enum", value: "fade" });
    });

    it("still rejects a value this command does not support", () => {
        i18nStore.setLocale("zh");
        // 缩放 is a real transition word, but not one `/bg` accepts — a translated spelling must not
        // become a way in through the back door.
        expect(codes("/bg forest t=缩放")).toEqual(["badValue"]);
        expect(codes("/bg forest t=不存在的词")).toEqual(["badValue"]);
    });
});

describe("localizedEnumValue", () => {
    it("offers the spelling it will accept back — every enum, every locale", () => {
        // The invariant: whatever the menu shows is what it inserts, and what it inserts parses back
        // to the very option it came from.
        for (const locale of ["en", "zh"] as const) {
            i18nStore.setLocale(locale);
            for (const def of listCommandDefs()) {
                for (const param of def.params) {
                    for (const type of paramTypes(param)) {
                        if (type.kind !== "enum") {
                            continue;
                        }
                        for (const option of type.options) {
                            const spelling = localizedEnumValue(type, option);
                            expect(spelling, `${def.token}.${param.name} offers an empty value`).not.toBe("");
                            expect(/\s/.test(spelling), `${def.token}.${param.name} offers "${spelling}", not one token`).toBe(false);
                            expect(
                                matchEnumOptionLocalized(type, spelling)?.value,
                                `${locale} ${def.token}.${param.name}: "${spelling}" does not read back as ${option.value}`,
                            ).toBe(option.value);
                        }
                    }
                }
            }
        }
    });

    it("falls back to the canonical value where a locale adds no word of its own", () => {
        i18nStore.setLocale("en");
        expect(localizedEnumValue(enumType("bg", "t"), { value: "fade" })).toBe("fade");
        i18nStore.setLocale("zh");
        // A code language is a proper noun, left untranslated on purpose.
        expect(localizedEnumValue(enumType("code", "language"), { value: "typescript" })).toBe("typescript");
    });
});
