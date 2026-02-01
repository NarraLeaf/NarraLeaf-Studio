import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Settings } from "lucide-react";
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
import {
    getAssetPropertySchema,
    AssetEditorContext,
    characterPropertySchema,
    CharacterEditorContext,
} from "./schemas";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";
import { createPropertyEditorSchema, defineField } from "./framework";
import type { PropertyEditorSchema } from "./framework/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { getElementInspector } from "../ui-editor/inspector/registry";

type UIInspectorData = {
    element: UIElement;
    elements: UIElement[];
};

function createLayoutInspectorSchema(elements: UIElement[], documentService: UIDocumentService): PropertyEditorSchema<UIInspectorData> {
    const primaryId = elements.map(element => element.id).join("-");
    const applyLayoutPatch = (patch: Partial<UIElement["layout"]>) => {
        elements.forEach(element => {
            documentService.updateElementLayout(element.id, patch);
        });
    };

    return createPropertyEditorSchema<UIInspectorData>({
        id: `ui-layout-${primaryId}`,
        title: "Layout",
        fields: [
            defineField<UIInspectorData, any>({
                id: "layout.x",
                type: "number",
                label: "X",
                getValue: (data: UIInspectorData) => data.elements[0]?.layout.x ?? 0,
                setValue: (_data: UIInspectorData, value: number) => applyLayoutPatch({ x: Number(value) }),
                order: 0,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.y",
                type: "number",
                label: "Y",
                getValue: (data: UIInspectorData) => data.elements[0]?.layout.y ?? 0,
                setValue: (_data: UIInspectorData, value: number) => applyLayoutPatch({ y: Number(value) }),
                order: 1,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.width",
                type: "number",
                label: "Width",
                getValue: (data: UIInspectorData) => data.elements[0]?.layout.width ?? 0,
                setValue: (_data: UIInspectorData, value: number) => applyLayoutPatch({ width: Number(value) }),
                order: 2,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.height",
                type: "number",
                label: "Height",
                getValue: (data: UIInspectorData) => data.elements[0]?.layout.height ?? 0,
                setValue: (_data: UIInspectorData, value: number) => applyLayoutPatch({ height: Number(value) }),
                order: 3,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.visible",
                type: "checkbox",
                label: "Visible",
                getValue: (data: UIInspectorData) => data.elements[0]?.layout.visible ?? true,
                setValue: (_data: UIInspectorData, value: boolean) => applyLayoutPatch({ visible: Boolean(value) }),
                order: 4,
            }),
            defineField<UIInspectorData, any>({
                id: "layout.opacity",
                type: "number",
                label: "Opacity",
                getValue: (data: UIInspectorData) => data.elements[0]?.layout.opacity ?? 1,
                setValue: (_data: UIInspectorData, value: number) => applyLayoutPatch({ opacity: Number(value) }),
                order: 5,
            }),
        ],
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
    };

        setSelectionState(store.getSelection());

        const unsub = uiService.getEvents().on("selectionChanged", (sel) => {
            setSelectionState(sel);
        });

        return unsub;
    }, [context]);

    const renderUIInspector = () => {
        if (!uiSelection || !documentService) {
            return null;
        }
        const document = documentService.getDocument();
        const elements = uiSelection.elementIds
            .map(id => document.elements[id])
            .filter((element): element is UIElement => Boolean(element));
        if (elements.length === 0) {
            return (
                <div className="flex-1 flex items-center justify-center p-4">
                    <div className="text-center text-sm text-gray-500">
                        <p>Selected UI element is missing</p>
                    </div>
                </div>
            );
        }

        const layoutSchema = createLayoutInspectorSchema(elements, documentService);
        if (elements.length === 1) {
            const element = elements[0];
            const inspectorSchema = getElementInspector(element, documentService);
            const combinedSchema = inspectorSchema
                ? createPropertyEditorSchema<UIInspectorData>({
                      id: `ui-element:${element.id}`,
                      title: inspectorSchema.title ?? element.name ?? "UI Element",
                      fields: [...layoutSchema.fields, ...inspectorSchema.fields],
                  })
                : layoutSchema;
            return (
                <PropertyEditor
                    schema={combinedSchema}
                    data={{ element, elements }}
                />
            );
        }

        return <PropertyEditor schema={layoutSchema} data={{ element: elements[0], elements }} />;
    };

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
    }, [activeAsset?.id, assetMetadata, handleAssetUpdate]);

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
        const uiInspector = renderUIInspector();
        if (uiInspector) {
            return uiInspector;
        }
        // No selection
        if (!activeAsset && !activeCharacter) {
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
                    <span className="text-xs text-gray-400">
                        {activeCharacter
                            ? activeCharacter.profile.getProfile().name
                            : activeAsset
                            ? activeAsset.name
                            : "Properties"}
                    </span>
                </div>
                {(activeAsset || activeCharacter) && (
                    <span className="text-xs text-gray-500 uppercase">
                        {activeCharacter ? "Character" : activeAsset?.type}
                    </span>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">{renderPropertyEditor()}</div>
        </div>
    );
}
