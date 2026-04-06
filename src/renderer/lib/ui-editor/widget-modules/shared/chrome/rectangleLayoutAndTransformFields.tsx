import { Droplets, Eye, EyeOff, RotateCw } from "lucide-react";
import { defineField } from "@/apps/workspace/modules/properties/framework";
import type { InlineRowItemContext } from "@/apps/workspace/modules/properties/framework/types";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import type { UIInspectorData, InspectorContext } from "@/lib/ui-editor/widget-modules/types";
import { controlButtonClass } from "./constants";

type D = UIInspectorData;

/**
 * Layer (opacity, visibility) + Transform (rotation) fields shared by chrome widgets.
 * Does not include fill/stroke/corners (handled by appearance authoring).
 */
export function buildRectangleLayoutAndTransformFields(ctx: InspectorContext): unknown[] {
    const { element, documentService } = ctx;

    const patchLayout = (patch: Partial<UIInspectorData["element"]["layout"]>) => {
        documentService.updateElementLayout(element.id, patch);
    };

    const formatPercentDisplay = (value: number) => String(Math.round(value * 10000) / 100);

    return [
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
                                        onFiniteNumber={value => {
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
            id: "section.transform",
            type: "section",
            title: "Transform",
            fields: [
                defineField<D, any>({
                    id: "layout.rotationControls",
                    type: "inlineRow",
                    gap: 8,
                    wrap: false,
                    label: "Rotation",
                    items: [
                        {
                            id: "layout.rotationValue",
                            className: "flex-1 min-w-0",
                            render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                const layoutRotation = data.elements[0]?.layout.rotation;
                                const rotationValue = Number.isFinite(layoutRotation) ? layoutRotation : 0;

                                return (
                                    <NumericDraftEnhancedInput
                                        committedDisplay={String(rotationValue)}
                                        draftResetKey={element.id}
                                        onFiniteNumber={value => {
                                            const clamped = Math.min(360, Math.max(-360, value));
                                            onSaving(true);
                                            try {
                                                patchLayout({ rotation: clamped });
                                            } finally {
                                                onSaving(false);
                                            }
                                        }}
                                        inputMode="numeric"
                                        type="number"
                                        min={-360}
                                        max={360}
                                        unit="°"
                                        leftIcon={<RotateCw className="w-4 h-4 text-gray-400" />}
                                        className="w-full min-w-0"
                                        selectAllOnFocus
                                    />
                                );
                            },
                        },
                        {
                            id: "layout.rotationReset",
                            className: "flex-shrink-0",
                            render: ({ data, onSaving }: InlineRowItemContext<D>) => {
                                const layoutRotation = data.elements[0]?.layout.rotation;
                                const rotationValue = Number.isFinite(layoutRotation) ? layoutRotation : 0;
                                const reset = () => {
                                    if (!rotationValue) return;
                                    onSaving(true);
                                    try {
                                        patchLayout({ rotation: 0 });
                                    } finally {
                                        onSaving(false);
                                    }
                                };

                                return (
                                    <button
                                        type="button"
                                        onClick={reset}
                                        aria-label="Reset rotation"
                                        disabled={rotationValue === 0}
                                        className={controlButtonClass(rotationValue !== 0)}
                                    >
                                        <RotateCw className="w-4 h-4" />
                                    </button>
                                );
                            },
                        },
                    ],
                }),
            ],
        }),
    ];
}
