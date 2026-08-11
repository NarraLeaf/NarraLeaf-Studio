import type { TranslationKey } from "@shared/i18n";
import type { StoryCommandGroupId } from "./storyCommandCategories";
import { commandDetailKey, commandLabelKey, getDefById, listCommandSpecs, localizedCommandToken } from "./commands/registry";
import type { AnyStoryCommandSpec } from "./commands/registry";
import type { StoryCommandParamSpec } from "./commands/spec";
import { localizedEnumValue } from "./commands/localizedEnums";
import { paramHintKey, paramTypes, type StoryCommandParamType } from "./storyCommandGrammar";
import { STORY_COMMAND_PINYIN } from "./storyCommandPinyin.generated";

/**
 * The command manual, projected straight from the spec registry. Every entry — signature,
 * parameters, aliases, label, detail — is derived from the same spec the parser and the menu read, so
 * the manual can never drift from the real grammar and needs no hand-maintenance: a new spec appears
 * here for free.
 *
 * The parameter table is the reason this file grew. The grammar already knows everything a reader
 * needs — which slots are required, what values each accepts, which enum words are legal, what a
 * number's range is — and none of it was reaching the page, which printed `[t=]` and left the author
 * to guess. Deriving the answer from `StoryCommandParamType` means no per-parameter prose has to be
 * written or translated for it, and no parameter can be documented as something it is not.
 *
 * Built with the COMMAND-language translator (`editor.localizedCommands`), body and all: this is the
 * reference FOR that vocabulary, and a page whose signatures are English while the words describing
 * them are Chinese reads as neither. The panel's chrome around it stays in the interface language.
 */

type ManualTranslate = (key: TranslationKey) => string;

/** One row of a command's parameter table. */
export type StoryCommandManualParam = {
    /** The key an author types (`at`), or the slot's own name for a positional. */
    name: string;
    /** Author-facing name of the slot, the same word the inline ghost hint uses. */
    hint: string;
    /** How the value is written: `name=` for a named param, `<name>` / `[name]` for a positional. */
    slot: string;
    /** Human description of the accepted values, derived from the param's type(s). */
    accepts: string;
    /** Part of the command's required core — Enter will not commit the line without it. */
    required: boolean;
    /** Consumes the rest of the line, spaces included. */
    greedy: boolean;
    /** Other keys accepted for the same slot. */
    aliases: string[];
};

export type StoryCommandManualEntry = {
    id: string;
    group: StoryCommandGroupId;
    /** The `/token` an author types, in the command language - `/背景` where that word parses. */
    token: string;
    /** The signature, e.g. `/bg <Image or Color> [t=] [d=]`. */
    signature: string;
    /**
     * Every other `/`-spelling that reaches this command, e.g. `["/background"]`. The canonical
     * English token joins the list wherever it is not the one above: it never stops parsing, so a
     * manual that omitted it would be documenting a narrower grammar than the one that runs.
     */
    aliases: string[];
    label: string;
    detail: string;
    params: StoryCommandManualParam[];
    /** Working lines, verified by the spec suite to parse, resolve and build. */
    examples: string[];
};

/**
 * What a param's type accepts, in words.
 *
 * Enum and keyword values are printed literally - they are words the author types, not descriptions of
 * words. Which spelling gets printed is the one that will be accepted back: an enum value goes through
 * `localizedEnumValue`, the same call the candidate menu shows and inserts, so the page can never
 * document a word the parser does not speak. A keyword has no alias table, so it stays as
 * it is written in the grammar. Everything else names its kind through a key.
 */
function describeType(type: StoryCommandParamType, t: ManualTranslate): string {
    switch (type.kind) {
        case "asset":
            return t(`story.manual.type.${type.assetType}` as TranslationKey);
        case "character":
            return t(type.allowTemp ? "story.manual.type.characterOrName" : "story.manual.type.character");
        case "characterForm":
            return t("story.manual.type.characterForm");
        case "puppetName":
            return t(`story.manual.type.puppet.${type.channel}` as TranslationKey);
        case "puppetParam":
            return t("story.manual.type.puppet.param");
        case "scene":
            return t("story.manual.type.scene");
        case "audioTrack":
            return t("story.manual.type.audioTrack");
        case "label":
            return t("story.manual.type.label");
        case "appTag":
            return t("story.manual.type.appTag");
        case "variable":
            return t("story.manual.type.variable");
        case "target":
            return type.accepts.map(kind => t(`story.manual.target.${kind}` as TranslationKey)).join(" / ");
        case "content":
            return t("story.manual.type.content");
        case "enum":
            return type.options.map(option => localizedEnumValue(type, option)).join(" | ");
        case "keyword":
            return type.value;
        case "number":
            return describeNumber(type, t);
        case "boolean":
            return "true | false";
        case "color":
            return t("story.manual.type.color");
        case "literal":
            return t("story.manual.type.literal");
        case "constant":
            return t("story.manual.type.constant");
        case "text":
            return t("story.manual.type.text");
        case "expression":
            return t(type.expects === "boolean" ? "story.manual.type.expressionBoolean" : "story.manual.type.expression");
    }
}

function describeNumber(type: Extract<StoryCommandParamType, { kind: "number" }>, t: ManualTranslate): string {
    const base = t(type.integer ? "story.manual.type.integer" : "story.manual.type.number");
    if (type.min !== undefined && type.max !== undefined) {
        return `${base} ${type.min}-${type.max}`;
    }
    if (type.min !== undefined) {
        return `${base} ≥ ${type.min}`;
    }
    if (type.max !== undefined) {
        return `${base} ≤ ${type.max}`;
    }
    return base;
}

function paramHint(name: string, param: StoryCommandParamSpec, t: ManualTranslate): string {
    return t(`story.paramHint.${paramHintKey({ ...param, name })}` as TranslationKey);
}

/**
 * One param's slot in a signature: a positional shows its localized hint (the same word the ghost
 * names it by), a named param shows `key=`. Core slots are `<…>`, optional slots `[…]`, and a greedy
 * value trails an ellipsis.
 */
function paramSlot(name: string, param: StoryCommandParamSpec, t: ManualTranslate): string {
    if (param.positional) {
        const hint = paramHint(name, param, t);
        const inner = param.greedy ? `${hint}…` : hint;
        return param.core ? `<${inner}>` : `[${inner}]`;
    }
    const inner = `${name}=`;
    return param.core ? `<${inner}>` : `[${inner}]`;
}

/**
 * The word this command is spelled with here: the same one the completion menu inserts and the same
 * one the insert line settles on. The page teaches what the editor writes, or it teaches nothing.
 */
function manualToken(spec: AnyStoryCommandSpec): string {
    const def = getDefById(spec.id);
    return def ? localizedCommandToken(def) : spec.token;
}

function signatureOf(spec: AnyStoryCommandSpec, t: ManualTranslate): string {
    const parts = [`/${manualToken(spec)}`];
    for (const [name, param] of Object.entries(spec.params)) {
        parts.push(paramSlot(name, param, t));
    }
    return parts.join(" ");
}

function manualParams(spec: AnyStoryCommandSpec, t: ManualTranslate): StoryCommandManualParam[] {
    return Object.entries(spec.params).map(([name, param]) => ({
        name,
        hint: paramHint(name, param, t),
        slot: paramSlot(name, param, t),
        // A union lists every branch: `/wait` takes a number of seconds OR the word `click`, and a
        // reader who is only shown one of those learns a grammar narrower than the one that parses.
        accepts: paramTypes({ ...param, name }).map(type => describeType(type, t)).join(" | "),
        required: param.core === true,
        greedy: param.greedy === true,
        aliases: [...(param.aliases ?? [])],
    }));
}

export function buildStoryCommandManual(t: ManualTranslate): StoryCommandManualEntry[] {
    return listCommandSpecs().map(spec => ({
        id: spec.id,
        group: spec.category,
        token: `/${manualToken(spec)}`,
        signature: signatureOf(spec, t),
        aliases: [
            ...(manualToken(spec) === spec.token ? [] : [spec.token]),
            ...(spec.aliases ?? []),
        ].map(alias => `/${alias}`),
        label: t(commandLabelKey(spec.id)),
        detail: t(commandDetailKey(spec.id)),
        params: manualParams(spec, t),
        examples: [...(spec.examples ?? [])],
    }));
}

/**
 * Filter the manual by a free query. Matches token, aliases, label, detail, signature, parameter names
 * and — so a Latin author still finds a Chinese-labelled command — the command's pinyin (full +
 * initials), the same domain the palette search covers. Empty query returns everything, in registry
 * order.
 */
export function filterStoryCommandManual(entries: StoryCommandManualEntry[], rawQuery: string): StoryCommandManualEntry[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
        return entries;
    }
    return entries.filter(entry => {
        const pinyin = STORY_COMMAND_PINYIN[entry.id];
        const haystack = [
            entry.token,
            entry.signature,
            entry.label,
            entry.detail,
            ...entry.aliases,
            ...entry.params.map(param => `${param.name} ${param.hint}`),
            ...(pinyin ? [pinyin.full, pinyin.initials] : []),
        ].map(text => text.toLowerCase());
        return haystack.some(text => text.includes(query));
    });
}
