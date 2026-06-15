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
    Settings,
} from "lucide-react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
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
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import { createPropertyEditorSchema, defineField } from "./framework";
import type { InlineRowItemContext, PropertyEditorSchema } from "./framework/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { getElementInspector } from "../ui-editor/inspector/registry";
import type { UIInspectorData } from "../ui-editor/inspector/registry";
import { useDocumentVersion } from "@/lib/ui-editor/hooks/useDocumentVersion";
import { collectSurfaceDiagnostics } from "@/lib/ui-editor/diagnostics/collectSurfaceDiagnostics";
import { pairLayoutDimensionsForLock } from "@/lib/ui-editor/layout/aspectRatioLock";

function createLayoutInspectorSchema(elements: UIElement[], documentService: UIDocumentService): PropertyEditorSchema<UIInspectorData> {
    const primaryId = elements.map(element => element.id).join("-");
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

    return createPropertyEditorSchema<UIInspectorData>({
        id: `ui-layout-${primaryId}`,
        title: "Layout",
        fields: [
            defineField<UIInspectorData, any>({
                id: "layout.position",
                type: "inputGroup",
                label: "Position",
                gap: 8,
                wrap: false,
                inputs: [
                    {
                        id: "layout.x",
                        label: "X",
                        icon: <MoveHorizontal className="w-4 h-4 text-gray-400" />,
                        type: "number",
                        precision: 2,
                        getValue: (data: UIInspectorData) => String(getPrimaryLayout(data)?.x ?? 0),
                        setValue: (_data: UIInspectorData, raw: string) => {
                            const number = toNumber(raw);
                            if (number === null) {
                                return;
                            }
                            applyLayoutPatch({ x: number });
                        },
                        selectAllOnFocus: true,
                    },
                    {
                        id: "layout.y",
                        label: "Y",
                        icon: <MoveVertical className="w-4 h-4 text-gray-400" />,
                        type: "number",
                        precision: 2,
                        getValue: (data: UIInspectorData) => String(getPrimaryLayout(data)?.y ?? 0),
                        setValue: (_data: UIInspectorData, raw: string) => {
                            const number = toNumber(raw);
                            if (number === null) {
                                return;
                            }
                            applyLayoutPatch({ y: number });
                        },
                        selectAllOnFocus: true,
                    },
                ],
                order: 0,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.size",
                type: "inlineRow",
                label: "Size",
                gap: 8,
                wrap: false,
                items: [
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
                                    leftIcon={<ArrowLeftRight className="w-4 h-4 text-gray-400" />}
                                    className="w-full min-w-0"
                                    selectAllOnFocus
                                    aria-label="Width"
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
                                    leftIcon={<ArrowUpDown className="w-4 h-4 text-gray-400" />}
                                    className="w-full min-w-0"
                                    selectAllOnFocus
                                    aria-label="Height"
                                />
                            );
                        },
                    },
                    {
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
                                    aria-label={pressed ? "Unlock aspect ratio" : "Lock aspect ratio"}
                                    title={pressed ? "Unlock aspect ratio" : "Lock aspect ratio"}
                                    className={controlButtonClass(pressed)}
                                >
                                    <Link className="w-4 h-4" />
                                </button>
                            );
                        },
                    },
                ],
                order: 1,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.rotation",
                type: "inlineRow",
                label: "Rotation",
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
                order: 2,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.visibility",
                type: "inlineRow",
                label: "Appearance",
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
                                    leftIcon={<Droplets className="w-4 h-4 text-gray-400" />}
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
                                    className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-transparent text-gray-300 transition hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                                    aria-pressed={visible}
                                    aria-label="Toggle visibility"
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
            }),
        ],
    });
}

function mergeInspectorWithLayoutSchema(
    layoutSchema: PropertyEditorSchema<UIInspectorData>,
    inspectorSchema: PropertyEditorSchema<UIInspectorData>,
    element: UIElement
): PropertyEditorSchema<UIInspectorData> {
    const layoutFields = layoutSchema.fields ?? [];
    const baseTitle = inspectorSchema.title ?? element.name ?? "UI Element";
    const baseId = `ui-element:${element.id}`;

    if (inspectorSchema.tabs && inspectorSchema.tabs.length > 0) {
        const targetTabId =
            inspectorSchema.defaultTabId ?? inspectorSchema.tabs[0]?.id ?? null;
        const tabs = inspectorSchema.tabs.map((tab) => {
            if (targetTabId && tab.id === targetTabId && layoutFields.length > 0) {
                return {
                    ...tab,
                    fields: [...layoutFields, ...tab.fields],
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
        fields: [...layoutFields, ...(inspectorSchema.fields ?? [])],
        onFieldChange: inspectorSchema.onFieldChange,
        showSavingIndicator: inspectorSchema.showSavingIndicator,
    });
}

/**
 * Properties panel component
 * Shows properties/inspector for the selected item based on active editor
 */
export function PropertiesPanel({ panelId, payload }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const [activeAsset, setActiveAsset] = useState<Asset | null>(null);
    const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
    const [assetMetadata, setAssetMetadata] = useState<AssetData<any> | null>(null);
    const [characterVersion, setCharacterVersion] = useState(0);
    const [uiSelection, setUISelection] = useState<UIElementSelection | null>(null);
    const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
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

    const serviceAssets = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<ServiceAssetsService>(Services.ServiceAssets);
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
    const documentVersion = useDocumentVersion(documentService);
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
    }, [activeSceneSurface, documentService]);

    const panelTitle = activeSceneSurface
        ? activeSceneSurface.name
        : activeCharacter
        ? activeCharacter.profile.getProfile().name
        : activeAsset
        ? activeAsset.name
        : "Properties";
    const panelSubtitle = activeSceneSurface
        ? "Scene"
        : activeCharacter
        ? "Character"
        : activeAsset?.type;

    // Listen to selection changes
    useEffect(() => {
        if (!context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        const store = uiService.getStore();

    const setSelectionState = (selection: SelectionState) => {
        setActiveAsset(selection.type === "asset" ? (selection.data as Asset) : null);
        setActiveCharacter(selection.type === "character" ? (selection.data as Character) : null);
        setAssetMetadata(null);
        setUISelection(isUIElementSelection(selection) ? (selection.data as UIElementSelection) : null);
        const sceneId =
            selection.type === "scene"
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
    }, [context]);

    const uiInspectorContent = useMemo(() => {
        if (!deferredUiSelection || !documentService) {
            return null;
        }
        const document = documentService.getDocument();
        const elements = deferredUiSelection.elementIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
        if (elements.length === 0) {
            return null;
        }

        const layoutSchema = createLayoutInspectorSchema(elements, documentService);
        if (elements.length === 1) {
            const element = elements[0];
            const inspectorSchema = getElementInspector(element, documentService);
            const combinedSchema = inspectorSchema
                ? mergeInspectorWithLayoutSchema(layoutSchema, inspectorSchema, element)
                : layoutSchema;
            return (
                <PropertyEditor
                    schema={combinedSchema}
                    data={{ element, elements, documentService, surfaceId: deferredUiSelection.surfaceId }}
                />
            );
        }

        return (
            <PropertyEditor
                schema={layoutSchema}
                data={{ element: elements[0], elements, documentService, surfaceId: deferredUiSelection.surfaceId }}
            />
        );
    }, [deferredUiSelection, documentService, deferredDocumentVersion, documentVersion]);

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
        const all = collectSurfaceDiagnostics(documentService.getDocument(), deferredUiSelection.surfaceId, {
            blueprintDocument: bp,
        });
        const idSet = new Set(deferredUiSelection.elementIds);
        const picked = all.filter(d => !d.elementId || idSet.has(d.elementId)).slice(0, 5);
        if (picked.length === 0) {
            return null;
        }
        const surfaceId = deferredUiSelection.surfaceId;
        return (
            <div className="shrink-0 border-b border-amber-500/25 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-100/90">
                <span className="font-medium text-amber-200/95">Static checks</span>
                <ul className="mt-1 list-none space-y-1 pl-0">
                    {picked.map(d => (
                        <li key={d.id} className="leading-snug">
                            {d.elementId ? (
                                <button
                                    type="button"
                                    className="w-full rounded px-1 py-0.5 text-left text-amber-100/95 hover:bg-amber-500/10"
                                    onClick={() => selectUiCanvasElement(surfaceId, d.elementId!)}
                                >
                                    {d.message}
                                    <span className="ml-1 text-[10px] text-cyan-300/80">→ select on canvas</span>
                                </button>
                            ) : (
                                <span className="text-amber-100/90">{d.message}</span>
                            )}
                        </li>
                    ))}
                </ul>
                <span className="mt-2 block text-[10px] leading-snug text-gray-500">
                    Graph structure and binding issues: open the Blueprint editor tab from the Blueprint section. Live
                    execution, node enter/exit, and Host API traces appear in Dev Mode only.
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
    }, [activeAsset?.id, assetsService]);

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
        async (field: "name" | "tags" | "description", value: any) => {
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
            forms: [...activeCharacter.profile.appearance.getForms()],
        };
    }, [activeCharacter, thumbnailUrl, characterVersion]);

    // Get asset schema
    const assetSchema = useMemo(() => {
        if (!activeAsset) return null;
        return getAssetPropertySchema(activeAsset.type);
    }, [activeAsset?.type]);

    // Render appropriate property editor
    const renderPropertyEditor = () => {
        if (uiInspectorContent) {
            return (
                <>
                    {uiSelectionDiagnosticStrip}
                    {uiInspectorContent}
                </>
            );
        }
        if (sceneEditorContext) {
            return <PropertyEditor schema={scenePropertySchema} data={sceneEditorContext} />;
        }
        // No selection
        if (!activeAsset && !activeCharacter && !sceneEditorContext) {
            return (
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-gray-500 py-8">
                        <Settings className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p className="text-sm">No item selected</p>
                        <p className="text-xs mt-1">Select an item to view its properties</p>
                    </div>
                </div>
            );
        }

        // Character editor
        if (activeCharacter && characterContext) {
            return <PropertyEditor schema={characterPropertySchema} data={characterContext} />;
        }

        // Asset editor
        if (activeAsset && assetContext && assetSchema) {
            return <PropertyEditor schema={assetSchema} data={assetContext} />;
        }

        return null;
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{panelTitle}</span>
            </div>
            {panelSubtitle && (
                <span className="text-xs text-gray-500 uppercase">{panelSubtitle}</span>
            )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">{renderPropertyEditor()}</div>
        </div>
    );
}
