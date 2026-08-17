import {
  useLayoutEffect,
  type ReactElement,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Baseline,
  Italic,
  Type,
} from "lucide-react";
import type { AppearanceModel, AppearanceRowValue, TextAppearancePropertyKey } from "@shared/types/ui-editor/appearance";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import { createLocalizationKeyField } from "@/lib/ui-editor/widget-modules/shared/LocalizationKeyField";
import type {
  CustomFieldProps,
  IconButtonSelection,
  InlineRowItemContext,
} from "@/apps/workspace/modules/properties/framework/types";
import { DraftTextInput } from "@/lib/components/inputs/DraftTextInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { AppearanceAuthoringPanel } from "@/lib/ui-editor/widget-modules/shared/appearance/AppearanceAuthoringPanel";
import {
  createInitialTextAppearance,
  ensureTextAppearanceHasAllKeys,
  isUsableAppearanceModel,
  patchTextAppearanceDefaultRows,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { createBlueprintValueField } from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintValueField";
import { i18nStore, translate } from "@/lib/i18n";
import {
  TATE_CHU_YOKO_MAX_LENGTH_LIMIT,
  isVerticalWritingMode,
} from "@/lib/ui-editor/widget-modules/shared/text/verticalTypography";
import { getTextProps } from "./helpers";
import type {
  TextAlign,
  TextOrientation,
  TextVerticalAlign,
  TextWidgetProps,
  TextWrapMode,
  TextWritingMode,
} from "./types";

function textAppearanceRowsForPatch(
  next: TextWidgetProps,
  patch: Partial<TextWidgetProps>
): Partial<Record<TextAppearancePropertyKey, AppearanceRowValue>> {
  const rows: Partial<Record<TextAppearancePropertyKey, AppearanceRowValue>> = {};
  if ("fontAssetId" in patch) rows.fontAssetId = next.fontAssetId ?? null;
  if ("fontSize" in patch) rows.fontSize = next.fontSize;
  if ("fontWeight" in patch) rows.fontWeight = next.fontWeight;
  if ("fontStyle" in patch) rows.fontStyle = next.fontStyle;
  if ("color" in patch) rows.color = next.color;
  if ("lineHeight" in patch) rows.lineHeight = next.lineHeight;
  if ("transformOffsetX" in patch) rows.transformOffsetX = next.transformOffsetX;
  if ("transformOffsetY" in patch) rows.transformOffsetY = next.transformOffsetY;
  if ("transformScale" in patch) rows.transformScale = next.transformScale;
  if ("transformRotation" in patch) rows.transformRotation = next.transformRotation;
  if ("transformOpacity" in patch) rows.transformOpacity = next.transformOpacity;
  if ("effects" in patch) {
    rows.effectBlur = next.effects.effectBlur;
    rows.effectTextShadow = next.effects.effectTextShadow;
    rows.effectBlend = next.effects.effectBlend;
    rows.effectFilter = next.effects.effectFilter;
  }
  return rows;
}

function patchTextPropsWithAppearance(data: UIInspectorData, patch: Partial<TextWidgetProps>) {
  const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
  const flat = getTextProps(live);
  const nextFlat: TextWidgetProps = {
    ...flat,
    ...patch,
    effects: patch.effects ?? flat.effects,
  };
  const rawAppearance = (live.props as { appearance?: unknown } | undefined)?.appearance;
  const baseAppearance: AppearanceModel | null = isAppearanceModel(rawAppearance) ? rawAppearance : null;
  const rows = textAppearanceRowsForPatch(nextFlat, patch);
  const hasAppearanceRows = Object.keys(rows).length > 0;
  let nextAppearance: AppearanceModel | null = baseAppearance;
  if (hasAppearanceRows) {
    const ensured = isUsableAppearanceModel(baseAppearance)
      ? ensureTextAppearanceHasAllKeys(baseAppearance, nextFlat)
      : createInitialTextAppearance(nextFlat);
    nextAppearance = patchTextAppearanceDefaultRows(ensured, rows);
  }
  data.documentService.updateElementProps(live.id, {
    ...live.props,
    ...patch,
    ...(nextAppearance ? { appearance: nextAppearance } : {}),
  });
}

function TextAppearanceField(props: CustomFieldProps<UIInspectorData>) {
  const flat = getTextProps(props.data.element);
  const rawAppearance = (props.data.element.props as { appearance?: unknown } | undefined)?.appearance;
  const appearance: AppearanceModel | null = isAppearanceModel(rawAppearance) ? rawAppearance : null;
  const { documentService } = props.data;
  const element = props.data.element;

  // Deferred while read-only - see `ContainerAppearanceField` for why this key-filling pass must not
  // run inside a frozen project. This one also CREATES the model when a text element predates it,
  // which made selecting any such element on a frozen workspace look like a save failure.
  useLayoutEffect(() => {
    if (props.readOnly) {
      return;
    }
    const f = getTextProps(element);
    const next = isUsableAppearanceModel(appearance)
      ? ensureTextAppearanceHasAllKeys(appearance, f)
      : createInitialTextAppearance(f);
    if (next !== appearance) {
      documentService.updateElementProps(element.id, {
        appearance: next,
      });
    }
  }, [appearance, documentService, element, props.readOnly]);

  const panelAppearance = isUsableAppearanceModel(appearance) ? appearance : createInitialTextAppearance(flat);

  return (
    <AppearanceAuthoringPanel
      key={element.id}
      kind="text"
      appearance={panelAppearance}
      onReplace={next => {
        documentService.updateElementProps(element.id, {
          appearance: next,
        });
      }}
      inspectorData={props.data}
      draftResetKey={element.id}
      readOnly={props.readOnly}
    />
  );
}

const TextLocalizationKeyField = createLocalizationKeyField({
  getKey: element => getTextProps(element).localizationKey ?? "",
  setKey: (data, value) => {
    const live = data.documentService.getDocument().elements[data.element.id] ?? data.element;
    data.documentService.updateElementProps(live.id, { localizationKey: value });
  },
});

const TextBlueprintValueField = createBlueprintValueField({
  propPath: "text",
  valueType: "string",
  valueLabel: "text",
  title: "widgets.blueprintValue.textTitle",
  getDisplayName: ({ liveElement }) =>
    translate("widgets.blueprintValue.nameText", {
      name: liveElement.name ?? translate("widgets.defaults.text.name"),
    }),
  getLiteralValue: ({ liveElement }) => getTextProps(liveElement).text,
  renderLiteralEditor: ({ data, liveElement }) => {
    const textProps = getTextProps(liveElement);
    return (
      <DraftTextInput
        multiline
        className="min-h-[88px] w-full resize-y rounded-md border border-edge bg-surface-sunken px-2 py-1.5 text-xs text-fg outline-none focus:border-primary/70 focus:ring-1 focus:ring-primary/40"
        value={textProps.text}
        rows={4}
        draftResetKey={liveElement.id}
        readCommittedValue={() =>
          getTextProps(data.documentService.getDocument().elements[liveElement.id] ?? liveElement).text
        }
        onCommit={next => {
          data.documentService.updateElementProps(liveElement.id, { text: next });
        }}
      />
    );
  },
});

type Translator = ReturnType<typeof i18nStore.getTranslator>["t"];

type AlignOption = { id: string; icon: ReactElement; label: string };

const iconFor = (Icon: typeof AlignLeft) => <Icon className="w-4 h-4" />;

/**
 * Icons for the inline axis, which turns with the writing mode.
 *
 * The stored values never change - `left` is still `text-align: left` - but in a vertical box CSS
 * resolves that to the top of the column, so the row keeps showing the author where the text will
 * actually sit rather than what the property is called.
 */
function inlineAlignOptions(writingMode: TextWritingMode, t: Translator): AlignOption[] {
  if (!isVerticalWritingMode(writingMode)) {
    return [
      { id: "left", icon: iconFor(AlignLeft), label: t("widgets.typography.alignLeft") },
      { id: "center", icon: iconFor(AlignCenter), label: t("widgets.typography.alignCenter") },
      { id: "right", icon: iconFor(AlignRight), label: t("widgets.typography.alignRight") },
    ];
  }
  return [
    { id: "left", icon: iconFor(AlignVerticalJustifyStart), label: t("widgets.typography.alignTop") },
    { id: "center", icon: iconFor(AlignVerticalJustifyCenter), label: t("widgets.typography.alignMiddle") },
    { id: "right", icon: iconFor(AlignVerticalJustifyEnd), label: t("widgets.typography.alignBottom") },
  ];
}

/** Icons for the block axis: top to bottom horizontally, and along the columns once vertical. */
function blockAlignOptions(writingMode: TextWritingMode, t: Translator): AlignOption[] {
  if (!isVerticalWritingMode(writingMode)) {
    return [
      { id: "start", icon: iconFor(AlignVerticalJustifyStart), label: t("widgets.typography.alignTop") },
      { id: "center", icon: iconFor(AlignVerticalJustifyCenter), label: t("widgets.typography.alignMiddle") },
      { id: "end", icon: iconFor(AlignVerticalJustifyEnd), label: t("widgets.typography.alignBottom") },
    ];
  }
  const startsRight = writingMode === "vertical-rl";
  return [
    {
      id: "start",
      icon: iconFor(startsRight ? AlignRight : AlignLeft),
      label: startsRight ? t("widgets.typography.alignRight") : t("widgets.typography.alignLeft"),
    },
    { id: "center", icon: iconFor(AlignCenter), label: t("widgets.typography.alignCenter") },
    {
      id: "end",
      icon: iconFor(startsRight ? AlignLeft : AlignRight),
      label: startsRight ? t("widgets.typography.alignLeft") : t("widgets.typography.alignRight"),
    },
  ];
}

/** Tate-chu-yoko has nothing to do while the box is horizontal or every glyph is already sideways. */
function supportsTateChuYoko(props: TextWidgetProps): boolean {
  return isVerticalWritingMode(props.writingMode) && props.textOrientation !== "sideways";
}

export function createTextInspector(ctx: InspectorContext) {
  type D = UIInspectorData;
  const { t } = i18nStore.getTranslator();
  const { element, documentService } = ctx;
  const writingMode = getTextProps(element).writingMode;

  const patchProps = (patch: Partial<TextWidgetProps>) => {
    const liveElement = documentService.getDocument().elements[element.id] ?? element;
    patchTextPropsWithAppearance(
      {
        element: liveElement,
        elements: Object.values(documentService.getDocument().elements),
        documentService,
      },
      patch
    );
  };

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:nl.text:${element.id}`,
    title: element.name ?? t("widgets.text.title"),
    fields: [],
    tabs: [
      {
        id: "properties",
        title: t("widgets.tabs.properties"),
        fields: [
          defineField<D, any>({
            id: "section.content",
            type: "section",
            title: t("widgets.content"),
            fields: [
              defineField<D, any>({
                id: "text.content",
                type: "custom",
                label: t("widgets.textLabel"),
                component: TextBlueprintValueField,
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.localization",
            type: "section",
            title: t("widgets.localization.title"),
            collapsible: true,
            defaultCollapsed: true,
            fields: [
              defineField<D, any>({
                id: "text.localizable",
                type: "checkbox",
                label: t("widgets.text.localizeText"),
                getValue: (d: D) => Boolean(getTextProps(d.element).localizable),
                setValue: (_d: D, value: boolean) => patchProps({ localizable: value }),
              }),
              defineField<D, any>({
                id: "text.localizationKey",
                type: "custom",
                label: t("widgets.localization.textKey"),
                component: TextLocalizationKeyField,
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.typography",
            type: "section",
            title: t("widgets.typography.title"),
            fields: [
              defineField<D, any>({
                id: "text.fontAsset",
                type: "fontAsset",
                label: t("widgets.typography.font"),
                getValue: (d: D) => getTextProps(d.element).fontAssetId,
                setValue: (_d: D, value: string | null) => {
                  patchProps({ fontAssetId: value });
                },
              }),
              defineField<D, any>({
                id: "text.typographyRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                items: [
                  {
                    id: "text.fontSize",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getTextProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.fontSize)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            onSaving(true);
                            try {
                              patchProps({ fontSize: Math.min(256, Math.max(8, v)) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={8}
                          max={256}
                          unit="px"
                          leftIcon={<Type className="w-4 h-4 text-fg-muted" />}
                        />
                      );
                    },
                  },
                  {
                    id: "text.lineHeight",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getTextProps(data.element);
                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.lineHeight)}
                          draftResetKey={element.id}
                          onFiniteNumber={(v) => {
                            if (v <= 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patchProps({ lineHeight: Math.min(4, Math.max(0.8, v)) });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="decimal"
                          type="number"
                          min={0.8}
                          max={4}
                          step={0.05}
                          leftIcon={<Baseline className="w-4 h-4 text-fg-muted" />}
                          data-tip={t("widgets.typography.lineHeightHint")}
                        />
                      );
                    },
                  },
                  {
                    id: "text.fontStyle",
                    className: "shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = getTextProps(data.element);
                      const isItalic = current.fontStyle === "italic";
                      return (
                        <button
                          type="button"
                          className={[
                            "flex h-9 min-h-[34px] w-9 items-center justify-center rounded-md border border-edge transition",
                            isItalic
                              ? "bg-fill text-fg"
                              : "bg-surface-raised text-fg-muted hover:bg-fill hover:text-fg",
                          ].join(" ")}
                          aria-label={isItalic ? t("widgets.typography.disableItalic") : t("widgets.typography.enableItalic")}
                          aria-pressed={isItalic}
                          data-tip={t("widgets.typography.italic")}
                          onClick={() => {
                            onSaving(true);
                            try {
                              patchProps({ fontStyle: isItalic ? "normal" : "italic" });
                            } finally {
                              onSaving(false);
                            }
                          }}
                        >
                          <Italic className="h-4 w-4" />
                        </button>
                      );
                    },
                  },
                ],
              }),
              defineField<D, any>({
                id: "text.weight",
                type: "select",
                label: t("widgets.typography.weight"),
                options: [
                  { value: "normal", label: t("widgets.typography.regular") },
                  { value: "600", label: t("widgets.typography.semibold") },
                  { value: "bold", label: t("widgets.typography.bold") },
                ],
                getValue: (d: D) => getTextProps(d.element).fontWeight,
                setValue: (_d: D, v: string | number) => {
                  patchProps({
                    fontWeight: v as TextWidgetProps["fontWeight"],
                  });
                },
              }),
              defineField<D, any>({
                id: "text.wrapMode",
                type: "select",
                label: t("widgets.typography.lineWrap"),
                options: [
                  { value: "word", label: t("widgets.typography.wrapWords") },
                  { value: "character", label: t("widgets.typography.wrapCharacters") },
                  { value: "nowrap", label: t("widgets.typography.wrapNone") },
                ],
                getValue: (d: D) => getTextProps(d.element).textWrapMode,
                setValue: (_d: D, v: string | number) => {
                  patchProps({ textWrapMode: String(v) as TextWrapMode });
                },
              }),
              defineField<D, any>({
                id: "text.align",
                type: "iconButtonGroup",
                mode: "single",
                label: t("widgets.typography.alignment"),
                showLabels: false,
                options: inlineAlignOptions(writingMode, t),
                getValue: (d: D) => getTextProps(d.element).textAlign,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patchProps({ textAlign: value as TextAlign });
                },
              }),
              defineField<D, any>({
                id: "text.verticalAlign",
                type: "iconButtonGroup",
                mode: "single",
                label: t("widgets.typography.verticalAlignment"),
                showLabels: false,
                options: blockAlignOptions(writingMode, t),
                getValue: (d: D) => getTextProps(d.element).textVerticalAlign,
                setValue: (_d: D, value: IconButtonSelection) => {
                  if (typeof value !== "string") return;
                  patchProps({ textVerticalAlign: value as TextVerticalAlign });
                },
              }),
              defineField<D, any>({
                id: "text.writingMode",
                type: "select",
                label: t("widgets.typography.writingMode"),
                options: [
                  { value: "horizontal-tb", label: t("widgets.typography.writingHorizontal") },
                  { value: "vertical-rl", label: t("widgets.typography.writingVerticalRl") },
                  { value: "vertical-lr", label: t("widgets.typography.writingVerticalLr") },
                ],
                getValue: (d: D) => getTextProps(d.element).writingMode,
                setValue: (_d: D, v: string | number) => {
                  patchProps({ writingMode: String(v) as TextWritingMode });
                },
              }),
              defineField<D, any>({
                id: "text.textOrientation",
                type: "select",
                label: t("widgets.typography.glyphOrientation"),
                // Every vertical-only control reads the live element rather than the schema-time
                // one: the panel rebuilds this schema on each document revision, so the row appears
                // the moment the mode dropdown above it changes.
                hidden: (d: D) => !isVerticalWritingMode(getTextProps(d.element).writingMode),
                options: [
                  { value: "mixed", label: t("widgets.typography.orientationMixed") },
                  { value: "upright", label: t("widgets.typography.orientationUpright") },
                  { value: "sideways", label: t("widgets.typography.orientationSideways") },
                ],
                getValue: (d: D) => getTextProps(d.element).textOrientation,
                setValue: (_d: D, v: string | number) => {
                  patchProps({ textOrientation: String(v) as TextOrientation });
                },
              }),
              defineField<D, any>({
                id: "text.tateChuYoko",
                type: "checkbox",
                label: t("widgets.typography.tateChuYoko"),
                helpText: t("widgets.typography.tateChuYokoHint"),
                hidden: (d: D) => !supportsTateChuYoko(getTextProps(d.element)),
                getValue: (d: D) => getTextProps(d.element).tateChuYoko,
                setValue: (_d: D, value: boolean) => patchProps({ tateChuYoko: value }),
              }),
              defineField<D, any>({
                id: "text.tateChuYokoMaxLength",
                type: "number",
                label: t("widgets.typography.tateChuYokoMaxLength"),
                min: 1,
                max: TATE_CHU_YOKO_MAX_LENGTH_LIMIT,
                step: 1,
                hidden: (d: D) => {
                  const props = getTextProps(d.element);
                  return !supportsTateChuYoko(props) || !props.tateChuYoko;
                },
                getValue: (d: D) => getTextProps(d.element).tateChuYokoMaxLength,
                setValue: (_d: D, value: number) => {
                  if (!Number.isFinite(value)) return;
                  patchProps({
                    tateChuYokoMaxLength: Math.min(TATE_CHU_YOKO_MAX_LENGTH_LIMIT, Math.max(1, Math.round(value))),
                  });
                },
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.appearanceAuthoring",
            type: "section",
            title: t("widgets.appearance.title"),
            collapsible: true,
            defaultCollapsed: false,
            helpText: t("widgets.appearance.modulesHelp"),
            fields: [
              defineField<D, any>({
                id: "text.appearance.panel",
                type: "custom",
                component: TextAppearanceField,
              }),
            ],
          }),
        ],
      },
      {
        id: "interaction",
        title: t("widgets.tabs.interaction"),
        fields: [
          defineField<D, any>({
            id: "interaction.blueprint.readonly",
            type: "custom",
            label: t("widgets.blueprint.controlLabel"),
            component: ReadonlyBlueprintSection,
          }),
        ],
      },
    ],
  });
}
