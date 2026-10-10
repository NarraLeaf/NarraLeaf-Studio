/**
 * Widget props that take one word out of a fixed list, and the list.
 *
 * A prop of this kind fails without a sound when it is given anything else: the renderer maps the
 * word to CSS through a `switch`, an unknown word matches no arm, and the text is laid out by
 * whatever the browser defaults to - which is a different layout from the one the author picked,
 * with nothing anywhere saying so. `textWrapMode: "char"` was written by a tool exactly like that.
 * So the tools that write props (`ui apply`, the agent's `ui_patch`) refuse such a value at the
 * door and name the words that are accepted.
 *
 * Keyed by prop name rather than by widget type, because every widget that carries one of these
 * props carries the same union under the same name (the text widget and everything extending it,
 * the button, the text input, the list's writing mode). A prop whose words differ between widgets
 * does not belong in this table.
 *
 * Comments in English per project convention.
 */

import type { TextVerticalAlign, TextWrapMode } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { TEXT_ORIENTATIONS, TEXT_WRITING_MODES } from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";

/**
 * Written as a key per member, as `verticalTypography` does, so that a word added to the union fails
 * to compile here instead of being refused by the tools while the editor offers it.
 */
const TEXT_WRAP_MODE_MEMBERS: Record<TextWrapMode, true> = { word: true, character: true, nowrap: true };
const TEXT_VERTICAL_ALIGN_MEMBERS: Record<TextVerticalAlign, true> = { start: true, center: true, end: true };

export const UI_ENUM_PROP_VALUES: Readonly<Record<string, readonly string[]>> = {
    textWrapMode: Object.keys(TEXT_WRAP_MODE_MEMBERS),
    textVerticalAlign: Object.keys(TEXT_VERTICAL_ALIGN_MEMBERS),
    writingMode: TEXT_WRITING_MODES,
    textOrientation: TEXT_ORIENTATIONS,
};

export type UiEnumPropProblem = {
    key: string;
    value: unknown;
    allowed: readonly string[];
};

/**
 * The props in `props` that hold a word their list does not have.
 *
 * An absent prop, and one set to `null`, are not problems: both leave the widget on its default.
 */
export function findInvalidEnumProps(props: Readonly<Record<string, unknown>> | null | undefined): UiEnumPropProblem[] {
    if (!props) {
        return [];
    }
    const problems: UiEnumPropProblem[] = [];
    for (const [key, allowed] of Object.entries(UI_ENUM_PROP_VALUES)) {
        if (!(key in props)) {
            continue;
        }
        const value = props[key];
        if (value === null || value === undefined) {
            continue;
        }
        if (typeof value !== "string" || !allowed.includes(value)) {
            problems.push({ key, value, allowed });
        }
    }
    return problems;
}

/** `textWrapMode is "char"; it takes one of: word, character, nowrap` */
export function describeInvalidEnumProp(problem: UiEnumPropProblem): string {
    return `${problem.key} is ${JSON.stringify(problem.value)}; it takes one of: ${problem.allowed.join(", ")}`;
}
