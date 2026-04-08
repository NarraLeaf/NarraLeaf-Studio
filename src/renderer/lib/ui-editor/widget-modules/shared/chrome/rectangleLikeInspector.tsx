import {
  Droplets,
  Eye,
  EyeOff,
  Maximize2,
  Square,
} from "lucide-react";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { Select } from "@/lib/components/elements/Select";
import { ColorPickerTrigger } from "@/apps/workspace/modules/properties/framework/fields/ColorPickerField";
import { createPropertyEditorSchema, defineField } from "@/apps/workspace/modules/properties/framework";
import type { ColorValue, InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIInspectorData, InspectorContext, WidgetRendererProps } from "@/lib/ui-editor/widget-modules/types";
import type { RectangleLikeProps, StrokeJoin } from "@shared/types/ui-editor/rectangleLike";
import { ReadonlyBlueprintSection } from "@/lib/ui-editor/widget-modules/shared/blueprint/ReadonlyBlueprintSection";
import { getRectangleLikeProps, normalizeImageFill } from "./rectangleHelpers";
import {
  BORDER_STYLE_OPTIONS,
  controlButtonClass,
  CornerIcon,
  FILL_TYPE_OPTIONS,
  STROKE_ALIGN_OPTIONS,
  STROKE_JOIN_OPTIONS,
  STROKE_SIDE_OPTIONS,
} from "./constants";
import { InlineMenuTriggerButton } from "./InlineMenuTriggerButton";

export type RectangleInspectorOptions = {
  /** Resolve widget props (e.g. nl.image legacy merge). Defaults to rectangle-like getProps. */
  getProps?: (element: UIElement) => RectangleLikeProps;
  titleFallback?: string;
  /** Schema id segment after `ui-inspector:` (default nl.container for shared chrome). */
  schemaTypeKey?: string;
  /** Inserted before chrome sections (e.g. `nl.container` layout mode). */
  leadingPropertyFields?: unknown[];
};

export function createRectangleInspector(ctx: InspectorContext, options?: RectangleInspectorOptions) {
  const { element, documentService } = ctx;
  const resolveProps = options?.getProps ?? getRectangleLikeProps;
  const titleFallback = options?.titleFallback ?? "Container";
  const schemaTypeKey = options?.schemaTypeKey ?? "nl.container";

  const patchProps = (patch: Partial<RectangleLikeProps>) => {
    documentService.updateElementProps(element.id, {
      ...element.props,
      ...patch,
    });
  };

  const patchLayout = (patch: Partial<WidgetRendererProps["element"]["layout"]>) => {
    documentService.updateElementLayout(element.id, patch);
  };

  const formatPercentDisplay = (value: number) => String(Math.round(value * 10000) / 100);

  const buildStrokeMenu = (props: RectangleLikeProps): ContextMenuDef => [
    {
      id: "stroke-style",
      label: "Border Style",
      submenu: BORDER_STYLE_OPTIONS.map(option => ({
        id: `stroke-style-${option.value}`,
        label: option.label,
        icon: option.icon,
        onClick: () => patchProps({ borderStyle: option.value }),
      })),
    },
    {
      separator: true,
      id: "stroke-style-separator",
    },
    {
      id: "stroke-join",
      label: "Corner Join",
      submenu: STROKE_JOIN_OPTIONS.map(option => ({
        id: `stroke-join-${option.value}`,
        label: option.label,
        onClick: () =>
          patchProps({
            borderJoin: option.value as StrokeJoin,
          }),
      })),
    },
  ];

  type D = UIInspectorData;

  return createPropertyEditorSchema<D>({
    id: `ui-inspector:${schemaTypeKey}:${element.id}`,
    title: element.name ?? titleFallback,
    fields: [],
    tabs: [
      {
        id: "properties",
        title: "Properties",
        fields: [
          ...((options?.leadingPropertyFields ?? []) as ReturnType<typeof defineField<D, any>>[]),
          defineField<D, any>({
            id: "section.cornerRadius",
            type: "section",
            title: "Corner Radius",
            fields: [
              defineField<D, any>({
                id: "props.cornerRadiusInline",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                className: "min-w-0",
                label: undefined,
                items: [
                  {
                    id: "props.cornerRadiusValue",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      const allCornersEqual =
                        current.borderRadiusTL === current.borderRadiusTR &&
                        current.borderRadiusTL === current.borderRadiusBL &&
                        current.borderRadiusTL === current.borderRadiusBR;
                      const showUniformPlaceholder =
                        current.cornerAdvanced && !allCornersEqual;
                      const uniformValue = showUniformPlaceholder
                        ? ""
                        : String(
                          current.cornerAdvanced ? current.borderRadiusTL : current.borderRadius
                        );
                      const uniformPlaceholder = showUniformPlaceholder ? "-" : undefined;

                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={uniformValue}
                          draftResetKey={element.id}
                          onFiniteNumber={(radius) => {
                            onSaving(true);
                            try {
                              const patch: Partial<RectangleLikeProps> = {
                                borderRadius: radius,
                              };
                              if (current.borderRadiusLinked) {
                                patch.borderRadiusTL = radius;
                                patch.borderRadiusTR = radius;
                                patch.borderRadiusBL = radius;
                                patch.borderRadiusBR = radius;
                              }
                              patchProps(patch);
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          unit="px"
                          precision={2}
                          leftIcon={<CornerIcon position="tl" />}
                          className="w-full min-w-0"
                          placeholder={uniformPlaceholder}
                          selectAllOnFocus
                        />
                      );
                    },
                  },
                  {
                    id: "props.cornerRadiusToggle",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      const toggle = () => {
                        onSaving(true);
                        try {
                          const next = !current.cornerAdvanced;
                          const patch: Partial<RectangleLikeProps> = {
                            cornerAdvanced: next,
                            borderRadiusLinked: !next,
                          };
                          if (!next) {
                            const uniform = current.borderRadiusTL;
                            patch.borderRadius = uniform;
                            patch.borderRadiusTR = uniform;
                            patch.borderRadiusBL = uniform;
                            patch.borderRadiusBR = uniform;
                          }
                          patchProps(patch);
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <button
                          type="button"
                          onClick={toggle}
                          aria-pressed={current.cornerAdvanced}
                          aria-label="Toggle corner breakdown"
                          className={controlButtonClass(current.cornerAdvanced)}
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      );
                    },
                  },
                ],
              }),
              defineField<D, any>({
                id: "props.cornerRadiusTopRow",
                type: "inputGroup",
                gap: 8,
                wrap: false,
                className: "mt-3",
                label: undefined,
                hidden: (data: D) => !resolveProps(data.element).cornerAdvanced,
                inputs: [
                  {
                    id: "props.borderRadiusTL",
                    label: "TL",
                    icon: <CornerIcon position="tl" />,
                    selectAllOnFocus: true,
                    getValue: (data: D) => String(resolveProps(data.element).borderRadiusTL),
                    setValue: (_data: D, raw: string) => {
                      const value = Number.parseFloat(raw);
                      if (!Number.isFinite(value)) return;
                      patchProps({ borderRadiusTL: value });
                    },
                  },
                  {
                    id: "props.borderRadiusTR",
                    label: "TR",
                    icon: <CornerIcon position="tr" />,
                    selectAllOnFocus: true,
                    getValue: (data: D) => String(resolveProps(data.element).borderRadiusTR),
                    setValue: (_data: D, raw: string) => {
                      const value = Number.parseFloat(raw);
                      if (!Number.isFinite(value)) return;
                      patchProps({ borderRadiusTR: value });
                    },
                  },
                ],
              }),
              defineField<D, any>({
                id: "props.cornerRadiusBottomRow",
                type: "inputGroup",
                gap: 8,
                wrap: false,
                className: "mt-2",
                label: undefined,
                hidden: (data: D) => !resolveProps(data.element).cornerAdvanced,
                inputs: [
                  {
                    id: "props.borderRadiusBL",
                    label: "BL",
                    icon: <CornerIcon position="bl" />,
                    selectAllOnFocus: true,
                    getValue: (data: D) => String(resolveProps(data.element).borderRadiusBL),
                    setValue: (_data: D, raw: string) => {
                      const value = Number.parseFloat(raw);
                      if (!Number.isFinite(value)) return;
                      patchProps({ borderRadiusBL: value });
                    },
                  },
                  {
                    id: "props.borderRadiusBR",
                    label: "BR",
                    icon: <CornerIcon position="br" />,
                    selectAllOnFocus: true,
                    getValue: (data: D) => String(resolveProps(data.element).borderRadiusBR),
                    setValue: (_data: D, raw: string) => {
                      const value = Number.parseFloat(raw);
                      if (!Number.isFinite(value)) return;
                      patchProps({ borderRadiusBR: value });
                    },
                  },
                ],
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.layer",
            type: "section",
            title: "Layer",
            fields: [
              defineField<D, any>({
                id: "layout.layerControls",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                label: undefined,
                items: [
                  {
                    id: "layout.layerOpacity",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const percent = formatPercentDisplay(data.elements[0]?.layout.opacity ?? 1);

                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={percent}
                          draftResetKey={element.id}
                          onFiniteNumber={(value) => {
                            const clamped = Math.min(100, Math.max(0, value));
                            onSaving(true);
                            try {
                              patchLayout({ opacity: clamped / 100 });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="decimal"
                          unit="%"
                          min={0}
                          max={100}
                          precision={null}
                          leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                          className="w-full min-w-0"
                        />
                      );
                    },
                  },
                  {
                    id: "layout.layerVisible",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const visible = data.elements[0]?.layout.visible ?? true;
                      const toggle = () => {
                        onSaving(true);
                        try {
                          patchLayout({ visible: !visible });
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <button
                          type="button"
                          onClick={toggle}
                          aria-label="Toggle layer visibility"
                          aria-pressed={visible}
                          className={controlButtonClass(visible)}
                        >
                          {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                      );
                    },
                  },
                ],
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.fill",
            type: "section",
            title: "Fill",
            fields: [
              defineField<D, any>({
                id: "props.fillType",
                type: "select",
                label: "Fill Type",
                options: FILL_TYPE_OPTIONS,
                getValue: (data: D) => resolveProps(data.element).fillType,
                setValue: (_data: D, value: string | number) =>
                  patchProps({
                    fillType: String(value) as RectangleLikeProps["fillType"],
                  }),
              }),
              defineField<D, any>({
                id: "props.fillColorRow",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                hidden: (data: D) => resolveProps(data.element).fillType !== "color",
                items: [
                  {
                    id: "props.fillColorPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      const handleColor = (next: ColorValue) => {
                        onSaving(true);
                        try {
                          patchProps({
                            backgroundColor: next.hex,
                            fillOpacity: next.alpha ?? current.fillOpacity,
                          });
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <ColorPickerTrigger
                          value={{
                            hex: current.backgroundColor,
                            alpha: current.fillOpacity,
                          }}
                          displayMode="icon"
                          allowOpacity={false}
                          onChange={handleColor}
                        />
                      );
                    },
                  },
                  {
                    id: "props.fillOpacityRow",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const percent = formatPercentDisplay(resolveProps(data.element).fillOpacity);

                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={percent}
                          draftResetKey={element.id}
                          onFiniteNumber={(value) => {
                            const clamped = Math.min(100, Math.max(0, value));
                            onSaving(true);
                            try {
                              patchProps({
                                fillOpacity: clamped / 100,
                              });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="decimal"
                          unit="%"
                          min={0}
                          max={100}
                          precision={null}
                          leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                        />
                      );
                    },
                  },
                  {
                    id: "props.fillVisibleToggle",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const visible = resolveProps(data.element).fillVisible;
                      const toggle = () => {
                        onSaving(true);
                        try {
                          patchProps({
                            fillVisible: !visible,
                          });
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <button
                          type="button"
                          onClick={toggle}
                          aria-pressed={visible}
                          aria-label="Toggle fill visibility"
                          className={controlButtonClass(visible)}
                        >
                          {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                      );
                    },
                  },
                ],
              }),
              defineField<D, any>({
                id: "props.imageFill",
                type: "imageFill",
                label: "Image Fill",
                hidden: (data: D) => resolveProps(data.element).fillType !== "image",
                getValue: (data: D) => normalizeImageFill(resolveProps(data.element)),
                setValue: (_data: D, value: RectangleLikeProps["imageFill"]) =>
                  patchProps({
                    fillType: "image",
                    imageFill: value,
                  }),
              }),
              defineField<D, any>({
                id: "props.fillImageControls",
                type: "inlineRow",
                gap: 8,
                wrap: true,
                label: undefined,
                hidden: (data: D) => resolveProps(data.element).fillType !== "image",
                items: [
                  {
                    id: "props.fillImageOpacity",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const percent = formatPercentDisplay(resolveProps(data.element).fillOpacity);

                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={percent}
                          draftResetKey={element.id}
                          onFiniteNumber={(value) => {
                            const clamped = Math.min(100, Math.max(0, value));
                            onSaving(true);
                            try {
                              patchProps({
                                fillOpacity: clamped / 100,
                              });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="decimal"
                          unit="%"
                          min={0}
                          max={100}
                          precision={null}
                          leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                        />
                      );
                    },
                  },
                  {
                    id: "props.fillImageVisible",
                    className: "flex-1 min-w-[7.5rem] max-w-[9rem]",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const visible = resolveProps(data.element).fillVisible;
                      const toggle = () => {
                        onSaving(true);
                        try {
                          patchProps({
                            fillVisible: !visible,
                          });
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <button
                          type="button"
                          onClick={toggle}
                          aria-pressed={visible}
                          aria-label="Toggle fill visibility"
                          className={controlButtonClass(visible)}
                        >
                          {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                      );
                    },
                  },
                ],
              }),
            ],
          }),
          defineField<D, any>({
            id: "section.stroke",
            type: "section",
            title: "Stroke",
            fields: [
              defineField<D, any>({
                id: "props.strokeControls",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                className: "min-w-0",
                label: undefined,
                items: [
                  {
                    id: "props.strokeAlign",
                    className: "flex-1 min-w-0",
                    render: ({ data }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      return (
                        <Select
                          value={current.strokeAlign}
                          options={STROKE_ALIGN_OPTIONS}
                          fullWidth
                          onChange={(value) =>
                            patchProps({
                              strokeAlign: String(value) as RectangleLikeProps["strokeAlign"],
                            })
                          }
                        />
                      );
                    },
                  },
                  {
                    id: "props.strokeWidth",
                    className: "min-w-0 basis-28 shrink grow-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);

                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={String(current.borderWidth)}
                          draftResetKey={element.id}
                          onFiniteNumber={(width) => {
                            if (width < 0) {
                              return;
                            }
                            onSaving(true);
                            try {
                              patchProps({ borderWidth: width });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="numeric"
                          type="number"
                          min={0}
                          unit="px"
                          precision={2}
                          leftIcon={<Square className="w-4 h-4 text-gray-400" />}
                          className="w-full min-w-0"
                        />
                      );
                    },
                  },
                  {
                    id: "props.strokeMore",
                    className: "flex-shrink-0",
                    render: ({ data }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      return (
                        <InlineMenuTriggerButton
                          menu={buildStrokeMenu(current)}
                          ariaLabel="Open stroke settings"
                          className="z-10"
                        />
                      );
                    },
                  },
                ],
              }),
              defineField<D, any>({
                id: "props.strokeSideGroup",
                type: "iconButtonGroup",
                label: "Stroke Side",
                showLabels: false,
                className: "mt-2",
                options: STROKE_SIDE_OPTIONS,
                getValue: (data: D) => resolveProps(data.element).strokeSide,
                setValue: (_data: D, value: string | number) => {
                  if (typeof value !== "string") return;
                  patchProps({
                    strokeSide: value as RectangleLikeProps["strokeSide"],
                  });
                },
              }),
              defineField<D, any>({
                id: "props.strokeColorRow",
                type: "inlineRow",
                gap: 8,
                wrap: false,
                className: "min-w-0",
                label: undefined,
                items: [
                  {
                    id: "props.strokeColorPicker",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      const strokeVisible = current.strokeVisible;
                      const handleChange = (next: ColorValue) => {
                        onSaving(true);
                        try {
                          patchProps({
                            borderColor: next.hex,
                          });
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <ColorPickerTrigger
                          value={{
                            hex: current.borderColor,
                            alpha: current.strokeOpacity,
                          }}
                          displayMode="icon"
                          allowOpacity={false}
                          disabled={!strokeVisible}
                          onChange={handleChange}
                        />
                      );
                    },
                  },
                  {
                    id: "props.strokeOpacity",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const current = resolveProps(data.element);
                      const strokeVisible = current.strokeVisible;
                      const percent = formatPercentDisplay(current.strokeOpacity);

                      return (
                        <NumericDraftEnhancedInput
                          committedDisplay={percent}
                          draftResetKey={element.id}
                          onFiniteNumber={(value) => {
                            const clamped = Math.min(100, Math.max(0, value));
                            onSaving(true);
                            try {
                              patchProps({
                                strokeOpacity: clamped / 100,
                              });
                            } finally {
                              onSaving(false);
                            }
                          }}
                          inputMode="decimal"
                          unit="%"
                          min={0}
                          max={100}
                          precision={null}
                          leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
                          disabled={!strokeVisible}
                          className="w-full min-w-0"
                        />
                      );
                    },
                  },
                  {
                    id: "props.strokeVisible",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                      const visible = resolveProps(data.element).strokeVisible;
                      const toggle = () => {
                        onSaving(true);
                        try {
                          patchProps({
                            strokeVisible: !visible,
                          });
                        } finally {
                          onSaving(false);
                        }
                      };

                      return (
                        <button
                          type="button"
                          onClick={toggle}
                          aria-pressed={visible}
                          aria-label="Toggle stroke visibility"
                          className={controlButtonClass(visible)}
                        >
                          {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                      );
                    },
                  },
                ],
              }),
            ],
          }),
        ],
      },
      {
        id: "interaction",
        title: "Interaction",
        fields: [
          defineField<D, any>({
            id: "section.blueprint",
            type: "section",
            title: "Blueprint",
            fields: [
              defineField<D, any>({
                id: "interaction.blueprint.deferred",
                type: "custom",
                component: ReadonlyBlueprintSection,
              }),
            ],
          }),
        ],
      },
    ],
  });
}
