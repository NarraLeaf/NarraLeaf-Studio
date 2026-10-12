/**
 * What a plugin story action declares beyond its label: the fields its rows show
 * (`StoryPluginActionRegistration.params`) and the words a typed command finds it by (`keywords`).
 * Checking both at registration, and the pure half of the scene inspector that edits the fields.
 *
 * Kept apart from the inspector component so the story service can refuse a malformed declaration
 * without importing UI, and so the option list and the param write are testable without React.
 */

import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import type { StoryPluginActionParamDef } from "@/lib/workspace/services/services";
import type { StoryPluginActionParamValue } from "@shared/types/story";

/** The field kinds this Studio draws for a plugin row. */
export const STORY_PLUGIN_ACTION_PARAM_KINDS: readonly StoryPluginActionParamDef["kind"][] = ["select", "string", "number"];

/**
 * Why a registration's `params` cannot be used, or null when it can.
 *
 * Only the shape is checked. A kind this Studio does not know passes, and the inspector leaves that
 * field out (see {@link editableStoryPluginActionParams}): refusing it would fail the whole plugin on
 * an older Studio over one field.
 */
export function storyPluginActionParamsProblem(params: unknown): string | null {
    if (params === undefined) {
        return null;
    }
    if (!Array.isArray(params)) {
        return "params must be an array";
    }
    const keys = new Set<string>();
    for (const [index, param] of params.entries()) {
        if (!param || typeof param !== "object") {
            return `params[${index}] must be an object`;
        }
        const { key, label, kind } = param as Record<string, unknown>;
        if (typeof key !== "string" || !key.trim()) {
            return `params[${index}].key must be a non-empty string`;
        }
        if (typeof label !== "string") {
            return `params[${index}].label must be a string`;
        }
        if (typeof kind !== "string") {
            return `params[${index}].kind must be a string`;
        }
        if (keys.has(key)) {
            return `params declares "${key}" twice`;
        }
        keys.add(key);
    }
    return null;
}

/** Why a registration's `keywords` cannot be used, or null when they can. */
export function storyPluginActionKeywordsProblem(keywords: unknown): string | null {
    if (keywords === undefined) {
        return null;
    }
    if (!Array.isArray(keywords)) {
        return "keywords must be an array";
    }
    for (const [index, keyword] of keywords.entries()) {
        // A typed command word ends at the first space, so a keyword holding one could never match.
        if (typeof keyword !== "string" || !/^\S+$/.test(keyword)) {
            return `keywords[${index}] must be a single word`;
        }
    }
    return null;
}

/** The declared fields this Studio can draw, in declaration order. */
export function editableStoryPluginActionParams(
    params: readonly StoryPluginActionParamDef[] | undefined,
): StoryPluginActionParamDef[] {
    return (params ?? []).filter(param => STORY_PLUGIN_ACTION_PARAM_KINDS.includes(param.kind));
}

export type StoryPluginParamSelectOption = { value: string; label: string };

/**
 * The options a `select` field lists for a row whose `params[key]` is `current`.
 *
 * An empty entry first, unless the plugin's own list carries one, as on a node card. A stored value
 * no option answers to - an entry since removed from the plugin's list, or a word typed after the
 * command - is listed under `missingLabel` rather than shown as a blank, so the row says what it
 * holds until the author picks something else.
 */
export function storyPluginParamSelectOptions(
    param: StoryPluginActionParamDef,
    dynamicOptions: Readonly<Record<string, BlueprintInspectorParamSelectOption[]>>,
    current: StoryPluginActionParamValue | undefined,
    missingLabel: (value: string) => string,
): StoryPluginParamSelectOption[] {
    const listed = param.options
        ?? (param.dynamicOptionsSource ? dynamicOptions[param.dynamicOptionsSource] : undefined)
        ?? [];
    const options: StoryPluginParamSelectOption[] = listed.map(option => ({ value: option.value, label: option.label }));
    if (!options.some(option => option.value === "")) {
        options.unshift({ value: "", label: param.emptyOptionLabel ?? "-" });
    }
    const stored = typeof current === "string" ? current : "";
    if (stored && !options.some(option => option.value === stored)) {
        options.push({ value: stored, label: missingLabel(stored) });
    }
    return options;
}

/**
 * The row's params with `key` set to `value`, or without `key` when `value` is empty.
 *
 * Empty means unset: a cleared pick or field leaves no key behind, which is what a row inserted
 * without that param carries too, so the plugin reads the two the same way.
 */
export function withStoryPluginParam(
    params: Readonly<Record<string, StoryPluginActionParamValue>>,
    key: string,
    value: string | number | undefined,
): Record<string, StoryPluginActionParamValue> {
    const next: Record<string, StoryPluginActionParamValue> = { ...params };
    if (value === undefined || value === "") {
        delete next[key];
    } else {
        next[key] = value;
    }
    return next;
}
