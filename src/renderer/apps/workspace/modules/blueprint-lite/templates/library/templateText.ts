/**
 * Helpers the library's template files share for writing a graph in the blueprint text format.
 *
 * Comments in English per project convention.
 */

import type { Locale } from "@shared/i18n/locales";
import type { BlueprintLayerTemplateFacts } from "../blueprintLayerTemplates";

/** The owner kinds a widget's own blueprint has: on a page, and inside a component definition. */
export const WIDGET_OWNERS = ["widgetMain", "componentWidgetMain"] as const;

/** A `key = value` line under a node, or nothing when there is no value to write. */
export function field(key: string, value: string | undefined): string {
    return value === undefined ? "" : `        ${key} = ${JSON.stringify(value)}`;
}

/** The rows of a graph, one per line, with the empty ones a missing {@link field} leaves dropped. */
export function lines(...rows: string[]): string {
    return rows.filter(row => row.length > 0).join("\n");
}

/** What the quit templates write into the game, so it is what the player reads. */
const QUIT_TEXT: Readonly<Record<Locale, { question: string; confirm: string; cancel: string }>> = {
    en: { question: "Quit the game?", confirm: "Quit", cancel: "Cancel" },
    zh: { question: "确定要退出游戏吗？", confirm: "退出", cancel: "取消" },
    ja: { question: "ゲームを終了しますか？", confirm: "終了", cancel: "キャンセル" },
};

/** `Show Confirm` asking whether to quit, with Quit as the first button and Cancel as the second. */
export function quitConfirmNode(id: string, position: string, facts: BlueprintLayerTemplateFacts): string {
    const text = QUIT_TEXT[facts.locale];
    return lines(
        `    ${id}: blueprint.layer.confirm ${position}`,
        field("surfaceId", facts.confirmPage),
        `        __confirmButtonPins = ["button_1_label","button_1_pressed","button_2_label","button_2_pressed"]`,
        field("message", text.question),
        field("button_1_label", text.confirm),
        field("button_2_label", text.cancel),
    );
}
