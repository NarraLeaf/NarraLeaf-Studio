import { startTransition, useDeferredValue, useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
    ArrowLeftRight,
    ArrowUpDown,
    Droplets,
    Eye,
    EyeOff,
    Link,
    MoveHorizontal,
    MoveVertical,
    RotateCw,
} from "lucide-react";
import { PanelComponentProps } from "../types";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { AssetData } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import { PropertyEditor } from "./framework";
import { EnhancedInput } from "@/lib/components/inputs/EnhancedInput";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import {
    getAssetPropertySchema,
    AssetEditorContext,
    characterPropertySchema,
    CharacterEditorContext,
    scenePropertySchema,
    type SceneEditorContext,
} from "./schemas";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { getUIComponentLink, isLinkedUIComponentElement, type UIElement } from "@shared/types/ui-editor/document";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import { createPropertyEditorSchema, defineField } from "./framework";
import type {
    FieldDefinition,
    InlineRowItemContext,
    InputGroupTrailingContext,
    PropertyEditorSchema,
} from "./framework/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { getElementInspector } from "../ui-editor/inspector/registry";
import type { UIInspectorData } from "../ui-editor/inspector/registry";
import { useUIDocumentRevision } from "@/lib/ui-editor/hooks/useUIDocumentRevision";
import { collectSurfaceDiagnostics } from "@/lib/ui-editor/diagnostics/collectSurfaceDiagnostics";
import { pairLayoutDimensionsForLock } from "@/lib/ui-editor/layout/aspectRatioLock";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import {
    commitStateAwareLayoutPatches,
    currentStateOffset,
} from "@/lib/ui-editor/widget-modules/shared/appearance/stateGeometry";
import { useEditorEnteredState } from "@/lib/ui-editor/hooks/useEnteredElementState";
import { stateScopedMoveTarget } from "@/lib/ui-editor/widget-modules/shared/appearance/stateHost";
import { StatePositionMotionButton } from "@/lib/ui-editor/widget-modules/shared/appearance/StatePositionMotionButton";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import {
    createComponentDocumentServiceAdapter,
    parseComponentEditorSurfaceId,
} from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { ElementStateBar } from "@/lib/ui-editor/widget-modules/shared/appearance/ElementStateBar";
import { ElementAnimationField } from "@/lib/ui-editor/widget-modules/shared/page-animation/ElementAnimationField";
import { ComponentParamsEditor, LinkedComponentParamsField } from "./ComponentParamsEditor";
import { AssetSetInspector } from "./AssetSetInspector";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { AssetSet, AssetSetCandidate } from "@shared/types/assetSet";
import { StoryMotionKeyframeProperties } from "../story-motion/StoryMotionKeyframeProperties";
import {
    STORY_MOTION_KEYFRAME_SELECTION_TYPE,
    isStoryMotionKeyframeSelectionData,
    type StoryMotionKeyframeSelection,
} from "../story-motion/storyMotionTypes";
import { ActionInspector } from "../story/scene-editor/StorySceneActionInspector";
import { useStoryInspectorState } from "../story/scene-editor/storyInspectorBridge";
import {
    STORY_BLOCK_SELECTION_TYPE,
    isStoryBlockSelectionData,
    type StoryBlockSelection,
} from "../story/scene-editor/storySelection";
import { storyScenePropertySchema, type StorySceneEditorContext } from "./schemas";

/** Translator function, threaded into module-scope schema builders (they run outside React). */
type TranslateFn = Translator["t"];

function createLayoutInspectorSchema(
    elements: UIElement[],
    documentService: UIDocumentService,
    t: TranslateFn,
    surfaceId?: string,
    options: { linkedOnly?: boolean } = {},
): PropertyEditorSchema<UIInspectorData> {
    const primaryId = elements.map(element => element.id).join("-");
    const linkedOnly = options.linkedOnly === true;
    const applyLayoutPatch = (patch: Partial<UIElement["layout"]>) => {
        elements.forEach(element => {
            documentService.updateElementLayout(element.id, patch);
        });
    };

    const toNumber = (value: string | number) => {
        const next = Number(value);
        return Number.isFinite(next) ? next : null;
    };

    const updateDimension = (key: "width" | "height", value: string | number) => {
        const next = toNumber(value);
        if (next === null) {
            return;
        }
        elements.forEach(element => {
            const patch = pairLayoutDimensionsForLock(element.layout, key, next);
            documentService.updateElementLayout(element.id, patch);
        });
    };

    const getPrimaryLayout = (data: UIInspectorData) => data.elements[0]?.layout;
    /**
     * Where the element sits on the surface right now, the state it is being shown in included.
     *
     * A part held away from where it rests reads that held position, because that is the one on
     * screen and the one a number typed here is meant to replace. Only the element's own state
     * offset is added: an ancestor being held somewhere moves this element with it, and the field
     * is about where this element sits inside its parent, not about what the parent is doing.
     */
    const readElementSurfaceTopLeft = (element: UIElement) => {
        const document = documentService.getDocument();
        if (!document.elements[element.id]) {
            return element.layout;
        }
        const base = getElementSurfaceTopLeft(document, element.id);
        const entered = UIEditorStateService.getInstance().getEnteredState();
        const offset = currentStateOffset(document, entered, element.id);
        return offset ? { x: base.x + offset.x, y: base.y + offset.y } : base;
    };
    const applySurfacePositionPatch = (axis: "x" | "y", surfaceValue: number) => {
        const document = documentService.getDocument();
        const patches: Record<string, Partial<UIElement["layout"]>> = {};
        elements.forEach(element => {
            const current = document.elements[element.id] ?? element;
            const parentTopLeft =
                current.parentId && document.elements[current.parentId]
                    ? getElementSurfaceTopLeft(document, current.parentId)
                    : { x: 0, y: 0 };
            const size = axis === "x" ? current.layout.width : current.layout.height;
            patches[element.id] = {
                [axis]: surfaceValue - parentTopLeft[axis] - Math.min(0, size),
            };
        });
        // A number typed while a state is entered says where the element sits *in that state*, the
        // same thing dragging it there says.
        commitStateAwareLayoutPatches(
            documentService,
            UIEditorStateService.getInstance().getEnteredState(),
            patches,
            surfaceId ?? null,
        );
    };

    const createDefaultSizeField = (): FieldDefinition<UIInspectorData> => {
        const items = [
            {
                id: "layout.width",
                className: "min-w-0 flex-1 basis-0",
                render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                    const w = getPrimaryLayout(data)?.width ?? 0;
                    return (
                        <NumericDraftEnhancedInput
                            committedDisplay={String(w)}
                            draftResetKey={`${primaryId}-w`}
                            onFiniteNumber={value => {
                                onSaving(true);
                                try {
                                    updateDimension("width", value);
                                } finally {
                                    onSaving(false);
                                }
                            }}
                            inputMode="numeric"
                            type="number"
                            precision={2}
                            unit="px"
                            leftIcon={<ArrowLeftRight className="w-4 h-4 text-fg-muted" />}
                            className="w-full min-w-0"
                            selectAllOnFocus
                            aria-label={t("properties.layout.width")}
                        />
                    );
                },
            },
            {
                id: "layout.height",
                className: "min-w-0 flex-1 basis-0",
                render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                    const h = getPrimaryLayout(data)?.height ?? 0;
                    return (
                        <NumericDraftEnhancedInput
                            committedDisplay={String(h)}
                            draftResetKey={`${primaryId}-h`}
                            onFiniteNumber={value => {
                                onSaving(true);
                                try {
                                    updateDimension("height", value);
                                } finally {
                                    onSaving(false);
                                }
                            }}
                            inputMode="numeric"
                            type="number"
                            precision={2}
                            unit="px"
                            leftIcon={<ArrowUpDown className="w-4 h-4 text-fg-muted" />}
                            className="w-full min-w-0"
                            selectAllOnFocus
                            aria-label={t("properties.layout.height")}
                        />
                    );
                },
            },
        ];
        if (!linkedOnly) {
            items.push({
                id: "layout.aspectLock",
                className: "flex-shrink-0",
                render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                    // Multi-select: all on when not every element is locked; all off when every element is locked.
                    const allLocked = elements.every(el => el.layout.lockAspectRatio === true);
                    const primaryLocked = getPrimaryLayout(data)?.lockAspectRatio === true;
                    const pressed = elements.length === 1 ? primaryLocked : allLocked;
                    const toggle = () => {
                        const nextLocked = !allLocked;
                        onSaving(true);
                        try {
                            elements.forEach(el => {
                                documentService.updateElementLayout(el.id, {
                                    lockAspectRatio: nextLocked,
                                });
                            });
                        } finally {
                            onSaving(false);
                        }
                    };
                    return (
                        <button
                            type="button"
                            onClick={toggle}
                            aria-pressed={pressed}
                            aria-label={pressed ? t("properties.layout.unlockAspect") : t("properties.layout.lockAspect")}
                            data-tip={pressed ? t("properties.layout.unlockAspect") : t("properties.layout.lockAspect")}
                            className={controlButtonClass(pressed)}
                        >
                            <Link className="w-4 h-4" />
                        </button>
                    );
                },
            });
        }
        return defineField<UIInspectorData, any>({
            id: "layout.size",
            type: "inlineRow",
            label: t("properties.layout.size"),
            gap: 8,
            wrap: false,
            items,
            order: 1,
        });
    };

    const createSizeField = (): FieldDefinition<UIInspectorData> | null => {
        if (linkedOnly) {
            return createDefaultSizeField();
        }
        if (elements.length !== 1) {
            return createDefaultSizeField();
        }
        const element = elements[0]!;
        const mod = widgetModuleRegistry.get(element.type);
        const custom = mod?.createLayoutSizeField?.({
            element,
            documentService,
            surfaceId,
            primaryId,
        });
        return custom === undefined ? createDefaultSizeField() : custom;
    };

    const sizeField = createSizeField();
    const fields: FieldDefinition<UIInspectorData>[] = [
        defineField<UIInspectorData, any>({
            id: "layout.position",
            type: "inputGroup",
            label: t("properties.layout.position"),
            gap: 8,
            wrap: false,
            inputs: [
                {
                    id: "layout.x",
                    label: "X",
                    icon: <MoveHorizontal className="w-4 h-4 text-fg-muted" />,
                    type: "number",
                    precision: 2,
                    getValue: (data: UIInspectorData) => {
                        const element = data.elements[0];
                        return String(element ? readElementSurfaceTopLeft(element).x : 0);
                    },
                    setValue: (_data: UIInspectorData, raw: string) => {
                        const number = toNumber(raw);
                        if (number === null) {
                            return;
                        }
                        applySurfacePositionPatch("x", number);
                    },
                    selectAllOnFocus: true,
                },
                {
                    id: "layout.y",
                    label: "Y",
                    icon: <MoveVertical className="w-4 h-4 text-fg-muted" />,
                    type: "number",
                    precision: 2,
                    getValue: (data: UIInspectorData) => {
                        const element = data.elements[0];
                        return String(element ? readElementSurfaceTopLeft(element).y : 0);
                    },
                    setValue: (_data: UIInspectorData, raw: string) => {
                        const number = toNumber(raw);
                        if (number === null) {
                            return;
                        }
                        applySurfacePositionPatch("y", number);
                    },
                    selectAllOnFocus: true,
                },
            ],
            // Inside a widget that declares states, X and Y say where this sits in the state on
            // screen - so how it gets there belongs on the same row. Elsewhere a position has no
            // states to move between and there is nothing to configure.
            trailing: ({ readOnly }: InputGroupTrailingContext<UIInspectorData>) => {
                if (elements.length !== 1) {
                    return null;
                }
                const element = elements[0];
                const document = documentService.getDocument();
                const scoped = stateScopedMoveTarget(
                    document,
                    UIEditorStateService.getInstance().getEnteredState(),
                    element.id,
                );
                if (!scoped) {
                    return null;
                }
                return (
                    <StatePositionMotionButton
                        element={document.elements[element.id] ?? element}
                        documentService={documentService}
                        shownVariantId={scoped.variantId}
                        readOnly={readOnly}
                        draftResetKey={`${primaryId}|${scoped.variantId}`}
                    />
                );
            },
            order: 0,
        }),
        defineField<UIInspectorData, any>({
            id: "layout.rotation",
            type: "inlineRow",
            label: t("properties.layout.rotation"),
            gap: 8,
            wrap: false,
            items: [
                {
                    id: "layout.rotationValue",
                    className: "flex-1 min-w-0",
                    render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                        const layoutRotation = getPrimaryLayout(data)?.rotation;
                        const rotationValue = Number.isFinite(layoutRotation) ? layoutRotation! : 0;
                        return (
                            <NumericDraftEnhancedInput
                                committedDisplay={String(rotationValue)}
                                draftResetKey={primaryId}
                                onFiniteNumber={value => {
                                    const clamped = Math.min(360, Math.max(-360, value));
                                    onSaving(true);
                                    try {
                                        applyLayoutPatch({ rotation: clamped });
                                    } finally {
                                        onSaving(false);
                                    }
                                }}
                                inputMode="numeric"
                                type="number"
                                min={-360}
                                max={360}
                                unit="°"
                                precision={2}
                                leftIcon={<RotateCw className="w-4 h-4 text-fg-muted" />}
                                className="w-full min-w-0"
                                selectAllOnFocus
                            />
                        );
                    },
                },
                {
                    id: "layout.rotationReset",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                        const layoutRotation = getPrimaryLayout(data)?.rotation;
                        const rotationValue = Number.isFinite(layoutRotation) ? layoutRotation! : 0;
                        const reset = () => {
                            if (!rotationValue) return;
                            onSaving(true);
                            try {
                                applyLayoutPatch({ rotation: 0 });
                            } finally {
                                onSaving(false);
                            }
                        };
                        return (
                            <button
                                type="button"
                                onClick={reset}
                                aria-label={t("properties.layout.resetRotation")}
                                disabled={rotationValue === 0}
                                className={controlButtonClass(rotationValue !== 0)}
                            >
                                <RotateCw className="w-4 h-4" />
                            </button>
                        );
                    },
                },
            ],
            order: 2,
        }),
    ];

    if (!linkedOnly) {
        fields.push(defineField<UIInspectorData, any>({
            id: "layout.visibility",
            type: "inlineRow",
            label: t("properties.layout.appearance"),
            gap: 8,
            wrap: false,
            items: [
                {
                    id: "layout.opacity-inline",
                    className: "flex-1",
                    render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                        const layout = getPrimaryLayout(data);
                        const percent = Math.round(((layout?.opacity ?? 1) * 10000)) / 100;
                        const handleChange = (next: string) => {
                            const number = toNumber(next);
                            if (number === null) {
                                return;
                            }
                            const clamped = Math.min(100, Math.max(0, number));
                            onSaving(true);
                            try {
                                applyLayoutPatch({ opacity: clamped / 100 });
                            } finally {
                                onSaving(false);
                            }
                        };

                        return (
                            <EnhancedInput
                                value={String(percent)}
                                onChange={handleChange}
                                inputMode="decimal"
                                unit="%"
                                min={0}
                                max={100}
                                precision={null}
                                popoverWhenNarrow
                                popoverThreshold={124}
                                leftIcon={<Droplets className="w-4 h-4 text-fg-muted" />}
                                className="w-full min-w-0"
                            />
                        );
                    },
                },
                {
                    id: "layout.visible-inline",
                    className: "flex-shrink-0",
                    render: ({ data, onSaving }: InlineRowItemContext<UIInspectorData>) => {
                        const layout = getPrimaryLayout(data);
                        const visible = layout?.visible ?? true;
                        const toggleVisibility = () => {
                            onSaving(true);
                            try {
                                applyLayoutPatch({ visible: !visible });
                            } finally {
                                onSaving(false);
                            }
                        };

                        return (
                            <button
                                type="button"
                                onClick={toggleVisibility}
                                className={controlButtonClass()}
                                aria-pressed={visible}
                                aria-label={t("properties.layout.toggleVisibility")}
                            >
                                {visible ? (
                                    <Eye className="w-4 h-4" />
                                ) : (
                                    <EyeOff className="w-4 h-4" />
                                )}
                            </button>
                        );
                    },
                },
            ],
            order: 3,
        }));
    }
    if (sizeField) {
        fields.splice(1, 0, sizeField);
    }

    return createPropertyEditorSchema<UIInspectorData>({
        id: `ui-layout-${primaryId}`,
        title: t("properties.layout.title"),
        fields,
    });
}

/**
 * The animation section every element gets, under whatever the widget itself declares.
 *
 * Built here rather than in each widget module: how a widget arrives and leaves is not a property of
 * being a button or an image, and eighteen modules each remembering to offer it is eighteen chances
 * to forget. No `order`, so it sorts with the unordered fields and lands last, where a section about
 * the element as a whole belongs.
 */
function createElementAnimationField(element: UIElement, t: TranslateFn): FieldDefinition<UIInspectorData> {
    return defineField<UIInspectorData, any>({
        id: "element.animation",
        type: "section",
        title: t("properties.layout.animation"),
        collapsible: true,
        defaultCollapsed: true,
        fields: [
            defineField<UIInspectorData, any>({
                id: `element.animation.editor:${element.id}`,
                type: "custom",
                component: ElementAnimationField,
            }),
        ],
    });
}

/**
 * The state picker every element with more than one look gets, above everything else in the panel.
 *
 * Ordered before the layout fields because it is not a property of the element: it decides which
 * state the fields below are editing, and which one the canvas is drawing.
 */
function createElementStateField(element: UIElement): FieldDefinition<UIInspectorData> {
    return defineField<UIInspectorData, any>({
        id: `element.state:${element.id}`,
        type: "custom",
        order: -1,
        component: ElementStateBar,
    });
}

function mergeInspectorWithLayoutSchema(
    layoutSchema: PropertyEditorSchema<UIInspectorData>,
    inspectorSchema: PropertyEditorSchema<UIInspectorData>,
    element: UIElement,
    t: TranslateFn,
): PropertyEditorSchema<UIInspectorData> {
    const layoutFields = layoutSchema.fields ?? [];
    const stateField = createElementStateField(element);
    const animationField = createElementAnimationField(element, t);
    const baseTitle = inspectorSchema.title ?? element.name ?? t("properties.layout.uiElement");
    const baseId = `ui-element:${element.id}`;

    if (inspectorSchema.tabs && inspectorSchema.tabs.length > 0) {
        const targetTabId =
            inspectorSchema.defaultTabId ?? inspectorSchema.tabs[0]?.id ?? null;
        const tabs = inspectorSchema.tabs.map((tab) => {
            if (targetTabId && tab.id === targetTabId) {
                return {
                    ...tab,
                    fields: [stateField, ...layoutFields, ...tab.fields, animationField],
                };
            }
            return tab;
        });

        return createPropertyEditorSchema<UIInspectorData>({
            id: baseId,
            title: baseTitle,
            fields: [],
            tabs,
            defaultTabId: inspectorSchema.defaultTabId ?? tabs[0]?.id,
            onFieldChange: inspectorSchema.onFieldChange,
            showSavingIndicator: inspectorSchema.showSavingIndicator,
        });
    }

    return createPropertyEditorSchema<UIInspectorData>({
        id: baseId,
        title: baseTitle,
        fields: [stateField, ...layoutFields, ...(inspectorSchema.fields ?? []), animationField],
        onFieldChange: inspectorSchema.onFieldChange,
        showSavingIndicator: inspectorSchema.showSavingIndicator,
    });
}

function LinkedComponentInfoField({ data }: { data: UIInspectorData }) {
    const { t } = useTranslation();
    const link = getUIComponentLink(data.element);
    const component = link ? data.documentService.getComponent(link.componentId) : null;
    if (!link) {
        return null;
    }
    return (
        <div className="rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-fg">
            <div className="font-medium">{component?.name ?? t("properties.linkedComponent.missing")}</div>
            <div className="mt-1 text-2xs leading-snug text-fg-muted">
                {t("properties.linkedComponent.info")}
            </div>
        </div>
    );
}

/**
 * Declared at module scope, not inline in the schema below: the schema is rebuilt on every document
 * revision, and an inline component would be a new type each time - React would remount the field
 * and the text cursor would leave the input on the first keystroke.
 */
function LinkedComponentParamsSection({ data }: { data: UIInspectorData }) {
    return <LinkedComponentParamsField element={data.element} documentService={data.documentService} />;
}

function createLinkedComponentInspectorSchema(
    layoutSchema: PropertyEditorSchema<UIInspectorData>,
    element: UIElement,
    t: TranslateFn,
): PropertyEditorSchema<UIInspectorData> {
    return createPropertyEditorSchema<UIInspectorData>({
        id: `ui-linked-component:${element.id}`,
        title: element.name ?? t("properties.layout.linkedComponent"),
        fields: [
            ...(layoutSchema.fields ?? []),
            // An instance may animate even though its props come from the definition: how it arrives
            // belongs to where it was placed, the same way its position does.
            createElementAnimationField(element, t),
            defineField<UIInspectorData, any>({
                id: "component.params",
                type: "custom",
                component: LinkedComponentParamsSection,
                order: 98,
            }),
            defineField<UIInspectorData, any>({
                id: "component.linkInfo",
                type: "custom",
                component: LinkedComponentInfoField,
                order: 99,
            }),
        ],
    });
}

/**
 * Properties panel component
 * Shows properties/inspector for the selected item based on active editor
 */
export function PropertiesPanel({ panelId, payload }: PanelComponentProps) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
    const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
    const [activeSetId, setActiveSetId] = useState<string | null>(null);
    /**
     * Bumped by the set service and by the asset library, and read only as a `useMemo` dependency.
     *
     * A counter rather than the values themselves: what this panel needs is "something changed, look
     * again", and holding a copy of either would be a second answer to a question the services
     * already own.
     */
    const [assetSetRevision, setAssetSetRevision] = useState(0);
    const [assetLibraryRevision, setAssetLibraryRevision] = useState(0);
    const [assetMetadata, setAssetMetadata] = useState<AssetData<any> | null>(null);
    const [characterVersion, setCharacterVersion] = useState(0);
    const [uiSelection, setUISelection] = useState<UIElementSelection | null>(null);
    const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
    const [storyMotionSelection, setStoryMotionSelection] = useState<StoryMotionKeyframeSelection | null>(null);
    const [storySelection, setStorySelection] = useState<StoryBlockSelection | null>(null);
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
    
    // Track the current thumbnail URL and its associated thumbnailId to avoid revoking URLs still in use
    const thumbnailUrlRef = useRef<{ url: string; thumbnailId: string } | null>(null);

    // Use refs to get stable references for callbacks
    const activeAssetRef = useRef(activeAsset);
    activeAssetRef.current = activeAsset;

    const assetsService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<AssetsService>(Services.Assets);
    }, [context, isInitialized]);

    const assetSetService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<AssetSetService>(Services.AssetSets);
    }, [context, isInitialized]);

    const serviceAssets = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<ServiceAssetsService>(Services.ServiceAssets);
    }, [context, isInitialized]);

    const uiService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context, isInitialized]);

    // The position fields read the state an element is being shown in, so entering one has to rebuild
    // the schema the same way a document edit does.
    const enteredState = useEditorEnteredState();

    const storyService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<StoryService>(Services.Story);
    }, [context, isInitialized]);

    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context, isInitialized]);
    const graphService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<UIGraphService>(Services.UIGraph);
    }, [context, isInitialized]);
    const documentVersion = useUIDocumentRevision(documentService);
    const [graphVersion, setGraphVersion] = useState(0);
    const deferredUiSelection = useDeferredValue(uiSelection);
    const deferredDocumentVersion = useDeferredValue(documentVersion);
    const deferredGraphVersion = useDeferredValue(graphVersion);

    useEffect(() => {
        if (!graphService) {
            return undefined;
        }
        return graphService.onGraphsChanged(() => {
            setGraphVersion(v => v + 1);
        });
    }, [graphService]);

    /**
     * The component being edited, when the component editor has nothing selected.
     *
     * Deselecting on any canvas publishes the surface as the panel's subject, and a component editor
     * runs on a `component-editor:<id>` pseudo surface that is not in `document.surfaces` - so that
     * selection used to resolve to nothing at all. It is the one moment the panel's subject is the
     * component itself rather than something inside it, which is where params are declared: its root
     * is the outline's root and therefore not selectable, so there is no element to hang them on.
     */
    const activeComponentDefinition = useMemo(() => {
        const componentId = parseComponentEditorSurfaceId(activeSceneId);
        if (!componentId || !documentService) {
            return null;
        }
        return documentService.getDocument().components?.find(item => item.id === componentId) ?? null;
    }, [activeSceneId, documentService, documentVersion]);

    const activeSceneSurface = useMemo(() => {
        if (!documentService || !activeSceneId) {
            return null;
        }
        return (
            documentService
                .getDocument()
                .surfaces.find(surface => surface.id === activeSceneId) ?? null
        );
    }, [activeSceneId, documentService, documentVersion]);

    const sceneEditorContext = useMemo<SceneEditorContext | null>(() => {
        if (!activeSceneSurface || !documentService) {
            return null;
        }
        return {
            surface: activeSceneSurface,
            documentService,
        };
    }, [activeSceneSurface, documentService, documentVersion]);

    /**
     * The live context of the story scene editor that owns the rail (null when none does).
     *
     * Read through the bridge rather than through the selection: the selection only addresses the row,
     * and this panel has to redraw when the *document* changes under it — a speaker renamed, a payload
     * edited from the row itself. `useSyncExternalStore` also makes a row→row switch land in the same
     * commit as the click, rather than waiting on the selection event's transition.
     */
    const storyInspector = useStoryInspectorState(storySelection?.tabId);
    const storySceneContext = useMemo<StorySceneEditorContext | null>(() => {
        if (!storySelection || !storyInspector) {
            return null;
        }
        return { scene: storyInspector.scene, onUpdateScene: storyInspector.onUpdateScene };
    }, [storyInspector, storySelection]);
    const storyScene = storySelection ? storyInspector?.scene ?? null : null;

    // The header states the context (which scene), the body states the subject (which row, via the
    // inspector's own heading). Restating the row here would put the same sentence on screen twice in
    // a 460px column.
    /**
     * The set the panel is showing, read back off the service every time it changes rather than
     * taken from the selection.
     *
     * The selection carries the record as it was when the row was clicked, and every edit in this
     * inspector rewrites that record - so drawing from the selection would show the author their
     * first click for as long as they kept editing.
     */
    const activeSet = useMemo(
        () => (activeSetId && assetSetService ? assetSetService.getSet(activeSetId) ?? null : null),
        [activeSetId, assetSetService, assetSetRevision],
    );

    /**
     * The library as resolution sees it, plus the names to print for a resolved variant.
     *
     * Rebuilt when the asset library changes rather than held: a set names its members by tag, so an
     * import or a retag is exactly what makes a hole fill in, and a cached list would leave the
     * inspector showing the hole.
     */
    const { setCandidates, setAssetNames } = useMemo(() => {
        const candidates: AssetSetCandidate[] = [];
        const names = new Map<string, string>();
        if (!assetsService || !activeSet) {
            return { setCandidates: candidates, setAssetNames: names as ReadonlyMap<string, string> };
        }
        const map = assetsService.getAssets();
        for (const bucket of Object.values(map)) {
            for (const asset of Object.values(bucket ?? {})) {
                candidates.push({ id: asset.id, type: asset.type, tags: asset.tags });
                names.set(asset.id, asset.name);
            }
        }
        return { setCandidates: candidates, setAssetNames: names as ReadonlyMap<string, string> };
    }, [assetsService, activeSet, assetLibraryRevision]);

    const panelTitle = storyMotionSelection
        ? t("properties.panel.motionKeyframe")
        : storyScene
        ? storyScene.name
        : activeComponentDefinition
        ? activeComponentDefinition.name
        : activeSceneSurface
        ? activeSceneSurface.name
        : activeCharacter
        ? activeCharacter.profile.getProfile().name
        : activeAsset
        ? activeAsset.name
        : activeSet
        ? activeSet.name
        : t("properties.panel.title");
    const panelSubtitle = storyMotionSelection
        ? t("properties.panel.storyMotion")
        : storyScene
        ? t("properties.panel.scene")
        : activeComponentDefinition
        ? t("properties.panel.component")
        : activeSceneSurface
        ? t("properties.panel.scene")
        : activeCharacter
        ? t("properties.panel.character")
        : activeSet
        ? t("assets.sets.itemType")
        : activeAsset?.type;

    /**
     * Both halves of what the set inspector draws.
     *
     * Subscribed only while a set is the subject: the asset library emits on every import, rename
     * and retag in the project, and a panel showing a picture has no reason to re-run for any of it.
     */
    useEffect(() => {
        if (!activeSetId || !assetSetService) return;
        return assetSetService.onSetsChanged(() => setAssetSetRevision(revision => revision + 1));
    }, [activeSetId, assetSetService]);

    useEffect(() => {
        if (!activeSetId || !assetsService) return;
        const bump = () => setAssetLibraryRevision(revision => revision + 1);
        const events = assetsService.getEvents();
        const unsubs = [events.on("updated", bump), events.on("deleted", bump)];
        return () => unsubs.forEach(unsub => unsub());
    }, [activeSetId, assetsService]);

    // Listen to selection changes
    useEffect(() => {
        if (!uiService) return;
        const store = uiService.getStore();

        const setSelectionState = (selection: SelectionState) => {
            const motionSelection =
                selection.type === STORY_MOTION_KEYFRAME_SELECTION_TYPE && isStoryMotionKeyframeSelectionData(selection.data)
                    ? selection.data
                    : null;
            // A story scene editor owns the rail: the row it has focused, or the scene itself when it
            // has none. The subject travels as an address; its content arrives through the per-tab
            // bridge read below, which republishes as the document changes.
            const story =
                selection.type === STORY_BLOCK_SELECTION_TYPE && isStoryBlockSelectionData(selection.data)
                    ? selection.data
                    : null;
            setStoryMotionSelection(motionSelection);
            setStorySelection(story);
            setActiveAsset(!motionSelection && !story && selection.type === "asset" ? (selection.data as Asset) : null);
            // Only the id: the record itself is read back off the service, see `activeSet`.
            setActiveSetId(
                !motionSelection && !story && selection.type === "assetSet"
                    ? (selection.data as AssetSet).id
                    : null,
            );
            setActiveCharacter(!motionSelection && !story && selection.type === "character" ? (selection.data as Character) : null);
            setAssetMetadata(null);
            setUISelection(!motionSelection && !story && isUIElementSelection(selection) ? (selection.data as UIElementSelection) : null);
            const sceneId =
                !motionSelection && !story && selection.type === "scene"
                    ? typeof selection.data === "string"
                        ? selection.data
                        : selection.data?.id ?? null
                    : null;
            setActiveSceneId(sceneId);
        };

        setSelectionState(store.getSelection());

        const unsub = uiService.getEvents().on("selectionChanged", (sel) => {
            startTransition(() => {
                setSelectionState(sel);
            });
        });

        return unsub;
    }, [uiService]);

    const uiInspectorContent = useMemo(() => {
        if (!deferredUiSelection || !documentService) {
            return null;
        }
        const componentId = parseComponentEditorSurfaceId(deferredUiSelection.surfaceId);
        const inspectorDocumentService = componentId
            ? createComponentDocumentServiceAdapter(documentService, componentId)
            : documentService;
        const document = inspectorDocumentService.getDocument();
        const elements = deferredUiSelection.elementIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
        if (elements.length === 0) {
            return null;
        }

        const linkedLayoutOnly = elements.some(element => isLinkedUIComponentElement(element));
        const layoutSchema = createLayoutInspectorSchema(
            elements,
            inspectorDocumentService,
            t,
            deferredUiSelection.surfaceId,
            { linkedOnly: linkedLayoutOnly },
        );
        if (elements.length === 1) {
            const element = elements[0];
            if (isLinkedUIComponentElement(element)) {
                return (
                    <PropertyEditor
                        schema={createLinkedComponentInspectorSchema(layoutSchema, element, t)}
                        data={{ element, elements, documentService: inspectorDocumentService, surfaceId: deferredUiSelection.surfaceId }}
                    />
                );
            }
            const inspectorSchema = getElementInspector(element, inspectorDocumentService);
            const combinedSchema = mergeInspectorWithLayoutSchema(
                layoutSchema,
                // A widget with nothing of its own to declare still gets the sections every element
                // has, so the animation controls do not depend on which widget is selected.
                inspectorSchema ??
                    createPropertyEditorSchema<UIInspectorData>({
                        id: `ui-element:${element.id}`,
                        title: layoutSchema.title,
                        fields: [],
                    }),
                element,
                t,
            );
            return (
                <PropertyEditor
                    schema={combinedSchema}
                    data={{ element, elements, documentService: inspectorDocumentService, surfaceId: deferredUiSelection.surfaceId }}
                />
            );
        }

        return (
            <PropertyEditor
                schema={layoutSchema}
                data={{ element: elements[0], elements, documentService: inspectorDocumentService, surfaceId: deferredUiSelection.surfaceId }}
            />
        );
    }, [deferredUiSelection, documentService, deferredDocumentVersion, documentVersion, enteredState, t]);

    const selectUiCanvasElement = useCallback(
        (surfaceId: string, elementId: string) => {
            if (!context) {
                return;
            }
            context.services.get<UIService>(Services.UI).getStore().setSelection({
                type: "element",
                data: { editor: "ui", surfaceId, elementIds: [elementId], primaryId: elementId },
            });
        },
        [context],
    );

    const uiSelectionDiagnosticStrip = useMemo(() => {
        if (!deferredUiSelection || !documentService) {
            return null;
        }
        const bp = graphService?.getDocument().blueprintDocument;
        const componentId = parseComponentEditorSurfaceId(deferredUiSelection.surfaceId);
        const diagnosticDocumentService = componentId
            ? createComponentDocumentServiceAdapter(documentService, componentId)
            : documentService;
        const all = collectSurfaceDiagnostics(diagnosticDocumentService.getDocument(), deferredUiSelection.surfaceId, {
            blueprintDocument: bp,
        });
        const idSet = new Set(deferredUiSelection.elementIds);
        const picked = all.filter(d => !d.elementId || idSet.has(d.elementId)).slice(0, 5);
        if (picked.length === 0) {
            return null;
        }
        const surfaceId = deferredUiSelection.surfaceId;
        return (
            <div className="shrink-0 border-b border-warning/25 bg-warning/10 px-3 py-2 text-2xs text-warning">
                <span className="font-medium text-warning">{t("properties.diagnostics.title")}</span>
                <ul className="mt-1 list-none space-y-1 pl-0">
                    {picked.map(d => (
                        <li key={d.id} className="leading-snug">
                            {d.elementId ? (
                                <button
                                    type="button"
                                    className="w-full rounded-md px-1 py-0.5 text-left text-warning hover:bg-warning/10"
                                    onClick={() => selectUiCanvasElement(surfaceId, d.elementId!)}
                                >
                                    {d.message}
                                    <span className="ml-1 text-2xs text-primary">{t("properties.diagnostics.selectOnCanvas")}</span>
                                </button>
                            ) : (
                                <span className="text-warning">{d.message}</span>
                            )}
                        </li>
                    ))}
                </ul>
                <span className="mt-2 block text-2xs leading-snug text-fg-subtle">
                    {t("properties.diagnostics.help")}
                </span>
            </div>
        );
    }, [
        deferredUiSelection,
        documentService,
        graphService,
        deferredDocumentVersion,
        deferredGraphVersion,
        selectUiCanvasElement,
        t,
    ]);

    // Load asset metadata when asset changes
    useEffect(() => {
        if (!activeAsset || !assetsService) {
            setAssetMetadata(null);
            return;
        }

        let cancelled = false;

        const loadMetadata = async () => {
            try {
                const result = await assetsService.fetch(activeAsset);
                if (!cancelled && result.success) {
                    // Avoid storing raw binary data to prevent UI freeze
                    const { metadata } = result.data as any;
                    setAssetMetadata({ metadata } as AssetData<any>);
                }
            } catch (err) {
                console.error("Failed to load asset metadata:", err);
            }
        };

        loadMetadata();

        return () => {
            cancelled = true;
        };
        // `hash` is in the dependency list on purpose: a content replacement keeps the id and changes
        // the bytes, so without it this panel would keep reporting the dimensions and size of the
        // file that was there before.
    }, [activeAsset?.id, activeAsset?.hash, assetsService]);

    /**
     * The selection carries a *snapshot* of the asset record. A content replacement rewrites that
     * record in place, so without this the inspector would keep showing the previous hash — and the
     * metadata reload above, which keys on it, would never run.
     */
    useEffect(() => {
        if (!assetsService || !activeAsset) return;
        return assetsService.getEvents().on("updated", updated => {
            if (updated.id === activeAssetRef.current?.id) {
                setActiveAsset({ ...updated });
            }
        });
    }, [assetsService, activeAsset?.id]);

    // Listen to character changes
    useEffect(() => {
        if (!activeCharacter) return;
        const unsub = activeCharacter.subscribe(() => {
            setCharacterVersion((v) => v + 1);
        });
        return unsub;
    }, [activeCharacter]);

    // Get current thumbnailId - derived from activeCharacter and characterVersion
    const thumbnailId = useMemo(() => {
        if (!activeCharacter) return null;
        return activeCharacter.profile.getProfile().thumbnail;
    }, [activeCharacter, characterVersion]);

    // Load character thumbnail URL - only reload when thumbnailId actually changes
    useEffect(() => {
        // If no character or no thumbnailId, clear everything
        if (!activeCharacter || !thumbnailId) {
            if (thumbnailUrlRef.current) {
                URL.revokeObjectURL(thumbnailUrlRef.current.url);
                thumbnailUrlRef.current = null;
            }
            setThumbnailUrl(null);
            return;
        }

        // If URL already exists for this thumbnailId, reuse it
        if (thumbnailUrlRef.current?.thumbnailId === thumbnailId) {
            setThumbnailUrl(thumbnailUrlRef.current.url);
            return;
        }

        // Wait for services to be ready
        if (!serviceAssets) {
            return;
        }

        let cancelled = false;

        const loadThumb = async () => {
            const result = await serviceAssets.readRaw(thumbnailId);
            if (!result.ok || cancelled) {
                if (!cancelled) setThumbnailUrl(null);
                return;
            }
            // Clean up previous URL before creating new one
            if (thumbnailUrlRef.current) {
                URL.revokeObjectURL(thumbnailUrlRef.current.url);
            }
            const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(result.data)]));
            if (!cancelled) {
                thumbnailUrlRef.current = { url: objectUrl, thumbnailId };
                setThumbnailUrl(objectUrl);
            } else {
                // If cancelled after creation, clean up immediately
                URL.revokeObjectURL(objectUrl);
            }
        };

        void loadThumb();

        return () => {
            cancelled = true;
            // Don't revoke here - URL might still be in state and used by React
            // It will be cleaned up when a new URL is loaded or on unmount
        };
    }, [activeCharacter, serviceAssets, thumbnailId]);

    // Cleanup thumbnail URL on unmount only
    useEffect(() => {
        return () => {
            if (thumbnailUrlRef.current) {
                URL.revokeObjectURL(thumbnailUrlRef.current.url);
                thumbnailUrlRef.current = null;
            }
        };
    }, []);

    // Stable handler for asset field updates
    const handleAssetUpdate = useCallback(
        async (field: "name" | "tags" | "description" | "modelEntry", value: any) => {
            const asset = activeAssetRef.current;
            if (!asset || !assetsService) return;

            try {
                switch (field) {
                    case "name":
                        await assetsService.renameAsset(asset, value);
                        break;
                    case "tags":
                        await assetsService.updateAssetTags(asset, value);
                        break;
                    case "description":
                        await assetsService.updateAssetDescription(asset, value);
                        break;
                    case "modelEntry":
                        // Extras rather than a record field: which file in a bundle is the entry is
                        // an authored decision, and it is the one part of a bundle that is not
                        // re-derived from disk on every read.
                        await assetsService.patchAssetExtras(asset, { modelEntry: value });
                        break;
                }
            } catch (err) {
                console.error(`Failed to update ${field}:`, err);
            }
        },
        [assetsService]
    );

    // Build asset editor context - only recreate when necessary values change
    const assetContext = useMemo<AssetEditorContext<any> | null>(() => {
        if (!activeAsset) return null;
        return {
            asset: activeAsset,
            metadata: assetMetadata,
            onUpdate: handleAssetUpdate,
        };
    }, [activeAsset, assetMetadata, handleAssetUpdate]);

    // Build character editor context
    const characterContext = useMemo<CharacterEditorContext | null>(() => {
        if (!activeCharacter) return null;
        return {
            character: activeCharacter,
            thumbnailUrl,
            poses: activeCharacter.profile.appearance.getPoses().map(pose => ({ id: pose.id, name: pose.name })),
        };
    }, [activeCharacter, thumbnailUrl, characterVersion]);

    // Get asset schema
    const assetSchema = useMemo(() => {
        if (!activeAsset) return null;
        return getAssetPropertySchema(activeAsset.type, t);
    }, [activeAsset?.type, t]);

    // Build localized scene and character schemas (rebuilt when the locale changes)
    const sceneSchema = useMemo(() => scenePropertySchema(t), [t]);
    const characterSchema = useMemo(() => characterPropertySchema(t), [t]);
    const storySceneSchema = useMemo(() => storyScenePropertySchema(t), [t]);

    /**
     * The story editor's half of the rail: the focused row's inspector, or — with no row focused — the
     * scene's own fields. There is no third branch: while a scene tab is in front the panel always has
     * a subject, which is why the empty state below is reached only outside the story editor.
     */
    const storyContent = useMemo(() => {
        if (!storySelection || !storyInspector) {
            return null;
        }
        if (storyInspector.block) {
            // The inspector is a bare field stack with no chrome of its own, so the padding is here;
            // a PropertyEditor brings its own.
            return (
                <div className="p-3">
                    <ActionInspector
                        block={storyInspector.block}
                        document={storyInspector.document}
                        sceneId={storyInspector.sceneId}
                        characters={storyInspector.characters}
                        onUpdatePayload={storyInspector.onUpdatePayload}
                        onClose={storyInspector.onClose}
                        onSetDialogueCharacter={storyInspector.onSetDialogueCharacter}
                        generateTextId={storyInspector.generateTextId}
                        onCreateLayer={storyInspector.onCreateLayer}
                    />
                </div>
            );
        }
        return storySceneContext ? <PropertyEditor schema={storySceneSchema} data={storySceneContext} /> : null;
    }, [storyInspector, storySceneContext, storySceneSchema, storySelection]);

    // Render appropriate property editor
    const renderPropertyEditor = () => {
        if (storyMotionSelection && storyService && uiService) {
            return (
                <StoryMotionKeyframeProperties
                    selection={storyMotionSelection}
                    storyService={storyService}
                    uiService={uiService}
                />
            );
        }
        if (storyContent) {
            return storyContent;
        }
        if (uiInspectorContent) {
            return (
                <>
                    {uiSelectionDiagnosticStrip}
                    {uiInspectorContent}
                </>
            );
        }
        if (activeComponentDefinition && documentService) {
            // A bare section stack with no PropertyEditor chrome of its own, so the padding is here.
            return (
                <div className="p-3">
                    <ComponentParamsEditor
                        component={activeComponentDefinition}
                        documentService={documentService}
                    />
                </div>
            );
        }
        if (sceneEditorContext) {
            return <PropertyEditor schema={sceneSchema} data={sceneEditorContext} />;
        }

        // Character editor
        if (activeCharacter && characterContext) {
            return <PropertyEditor schema={characterSchema} data={characterContext} />;
        }

        // Asset editor
        if (activeAsset && assetContext && assetSchema) {
            return <PropertyEditor schema={assetSchema} data={assetContext} />;
        }

        // Asset set editor
        if (activeSet && assetSetService) {
            return (
                <AssetSetInspector
                    set={activeSet}
                    candidates={setCandidates}
                    assetNames={setAssetNames}
                    service={assetSetService}
                    assetsService={assetsService}
                />
            );
        }

        return null;
    };

    /**
     * Nothing anywhere in the app is selected — a Dashboard tab, say. One line, centred: an empty
     * column reads as "broken" as easily as it reads as "nothing selected", so the panel says which
     * one it is. One sentence only — the earlier copy stated it twice ("No item selected" over
     * "Select an item to view its properties").
     */
    const isEmpty = !storyContent
        && !storyMotionSelection
        && !uiInspectorContent
        && !activeComponentDefinition
        && !sceneEditorContext
        && !activeCharacter
        && !activeAsset
        && !activeSet;
    if (isEmpty) {
        return (
            <div className="nl-editor-surface flex h-full min-h-0 items-center justify-center p-6 text-center text-xs text-fg-subtle">
                {t("properties.panel.empty")}
            </div>
        );
    }

    /**
     * The whole panel is opaque, and follows the `editor.surfaceOpacity` knob rather than a fixed
     * colour.
     *
     * `.nl-editor-surface` is the one rule the editor's reading surfaces share (prose column, Dev Mode
     * debug panel, and this): a custom workspace background otherwise shows straight through a
     * panel whose base is `rgba(0,0,0,0)`, and values you have to read must not compete with a
     * photograph. It goes on both the panel root and the scroller so the whole plane paints as one,
     * header included.
     *
     * An earlier version scoped this to story rows only, which left the asset, character, interface and
     * (empty, on a Dashboard tab) inspectors reading over the wallpaper. A field label is a field
     * label whatever produced it, so the plate is unconditional — the empty branch above included,
     * since that is the one the Dashboard tab shows.
     */
    return (
        <div className="nl-editor-surface h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-edge">
            <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">{panelTitle}</span>
            </div>
            {panelSubtitle && (
                <span className="text-xs text-fg-subtle">{panelSubtitle}</span>
            )}
            </div>

            {/* Content */}
            <div className="nl-editor-surface flex-1 overflow-y-auto">{renderPropertyEditor()}</div>
        </div>
    );
}
