import { afterEach, describe, expect, it } from "vitest";
import { commandI18nStore, i18nStore } from "@/lib/i18n";
import { LOCALIZED_COMMANDS_DEFAULT } from "@/lib/settings/commandLanguageOptions";
import { story as en } from "@shared/i18n/catalog/en/story";
import { getArgValue, parseCommandLine } from "../storyCommandParser";
import { getCommandDef, listCommandDefs } from "./registry";
import { findParamLocalized, localizedParamKey, paramMatchesQuery } from "./localizedParams";

/**
 * A param's localized spelling: the half of the vocabulary that used to be display-only.
 *
 * The ghost hint has always said `<位置>`; until this table existed, `位置=left` was an
 * `unknownParam` — one slot with two names, only one of which worked. These are the tests that keep
 * the two names one name.
 *
 * Two knobs decide what a line means, and they are exercised separately: the interface language
 * (`i18nStore`), and whether the command vocabulary follows it at all (`editor.localizedCommands`,
 * driven here through `commandI18nStore.setPreference`).
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

afterEach(() => {
    commandI18nStore.setPreference(LOCALIZED_COMMANDS_DEFAULT);
    i18nStore.setLocale("en");
});

describe("findParamLocalized", () => {
    it("resolves a translated key to its canonical param", () => {
        i18nStore.setLocale("zh");
        const show = getCommandDef("show")!;
        expect(findParamLocalized(show, "位置")?.name).toBe("at");
        expect(findParamLocalized(show, "转场")?.name).toBe("t");
        expect(findParamLocalized(show, "持续时间")?.name).toBe("d");
    });

    it("keeps the canonical name and the English alias working in every locale", () => {
        // The load-bearing promise: a script written in one locale parses in every other.
        const show = getCommandDef("show")!;
        for (const locale of ["en", "zh"] as const) {
            i18nStore.setLocale(locale);
            expect(findParamLocalized(show, "at")?.name).toBe("at");
            expect(findParamLocalized(show, "pos")?.name).toBe("at");
            expect(findParamLocalized(show, "d")?.name).toBe("d");
        }
    });

    it("stops accepting a translated key once the interface language moves off it", () => {
        const show = getCommandDef("show")!;
        i18nStore.setLocale("zh");
        expect(findParamLocalized(show, "位置")?.name).toBe("at");
        i18nStore.setLocale("en");
        expect(findParamLocalized(show, "位置")).toBeNull();
    });

    it("follows the interface language while translation is on", () => {
        // The default path, and the reason the store subscribes to `i18nStore` at all.
        const show = getCommandDef("show")!;
        commandI18nStore.setPreference(true);
        i18nStore.setLocale("zh");
        expect(findParamLocalized(show, "位置")?.name).toBe("at");
    });

    it("stays English while translation is off, whatever the interface language", () => {
        // Chinese menus, English commands — the combination the switch exists to allow.
        const show = getCommandDef("show")!;
        commandI18nStore.setPreference(false);
        i18nStore.setLocale("zh");
        expect(findParamLocalized(show, "位置")).toBeNull();
        expect(findParamLocalized(show, "at")?.name).toBe("at");
    });
});

describe("localized params in a parsed line", () => {
    it("parses a translated key exactly as the canonical one", () => {
        i18nStore.setLocale("zh");
        const localized = command("/show Anyo 位置=left");
        const english = command("/show Anyo at=left");
        expect(getArgValue(localized, "at")).toBe("left");
        expect(localized.issues).toEqual([]);
        expect(localized.args.map(arg => [arg.param?.name, arg.value]))
            .toEqual(english.args.map(arg => [arg.param?.name, arg.value]));
    });

    it("reports a translated key the command language does not know as unknown", () => {
        commandI18nStore.setPreference(false);
        i18nStore.setLocale("zh");
        expect(codes("/show Anyo 位置=left")).toContain("unknownParam");
    });

    it("treats a translated key and its canonical twin as the same slot", () => {
        // Otherwise `/show Anyo at=left 位置=right` would quietly set the placement twice.
        i18nStore.setLocale("zh");
        expect(codes("/show Anyo at=left 位置=right")).toContain("duplicateParam");
    });

    it("keeps a greedy param from swallowing a translated key", () => {
        // `/text` is greedy from its content slot on, and the greedy branch decides between "a named
        // param" and "prose" by asking whether the token names a real param — a question that has to
        // be asked in the language the author is typing, or `名称=hero` lands as part of the text.
        i18nStore.setLocale("zh");
        const line = command("/text 名称=hero Hello");
        expect(getArgValue(line, "name")).toBe("hero");
        expect(getArgValue(line, "content")).toBe("Hello");
    });
});

describe("drop rules", () => {
    // The table is derived, so these are invariants over every real def in every real locale rather
    // than a handful of examples: whatever a translator writes next, none of it may shadow English.
    const locales = ["en", "zh"] as const;

    it("never lets a translated spelling shadow a canonical name or alias", () => {
        for (const locale of locales) {
            i18nStore.setLocale(locale);
            for (const def of listCommandDefs()) {
                for (const param of def.params) {
                    expect(findParamLocalized(def, param.name)?.name).toBe(param.name);
                    for (const alias of param.aliases ?? []) {
                        expect(findParamLocalized(def, alias)?.name).toBe(param.name);
                    }
                }
            }
        }
    });

    it("drops a multi-word label, which is not a single inline token", () => {
        // `story.paramHint.variableName` is "Var Name" in English. `/local Var Name=1` must not parse.
        i18nStore.setLocale("en");
        expect(en.paramHint.variableName).toContain(" ");
        const local = getCommandDef("local")!;
        expect(findParamLocalized(local, "var name")).toBeNull();
        expect(findParamLocalized(local, "var")).toBeNull();
    });

    it("drops a label that already spells one of the def's own English keys", () => {
        // `story.paramHint.transition` is "Transition", which is already `t`'s alias — the English
        // pass answers it, and the table must not carry a second, identical entry.
        i18nStore.setLocale("en");
        const show = getCommandDef("show")!;
        expect(findParamLocalized(show, "transition")?.name).toBe("t");
    });

    it("never admits an untranslated key as a spelling", () => {
        // `translate` echoes the dotted key on a miss; banking that would make `story.paramHint.at=`
        // a legal thing to type.
        for (const locale of locales) {
            i18nStore.setLocale(locale);
            for (const def of listCommandDefs()) {
                for (const param of def.params) {
                    expect(findParamLocalized(def, `story.paramHint.${param.hint ?? param.name}`)).toBeNull();
                }
            }
        }
    });
});

describe("localizedParamKey", () => {
    it("offers the spelling it will accept back — every param, every locale", () => {
        // What the menu shows in its reading column is what it inserts, and what it inserts has to
        // resolve to the very slot it came from.
        for (const locale of ["en", "zh"] as const) {
            i18nStore.setLocale(locale);
            for (const def of listCommandDefs()) {
                for (const param of def.params) {
                    const spelling = localizedParamKey(def, param);
                    expect(spelling, `${def.token}.${param.name} offers an empty key`).not.toBe("");
                    expect(/\s/.test(spelling), `${def.token}.${param.name} offers "${spelling}", not one token`).toBe(false);
                    expect(
                        findParamLocalized(def, spelling)?.name,
                        `${locale} ${def.token}: "${spelling}" does not read back as ${param.name}`,
                    ).toBe(param.name);
                }
            }
        }
    });

    it("falls back to the canonical key where the locale has no single word for the slot", () => {
        const show = getCommandDef("show")!;
        i18nStore.setLocale("en");
        // "Position" folds onto nothing new in English, so the key stays what it always was.
        expect(localizedParamKey(show, show.params.find(p => p.name === "at")!)).toBe("at");
        i18nStore.setLocale("zh");
        expect(localizedParamKey(show, show.params.find(p => p.name === "at")!)).toBe("位置");
        expect(localizedParamKey(show, show.params.find(p => p.name === "d")!)).toBe("持续时间");
    });
});

describe("paramMatchesQuery", () => {
    it("matches the canonical name, the English alias, and the translated word", () => {
        i18nStore.setLocale("zh");
        const show = getCommandDef("show")!;
        const at = show.params.find(param => param.name === "at")!;
        // An author who was just shown "位置" and types it has to keep seeing the row.
        expect(paramMatchesQuery(show, at, "位")).toBe(true);
        expect(paramMatchesQuery(show, at, "at")).toBe(true);
        expect(paramMatchesQuery(show, at, "po")).toBe(true);
        expect(paramMatchesQuery(show, at, "")).toBe(true);
        expect(paramMatchesQuery(show, at, "zz")).toBe(false);
    });
});
