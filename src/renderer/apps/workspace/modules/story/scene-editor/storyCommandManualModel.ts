import type { TranslationKey } from "@shared/i18n";
import type { ActionCommandGroupCategoryId } from "./storyActionCommands";
import { commandDetailKey, commandLabelKey, listCommandSpecs } from "./commands/registry";
import type { AnyStoryCommandSpec } from "./commands/registry";
import type { StoryCommandParamSpec } from "./commands/spec";
import { STORY_COMMAND_PINYIN } from "./storyCommandPinyin.generated";

/**
 * The command reference, projected straight from the spec registry (WI-2). Every entry — signature,
 * aliases, label, detail — is derived from the same spec the parser and the menu read, so the manual
 * can never drift from the real grammar and needs no hand-maintenance: a new spec appears here for free.
 */

type ManualTranslate = (key: TranslationKey) => string;

export type StoryCommandManualEntry = {
    id: string;
    category: ActionCommandGroupCategoryId;
    /** The canonical `/token`. */
    token: string;
    /** The bible-notation signature, e.g. `/bg <Image or Color> [t=] [d=]`. */
    signature: string;
    /** `/`-spelled aliases, e.g. `["/background"]`. */
    aliases: string[];
    label: string;
    detail: string;
};

/**
 * One param's slot in a signature: a positional shows its localized hint (the same word the ghost
 * names it by), a named param shows `key=`. Core slots are `<…>`, optional slots `[…]`, and a greedy
 * value trails an ellipsis — the bible's own notation (§2).
 */
function paramSlot(name: string, param: StoryCommandParamSpec, t: ManualTranslate): string {
    if (param.positional) {
        const hint = t(`story.paramHint.${param.hint ?? name}` as TranslationKey);
        const inner = param.greedy ? `${hint}…` : hint;
        return param.core ? `<${inner}>` : `[${inner}]`;
    }
    const inner = `${name}=`;
    return param.core ? `<${inner}>` : `[${inner}]`;
}

function signatureOf(spec: AnyStoryCommandSpec, t: ManualTranslate): string {
    const parts = [`/${spec.token}`];
    for (const [name, param] of Object.entries(spec.params)) {
        parts.push(paramSlot(name, param, t));
    }
    return parts.join(" ");
}

export function buildStoryCommandManual(t: ManualTranslate): StoryCommandManualEntry[] {
    return listCommandSpecs().map(spec => ({
        id: spec.id,
        category: spec.category,
        token: `/${spec.token}`,
        signature: signatureOf(spec, t),
        aliases: (spec.aliases ?? []).map(alias => `/${alias}`),
        label: t(commandLabelKey(spec.id)),
        detail: t(commandDetailKey(spec.id)),
    }));
}

/**
 * Filter the manual by a free query. Matches token, aliases, label, detail, signature, and — so a
 * Latin author still finds a Chinese-labelled command — the command's pinyin (full + initials), the
 * same domain the palette search covers. Empty query returns everything, in registry order.
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
            ...(pinyin ? [pinyin.full, pinyin.initials] : []),
        ].map(text => text.toLowerCase());
        return haystack.some(text => text.includes(query));
    });
}
