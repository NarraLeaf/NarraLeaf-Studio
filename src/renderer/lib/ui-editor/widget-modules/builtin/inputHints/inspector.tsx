import type { ColorValue } from "@/apps/workspace/modules/properties/framework/types";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { parseColorValue, serializeColorValue } from "@/apps/workspace/modules/properties/framework/utils/colorUtils";
import type { InspectorContext, UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { i18nStore } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import {
    normalizeUIInputHintsProps,
    uiInputHintLabelProp,
    UI_INPUT_HINT_WORDS,
    type UIInputHintsProps,
    type UIInputHintWord,
} from "@shared/types/ui-editor/inputHints";

/** Always read through the live document: a schema closure can outlive the props it captured. */
function liveProps(data: UIInspectorData): UIInputHintsProps {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    return normalizeUIInputHintsProps(live.props);
}

function patch(data: UIInspectorData, partial: Record<string, unknown>): void {
    data.documentService.updateElementProps(data.element.id, partial);
}

const WORD_LABELS: Readonly<Record<UIInputHintWord, { label: TranslationKey; studio: TranslationKey }>> = {
    select: { label: "widgets.inputHints.wordSelect", studio: "game.inputHints.select" },
    confirm: { label: "widgets.inputHints.wordConfirm", studio: "game.inputHints.confirm" },
    back: { label: "widgets.inputHints.wordBack", studio: "game.inputHints.back" },
    advance: { label: "widgets.inputHints.wordAdvance", studio: "game.inputHints.advance" },
    stageControls: { label: "widgets.inputHints.wordStageControls", studio: "game.inputHints.stageControls" },
};

export function createInputHintsInspector(ctx: InspectorContext) {
    type D = UIInspectorData;
    const { t } = i18nStore.getTranslator();
    const { element } = ctx;
    const colour = (id: string, label: TranslationKey, read: (p: UIInputHintsProps) => string, prop: keyof UIInputHintsProps) =>
        defineField<D, any>({
            id,
            type: "colorPicker",
            label: t(label),
            displayMode: "icon-hex",
            allowOpacity: true,
            brandPalette: true,
            getValue: (d: D) => parseColorValue(read(liveProps(d)), { hex: "#FFFFFF", alpha: 1 }),
            setValue: (d: D, value: ColorValue) => patch(d, { [prop]: serializeColorValue(value) }),
        });

    return createPropertyEditorSchema<D>({
        id: `ui-inspector:nl.inputHints:${element.id}`,
        title: element.name ?? t("widgets.inputHints.title"),
        fields: [],
        tabs: [
            {
                id: "properties",
                title: t("widgets.tabs.properties"),
                fields: [
                    defineField<D, any>({
                        id: "section.inputHintsContent",
                        type: "section",
                        title: t("widgets.inputHints.sectionContent"),
                        fields: [
                            defineField<D, any>({
                                id: "inputHints.showFor",
                                type: "select",
                                label: t("widgets.inputHints.showFor"),
                                tip: t("widgets.inputHints.showForTip"),
                                options: [
                                    { value: "keysAndGamepad", label: t("widgets.inputHints.showForKeysAndGamepad") },
                                    { value: "gamepad", label: t("widgets.inputHints.showForGamepad") },
                                    { value: "always", label: t("widgets.inputHints.showForAlways") },
                                ],
                                getValue: (d: D) => liveProps(d).showFor,
                                setValue: (d: D, value: string | number) => patch(d, { showFor: String(value) }),
                            }),
                            defineField<D, any>({
                                id: "inputHints.glyphStyle",
                                type: "select",
                                label: t("widgets.inputHints.glyphStyle"),
                                options: [
                                    { value: "auto", label: t("widgets.inputHints.glyphAuto") },
                                    { value: "xbox", label: t("widgets.inputHints.glyphXbox") },
                                    { value: "playstation", label: t("widgets.inputHints.glyphPlayStation") },
                                    { value: "nintendo", label: t("widgets.inputHints.glyphNintendo") },
                                ],
                                getValue: (d: D) => liveProps(d).glyphStyle,
                                setValue: (d: D, value: string | number) => patch(d, { glyphStyle: String(value) }),
                            }),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.inputHintsStyle",
                        type: "section",
                        title: t("widgets.inputHints.sectionStyle"),
                        fields: [
                            defineField<D, any>({
                                id: "inputHints.align",
                                type: "select",
                                label: t("widgets.inputHints.align"),
                                options: [
                                    { value: "start", label: t("widgets.inputHints.alignStart") },
                                    { value: "center", label: t("widgets.inputHints.alignCenter") },
                                    { value: "end", label: t("widgets.inputHints.alignEnd") },
                                ],
                                getValue: (d: D) => liveProps(d).align,
                                setValue: (d: D, value: string | number) => patch(d, { align: String(value) }),
                            }),
                            defineField<D, any>({
                                id: "inputHints.fontSize",
                                type: "number",
                                label: t("widgets.inputHints.fontSize"),
                                min: 6,
                                max: 200,
                                step: 1,
                                getValue: (d: D) => liveProps(d).fontSize,
                                setValue: (d: D, value: number) => patch(d, { fontSize: value }),
                            }),
                            defineField<D, any>({
                                id: "inputHints.gap",
                                type: "number",
                                label: t("widgets.inputHints.gap"),
                                min: 0,
                                max: 400,
                                step: 1,
                                getValue: (d: D) => liveProps(d).gap,
                                setValue: (d: D, value: number) => patch(d, { gap: value }),
                            }),
                            colour("inputHints.color", "widgets.inputHints.color", p => p.color, "color"),
                            colour("inputHints.glyphBackground", "widgets.inputHints.glyphBackground", p => p.glyphBackground, "glyphBackground"),
                            colour("inputHints.glyphColor", "widgets.inputHints.glyphColor", p => p.glyphColor, "glyphColor"),
                        ],
                    }),
                    defineField<D, any>({
                        id: "section.inputHintsWords",
                        type: "section",
                        title: t("widgets.inputHints.sectionWords"),
                        collapsible: true,
                        defaultCollapsed: true,
                        fields: UI_INPUT_HINT_WORDS.map((word, index) => defineField<D, any>({
                            id: `inputHints.word.${word}`,
                            type: "text",
                            label: t(WORD_LABELS[word].label),
                            ...(index === 0 ? { tip: t("widgets.inputHints.wordsTip") } : {}),
                            // Studio's own word, which the bar shows while this is empty.
                            placeholder: t(WORD_LABELS[word].studio),
                            maxLength: 60,
                            getValue: (d: D) => {
                                const own = (liveProps(d) as Record<string, unknown>)[uiInputHintLabelProp(word)];
                                return typeof own === "string" ? own : "";
                            },
                            setValue: (d: D, value: string) => patch(d, { [uiInputHintLabelProp(word)]: value }),
                        })),
                    }),
                ],
            },
        ],
    });
}
