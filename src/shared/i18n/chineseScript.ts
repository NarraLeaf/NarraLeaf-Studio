/**
 * Which script a Chinese language tag is written in.
 *
 * The same language reaches Studio spelled two ways. A project, and the system language list on
 * Windows and macOS, name it by script: `zh-Hans`, `zh-Hant-TW`. A Linux locale, and every name
 * Chromium gives its own locale packs, name it by region: `zh_CN`, `zh-TW`, `zh-HK`. Neither spelling
 * is a prefix of the other, so anything that compares tags as text sees two unrelated languages -
 * which is how a `zh-Hans` project came to keep no Chinese locale pack in a shipped game, and how a
 * player whose system says `zh-CN` came to be offered a `zh-Hans` game in its source language.
 *
 * The region table is short. Taiwan, Hong Kong and Macau write Traditional characters; everywhere
 * else - mainland China, Singapore, Malaysia, and any region nobody thought of - Simplified. It is
 * the table Chromium itself uses (measured on Electron 38: `zh-HK` and `zh-MO` settle on the `zh-TW`
 * pack, `zh-SG`, `zh-MY` and an unknown region on `zh-CN`), which matters wherever a pack name has to
 * be predicted from a tag.
 *
 * Dependency-free on purpose: the game runtime's renderer and the build worker both use it, and
 * neither may pull Studio's catalog in along with it.
 */

/** A language tag taken apart as far as choosing a pack or a match needs, all lower-cased. */
export interface LocaleTagParts {
    language: string;
    script: string | null;
    region: string | null;
}

/**
 * Read the language, script and region out of a tag; `null` when it does not begin with a language
 * code at all.
 *
 * `_` is read as `-`, the way a POSIX locale spells the same tag. Anything after the region -
 * variants, extensions, an encoding - says nothing to either question this file answers.
 */
export function localeTagParts(tag: string): LocaleTagParts | null {
    const subtags = tag.trim().toLowerCase().split(/[-_.@]/);
    const language = subtags[0] ?? "";
    if (!/^[a-z]{2,3}$/.test(language)) {
        return null;
    }
    let index = 1;
    let script: string | null = null;
    if (/^[a-z]{4}$/.test(subtags[index] ?? "")) {
        script = subtags[index];
        index += 1;
    }
    const region = /^([a-z]{2}|\d{3})$/.test(subtags[index] ?? "") ? subtags[index] : null;
    return { language, script, region };
}

export type ChineseScript = "hans" | "hant";

/** The regions whose Chinese is written in Traditional characters. Every other region's is Simplified. */
export const TRADITIONAL_CHINESE_REGIONS: ReadonlySet<string> = new Set(["tw", "hk", "mo"]);

/**
 * The script a Chinese tag is written in, or `null` when it is not Chinese or does not say.
 *
 * A script subtag answers outright. Failing that, the region answers through the table above. Bare
 * `zh` says nothing: it is every Chinese reader, and each caller decides what that means for it.
 */
export function chineseScriptOf(tag: string | LocaleTagParts): ChineseScript | null {
    const parts = typeof tag === "string" ? localeTagParts(tag) : tag;
    if (!parts || parts.language !== "zh") {
        return null;
    }
    if (parts.script === "hans" || parts.script === "hant") {
        return parts.script;
    }
    if (parts.region === null) {
        return null;
    }
    return TRADITIONAL_CHINESE_REGIONS.has(parts.region) ? "hant" : "hans";
}
