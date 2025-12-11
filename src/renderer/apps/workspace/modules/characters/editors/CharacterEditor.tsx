import { useWorkspace } from "@/apps/workspace/context";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { createInputDialog } from "@/lib/components/dialogs";
import { ContextMenu, ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { AssetData, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterForm, CharacterVariantGroup, CharacterVariant } from "@/lib/workspace/services/character/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { AlertCircle, ChevronDown, ChevronRight, Image as ImageIcon, ImagePlus, MoreVertical, Plus, RefreshCw, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";

type CharacterEditorPayload = {
    character: Character;
};

type AssetView = {
    url: string;
    metadata?: AssetData<AssetType.Image>["metadata"];
};

type SelectorState = {
    open: boolean;
    formName: string | null;
    variantName: string | null;
    anchor: HTMLElement | null;
};

const DEFAULT_GROUP = "__default__";

// Clone forms to force referential changes so dependent effects re-run
const cloneForms = (forms: CharacterForm[]): CharacterForm[] =>
    forms.map(form => ({
        name: form.name,
        groups: form.groups.map(group => ({
            name: group.name,
            defaultVariant: group.defaultVariant,
            variants: group.variants.map((variant: CharacterVariant) => ({ ...variant })),
        })),
        variantAssets: { ...form.variantAssets },
    }));

function getFormThumbnailVariant(form?: CharacterForm | null): string | null {
    if (!form) return null;
    for (const group of form.groups) {
        if (group.defaultVariant && form.variantAssets[group.defaultVariant]) {
            return group.defaultVariant;
        }
        for (const variant of group.variants) {
            if (form.variantAssets[variant.name]) {
                return variant.name;
            }
        }
    }
    const firstAssetKey = Object.keys(form.variantAssets)[0];
    return firstAssetKey ?? null;
}

function findFirstAssetVariant(form?: CharacterForm | null): string | null {
    if (!form) return null;
    return getFormThumbnailVariant(form);
}

function VariantPreview({
    view,
    loading,
    error,
}: {
    view: AssetView | null;
    loading: boolean;
    error: string | null;
}) {
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });

    useEffect(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, [view?.url]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(prev => Math.max(0.1, Math.min(5, prev * delta)));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) {
            setIsPanning(true);
            setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
        }
    };

    const handleMouseUp = () => setIsPanning(false);

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115]">
                <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Loading preview...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115] p-4">
                <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded-md p-4 max-w-md">
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <p className="font-medium">Preview failed</p>
                        <p className="text-sm mt-1 text-red-300">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!view?.url) {
        return (
            <div className="h-full flex items-center justify-center bg-[#0f1115] text-gray-500">
                Select a variant with an image to preview
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#0f1115]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#1e1f22]">
                <div className="flex items-center gap-4 text-xs text-gray-300">
                    {view.metadata ? (
                        <>
                            <span>{view.metadata.width} × {view.metadata.height}</span>
                            <span className="text-gray-400">{view.metadata.format.toUpperCase()}</span>
                            <span className="text-gray-400">{(view.metadata.size / 1024).toFixed(1)} KB</span>
                        </>
                    ) : (
                        <span className="text-gray-400">No metadata</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" onClick={() => setZoom(prev => Math.max(0.1, prev / 1.2))}>
                        -
                    </button>
                    <span className="text-sm text-gray-300 min-w-14 text-center">{(zoom * 100).toFixed(0)}%</span>
                    <button className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors" onClick={() => setZoom(prev => Math.min(5, prev * 1.2))}>
                        +
                    </button>
                    <button
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors ml-2"
                        onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div
                className="flex-1 overflow-hidden flex items-center justify-center cursor-move"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <img
                    src={view.url}
                    alt="Variant preview"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        maxWidth: "100%",
                        maxHeight: "100%",
                        objectFit: "contain",
                        userSelect: "none",
                        pointerEvents: "none",
                    }}
                    draggable={false}
                />
            </div>
        </div>
    );
}

export function CharacterEditor({ payload }: EditorComponentProps<CharacterEditorPayload>) {
    const appearance = payload?.character.profile.appearance;
    const profile = payload?.character.profile;
    const { context } = useWorkspace();

    const uiService = useMemo(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);

    const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);

    const assetsService = useMemo(() => {
        if (!context) return null;
        return context.services.get<AssetsService>(Services.Assets);
    }, [context]);

    const [profileVersion, setProfileVersion] = useState(0);
    const [previewVariant, setPreviewVariant] = useState<string | null>(null);
    const [activeFormName, setActiveFormName] = useState<string>(() => profile?.getDefaultForm() ?? appearance?.getForms()[0]?.name ?? "");
    const [assetViews, setAssetViews] = useState<Record<string, AssetView>>({});
    const loadingAssets = useRef<Set<string>>(new Set());
    const [selectorState, setSelectorState] = useState<SelectorState>({ open: false, formName: null, variantName: null, anchor: null });
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [menuState, setMenuState] = useState({ visible: false, position: { x: 0, y: 0 } });
    const selectorAnchorMemo = useMemo(() => selectorState.anchor ? { current: selectorState.anchor } : undefined, [selectorState.anchor]);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const [forms, setForms] = useState<CharacterForm[]>(() => (appearance ? cloneForms(appearance.getForms()) : []));

    // Keep forms in sync with appearance updates without recreating snapshots on every render.
    useEffect(() => {
        if (!appearance) {
            setForms([]);
            return;
        }
        let cancelled = false;
        const syncForms = () => {
            if (!cancelled) {
                setForms(cloneForms(appearance.getForms()));
            }
        };
        syncForms(); // seed immediately
        const unsubscribe = appearance.subscribe(syncForms);
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [appearance]);
    const activeForm = useMemo<CharacterForm | null>(
        () => forms.find(f => f.name === activeFormName) ?? null,
        [forms, activeFormName, profileVersion]
    );

    const getVariantAsset = useCallback((form: CharacterForm | null, variantName: string) => {
        if (!form) return null;
        return form.variantAssets[variantName]?.data ?? null;
    }, []);

    const ensureAssetView = useCallback(async (asset: Asset<AssetType.Image> | null | undefined) => {
        if (!asset || !assetsService) return null;
        if (assetViews[asset.id]) return assetViews[asset.id];
        if (loadingAssets.current.has(asset.id)) return null;
        loadingAssets.current.add(asset.id);
        const result = await assetsService.fetch(asset as Asset<AssetType.Image>);
        loadingAssets.current.delete(asset.id);
        if (!result.success) {
            setPreviewError(result.error || "Failed to load asset");
            return null;
        }
        const blob = new Blob([new Uint8Array(result.data.data)]);
        const url = URL.createObjectURL(blob);
        setAssetViews(prev => {
            const existing = prev[asset.id];
            if (existing?.url) {
                URL.revokeObjectURL(existing.url);
            }
            return { ...prev, [asset.id]: { url, metadata: result.data.metadata } };
        });
        return { url, metadata: result.data.metadata };
    }, [assetViews, assetsService]);

    const syncPreview = useCallback(async (variantName: string | null, form: CharacterForm | null) => {
        if (!variantName || !form) {
            setPreviewError(null);
            return;
        }
        const asset = getVariantAsset(form, variantName);
        if (!asset) {
            setPreviewError(null);
            return;
        }
        setPreviewLoading(true);
        await ensureAssetView(asset);
        setPreviewLoading(false);
        setPreviewError(null);
    }, [ensureAssetView, getVariantAsset]);

    useEffect(() => {
        const initialForm = profile?.getDefaultForm() && forms.find(f => f.name === profile.getDefaultForm()) ? profile.getDefaultForm() : forms[0]?.name ?? "";
        setActiveFormName(prev => (prev && forms.some(f => f.name === prev) ? prev : initialForm ?? ""));
    }, [forms, profile]);

    useEffect(() => {
        if (!activeForm) {
            setPreviewVariant(null);
            return;
        }
        const hasVariant = activeForm.groups.some(g => g.variants.some(v => v.name === previewVariant));
        const fallbackVariant = findFirstAssetVariant(activeForm);
        const next = hasVariant ? previewVariant : fallbackVariant;
        setPreviewVariant(next ?? null);
        void syncPreview(next ?? null, activeForm);
    }, [activeForm, previewVariant, syncPreview]);

    useEffect(() => {
        if (!payload?.character) return;
        const unsubscribe = payload.character.subscribe(() => {
            setProfileVersion(v => v + 1);
        });
        return () => unsubscribe();
    }, [payload?.character]);

    useEffect(() => {
        return () => {
            Object.values(assetViews).forEach(view => URL.revokeObjectURL(view.url));
        };
        // Cleanup only on unmount; ensureAssetView already revokes replaced URLs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAddForm = useCallback(async () => {
        if (!appearance || !inputDialog) return;
        const name = await inputDialog.show({
            title: "New Form",
            placeholder: "Enter form name",
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return "Name is required";
                const exists = forms.some(f => f.name.toLowerCase() === trimmed.toLowerCase());
                if (exists) return "Form already exists";
                return null;
            },
        });
        if (!name) return;
        const exists = forms.some(f => f.name.toLowerCase() === name.trim().toLowerCase());
        if (exists) {
            uiService?.showNotification("Form already exists", "error");
            return;
        }
        appearance.ensureForm(name.trim());
        if (!profile?.getDefaultForm()) {
            profile?.setDefaultForm(name.trim());
        }
        setActiveFormName(name.trim());
        setProfileVersion(v => v + 1);
    }, [appearance, forms, inputDialog, profile, uiService]);

    const handleDeleteForm = useCallback(async (name: string) => {
        if (!appearance || !uiService) return;
        const confirmed = await uiService.showConfirm(`Delete form "${name}"?`, "Groups and variants inside will be removed.");
        if (!confirmed) return;
        appearance.removeForm(name);
        if (profile?.getDefaultForm() === name) {
            profile.setDefaultForm(null);
        }
        const remaining = appearance.getForms();
        setActiveFormName(remaining[0]?.name ?? "");
        setProfileVersion(v => v + 1);
        setMenuState(prev => ({ ...prev, visible: false }));
    }, [appearance, profile, uiService]);

    const ensureDefaultGroup = useCallback((formName: string): CharacterVariantGroup => {
        if (!appearance) {
            throw new Error("Appearance missing");
        }
        const form = appearance.getForm(formName);
        if (!form) throw new Error("Form missing");
        const existing = form.groups.find(g => g.name === DEFAULT_GROUP);
        if (existing) return existing;
        return appearance.createGroup(formName, DEFAULT_GROUP, [], null);
    }, [appearance]);

    const handleAddVariant = useCallback(async (formName: string, targetGroupName?: string) => {
        if (!appearance || !inputDialog) return;
        const name = await inputDialog.show({
            title: "New Variant",
            placeholder: "Enter variant name",
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return "Name is required";
                const form = appearance.getForm(formName);
                if (!form) return "Form not found";
                const exists = form.groups.some(g => g.variants.some(v => v.name.toLowerCase() === trimmed.toLowerCase()));
                if (exists) return "Variant already exists in this form";
                return null;
            },
        });
        if (!name) return;
        let group: CharacterVariantGroup | null = null;
        if (targetGroupName) {
            const form = appearance.getForm(formName);
            group = form?.groups.find(g => g.name === targetGroupName) ?? null;
            if (!group) {
                group = appearance.createGroup(formName, targetGroupName, [], null);
            }
        } else {
            group = ensureDefaultGroup(formName);
        }
        if (!group) return;
        const normalizedName = name.trim();
        const formHasDuplicate = appearance.getForm(formName)?.groups.some(g => g.variants.some(v => v.name.toLowerCase() === normalizedName.toLowerCase()));
        if (formHasDuplicate) {
            uiService?.showNotification("Variant name must be unique within the form", "error");
            return;
        }
        const created = appearance.createVariantInGroup(formName, group.name, normalizedName);
        if (!group.defaultVariant) {
            appearance.setGroupDefaultVariant(formName, group.name, created.name);
        }
        setPreviewVariant(created.name);
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, uiService, ensureDefaultGroup]);

    const handleAddGroup = useCallback(async (formName: string) => {
        if (!appearance || !inputDialog) return;
        const name = await inputDialog.show({
            title: "New Variant Group",
            placeholder: "Enter group name",
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return "Name is required";
                const form = appearance.getForm(formName);
                if (!form) return "Form not found";
                const exists = form.groups.some(g => g.name.toLowerCase() === trimmed.toLowerCase());
                if (exists) return "Group already exists";
                return null;
            },
        });
        if (!name) return;
        const form = appearance.getForm(formName);
        if (form?.groups.some(g => g.name.toLowerCase() === name.trim().toLowerCase())) {
            uiService?.showNotification("Group already exists", "error");
            return;
        }
        appearance.createGroup(formName, name.trim(), [], null);
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, uiService]);

    const handleDeleteGroup = useCallback(async (formName: string, groupName: string) => {
        if (!appearance || !uiService) return;
        if (groupName === DEFAULT_GROUP) {
            uiService?.showNotification("Cannot delete ungrouped bucket", "warning");
            return;
        }
        const confirmed = await uiService.showConfirm(`Delete group "${groupName}"?`, "Variants inside will be removed.");
        if (!confirmed) return;
        const form = appearance.getForm(formName);
        const isPreviewVariantInGroup = form?.groups.find(g => g.name === groupName)?.variants.some(v => v.name === previewVariant);
        appearance.removeGroup(formName, groupName);
        if (isPreviewVariantInGroup) {
            setPreviewVariant(findFirstAssetVariant(appearance.getForm(formName)) ?? null);
        }
        setProfileVersion(v => v + 1);
    }, [appearance, previewVariant, uiService]);

    const handleDeleteVariant = useCallback(async (formName: string, group: CharacterVariantGroup, variantName: string) => {
        if (!appearance || !uiService) return;
        const confirmed = await uiService.showConfirm(`Delete variant "${variantName}"?`, "Asset binding will be removed.");
        if (!confirmed) return;
        appearance.removeVariant(formName, group.name, variantName);
        if (previewVariant === variantName) {
            setPreviewVariant(findFirstAssetVariant(appearance.getForm(formName)) ?? null);
        }
        setProfileVersion(v => v + 1);
    }, [appearance, previewVariant, uiService]);

    const handleSelectVariantForPreview = useCallback((variantName: string) => {
        setPreviewVariant(variantName);
    }, []);

    const openSelector = useCallback((formName: string, variantName: string, anchor: HTMLElement | null) => {
        setSelectorState({ open: true, formName, variantName, anchor });
    }, []);

    const handleSelectAsset = useCallback(async (assets: Asset[]) => {
        if (!selectorState.formName || !selectorState.variantName || !appearance) return;
        const selected = assets[0];
        if (!selected || selected.type !== AssetType.Image) return;
        appearance.setVariantAsset(selectorState.formName, selectorState.variantName, selected as Asset<AssetType.Image>);
        await ensureAssetView(selected as Asset<AssetType.Image>);
        setPreviewVariant(selectorState.variantName);
        setSelectorState({ open: false, formName: null, variantName: null, anchor: null });
        setProfileVersion(v => v + 1);
    }, [appearance, ensureAssetView, selectorState]);

    const handleCloseSelector = useCallback(() => {
        setSelectorState({ open: false, formName: null, variantName: null, anchor: null });
    }, []);

    const handleSetDefaultVariant = useCallback((formName: string, groupName: string, variantName: string) => {
        appearance?.setGroupDefaultVariant(formName, groupName, variantName);
        setProfileVersion(v => v + 1);
    }, [appearance]);

    const closeMenu = useCallback(() => setMenuState(prev => ({ ...prev, visible: false })), []);

    const openVariantMenu = useCallback((event: React.MouseEvent, formName: string, group: CharacterVariantGroup, variantName: string) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const items: ContextMenuDef = [
            {
                id: "set-default-variant",
                label: "Set as Default",
                onClick: () => handleSetDefaultVariant(formName, group.name, variantName),
                disabled: group.defaultVariant === variantName,
            },
            {
                id: "delete-variant",
                label: "Delete Variant",
                onClick: () => handleDeleteVariant(formName, group, variantName),
            },
        ];
        setMenuItems(items);
        setMenuState({ visible: true, position: { x: rect.right, y: rect.bottom } });
    }, [handleDeleteVariant, handleSetDefaultVariant]);

    const toggleGroup = useCallback((formName: string, groupName: string) => {
        setExpandedGroups(prev => {
            const key = `${formName}:${groupName}`;
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    const formThumbnailUrls = useMemo(() => {
        const map: Record<string, string | null> = {};
        forms.forEach(form => {
            const variantName = getFormThumbnailVariant(form);
            const asset = variantName ? form.variantAssets[variantName]?.data : null;
            if (asset) {
                const view = assetViews[asset.id];
                if (view?.url) {
                    map[form.name] = view.url;
                }
            }
        });
        return map;
    }, [forms, assetViews]);

    const openFormMenu = useCallback((event: React.MouseEvent, form: CharacterForm) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const items: ContextMenuDef = [
            {
                id: "set-default-form",
                label: "Set as Default",
                onClick: () => {
                    profile?.setDefaultForm(form.name);
                    setProfileVersion(v => v + 1);
                },
                disabled: profile?.getDefaultForm() === form.name,
            },
            {
                id: "delete-form",
                label: "Delete Form",
                onClick: () => handleDeleteForm(form.name),
            },
        ];
        setMenuItems(items);
        setMenuState({ visible: true, position: { x: rect.right, y: rect.bottom } });
    }, [handleDeleteForm, profile]);

    useEffect(() => {
        forms.forEach(form => {
            const variantName = getFormThumbnailVariant(form);
            const asset = variantName ? form.variantAssets[variantName]?.data : null;
            void ensureAssetView(asset);
        });
    }, [forms, ensureAssetView]);

    useEffect(() => {
        if (!activeForm) return;
        Object.entries(activeForm.variantAssets).forEach(([, value]) => {
            void ensureAssetView(value.data);
        });
    }, [activeForm, ensureAssetView]);

    const previewAsset = useMemo(() => {
        if (!activeForm || !previewVariant) return null;
        const asset = getVariantAsset(activeForm, previewVariant);
        if (!asset) return null;
        return assetViews[asset.id] ?? null;
    }, [activeForm, previewVariant, getVariantAsset, assetViews]);

    const variantEntries = useMemo(() => {
        if (!activeForm) return [];
        return activeForm.groups.flatMap(group => group.variants.map(variant => ({ variant, group })));
    }, [activeForm]);

    const ungroupedVariants = useMemo(() => {
        if (!activeForm) return [];
        const defaultGroup = activeForm.groups.find(g => g.name === DEFAULT_GROUP);
        if (!defaultGroup) return [];
        return defaultGroup.variants.map(variant => ({ variant, group: defaultGroup }));
    }, [activeForm]);

    const groupedGroups = useMemo(() => {
        if (!activeForm) return [];
        return activeForm.groups.filter(g => g.name !== DEFAULT_GROUP);
    }, [activeForm]);

    return (
        <div className="h-full bg-[#0f1115] text-gray-200 flex flex-col">
            <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
                <span className="text-sm font-semibold truncate">
                    {payload?.character.profile.getProfile().name || "Character"}
                </span>
                <span className="text-xs text-gray-500">Character Editor</span>
            </div>

            <div className="flex-1 grid grid-cols-[260px_1fr_360px] gap-0 overflow-hidden">
                <div className="border-r border-white/10 overflow-y-auto">
                    <div className="px-3 py-2 text-xs text-gray-400 flex items-center justify-between">
                        <span className="uppercase tracking-wide text-[11px] text-gray-400">Forms</span>
                        <button
                            className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                            onClick={handleAddForm}
                            title="Add form"
                            aria-label="Add form"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-1 px-2 pb-3">
                        {forms.map(form => {
                            const isActive = form.name === activeForm?.name;
                            const thumb = formThumbnailUrls[form.name];
                            return (
                                <div
                                    key={form.name}
                                    className={`w-full px-3 py-2 rounded-md border transition-colors cursor-pointer flex items-center justify-between ${isActive
                                        ? "border-primary/60 bg-primary/10 text-white"
                                        : "border-white/10 hover:border-white/20 text-gray-200"
                                        }`}
                                    onClick={() => setActiveFormName(form.name)}
                                    onContextMenu={(e) => openFormMenu(e, form)}
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-10 h-10 rounded-md bg-white/10 flex items-center justify-center overflow-hidden border border-white/10">
                                            {thumb ? (
                                                <img src={thumb} alt={form.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <ImageIcon className="w-5 h-5 text-gray-500" />
                                            )}
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-sm truncate">{form.name}</span>
                                            <span className="text-[11px] text-gray-400 truncate">{form.groups.length} groups</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {profile?.getDefaultForm() === form.name && (
                                            <span className="text-[11px] text-primary flex items-center gap-1">
                                                Default
                                            </span>
                                        )}
                                        <button
                                            className="p-1 rounded hover:bg-white/10"
                                            onClick={(e) => openFormMenu(e, form)}
                                            title="Form actions"
                                        >
                                            <MoreVertical className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {forms.length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-500">No forms yet, click + to create one.</div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col">
                    <div className="px-4 py-2 border-b border-white/10 flex items-center gap-3">
                        <span className="text-sm font-semibold">Preview</span>
                        {activeForm && (
                            <span className="text-xs text-gray-500">Current form: {activeForm.name}</span>
                        )}
                        {previewVariant && <span className="text-xs text-gray-400">Variant: {previewVariant}</span>}
                    </div>
                    <VariantPreview view={previewAsset} loading={previewLoading} error={previewError} />
                </div>

                <div className="border-l border-white/10 overflow-y-auto">
                    <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between">
                        <span className="uppercase tracking-wide text-[11px] text-gray-400">Variants</span>
                        <div className="flex items-center gap-2">
                            <button
                                className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => activeForm && handleAddGroup(activeForm.name)}
                                disabled={!activeForm}
                                title="Add group"
                                aria-label="Add group"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                            <button
                                className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                onClick={() => activeForm && handleAddVariant(activeForm.name)}
                                disabled={!activeForm}
                                title="Add variant"
                                aria-label="Add variant"
                            >
                                <ImagePlus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    <div className="p-3 space-y-3">
                        {ungroupedVariants.length > 0 && (
                            <div className="space-y-2">
                                <div className="text-[11px] uppercase tracking-wide text-gray-500 px-1">Ungrouped</div>
                                {ungroupedVariants.map(({ variant, group }) => {
                                    const asset = activeForm?.variantAssets[variant.name]?.data ?? null;
                                    const view = asset ? assetViews[asset.id] : null;
                                    const isDefault = group.defaultVariant === variant.name;
                                    return (
                                        <div
                                            key={`${group.name}-${variant.name}`}
                                            className="rounded-md border border-white/10 bg-white/5 cursor-pointer hover:border-primary/40 transition-colors"
                                            onClick={() => handleSelectVariantForPreview(variant.name)}
                                        >
                                            <div className="flex gap-3 px-3 py-2 items-center">
                                                <div className="w-16 h-16 rounded-md bg-[#0f1115] border border-white/10 flex items-center justify-center overflow-hidden">
                                                    {view?.url ? (
                                                        <img src={view.url} alt={variant.name} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <ImageIcon className="w-5 h-5 text-gray-500" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0 space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm text-white truncate">{variant.name}</span>
                                                        {isDefault && (
                                                            <span className="text-[11px] text-primary flex items-center gap-1">
                                                                Default
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    className="p-1.5 rounded-md border border-white/10 hover:border-white/20 hover:bg-white/10 transition-colors"
                                                    onClick={(e) => { e.stopPropagation(); openSelector(activeForm?.name ?? "", variant.name, e.currentTarget); }}
                                                    title="Change image"
                                                    aria-label="Change image"
                                                >
                                                    <ImagePlus className="w-3 h-3" />
                                                </button>
                                                <button
                                                    className="p-1 rounded hover:bg-white/10"
                                                    onClick={(e) => openVariantMenu(e, activeForm?.name ?? "", group, variant.name)}
                                                    title="Variant actions"
                                                >
                                                    <MoreVertical className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {groupedGroups.map(group => {
                            const key = `${activeForm?.name ?? ""}:${group.name}`;
                            const isExpanded = expandedGroups.has(key);
                            return (
                                <div key={group.name} className="border border-white/10 rounded-lg">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="w-full px-3 py-2 border-b border-white/10 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                                        onClick={() => activeForm && toggleGroup(activeForm.name, group.name)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                activeForm && toggleGroup(activeForm.name, group.name);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2">
                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                            <span className="text-sm text-white">{group.name}</span>
                                            <span className="text-[11px] text-gray-400">{group.variants.length} variants</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                                                onClick={(e) => { e.stopPropagation(); activeForm && handleAddVariant(activeForm.name, group.name); }}
                                                title="Add variant"
                                                aria-label="Add variant to group"
                                            >
                                                <Plus className="w-4 h-4" />
                                            </button>
                                            <button
                                                className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
                                                onClick={(e) => { e.stopPropagation(); activeForm && handleDeleteGroup(activeForm.name, group.name); }}
                                                title="Delete group"
                                                aria-label="Delete group"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="p-2 space-y-2">
                                            {group.variants.map(variant => {
                                                const asset = activeForm?.variantAssets[variant.name]?.data ?? null;
                                                const view = asset ? assetViews[asset.id] : null;
                                                const isDefault = group.defaultVariant === variant.name;
                                                return (
                                                    <div
                                                        key={`${group.name}-${variant.name}`}
                                                        className="rounded-md border border-white/10 bg-white/5 cursor-pointer hover:border-primary/40 transition-colors"
                                                        onClick={() => handleSelectVariantForPreview(variant.name)}
                                                    >
                                                        <div className="flex gap-3 px-3 py-2 items-center">
                                                            <div className="w-16 h-16 rounded-md bg-[#0f1115] border border-white/10 flex items-center justify-center overflow-hidden">
                                                                {view?.url ? (
                                                                    <img src={view.url} alt={variant.name} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <ImageIcon className="w-5 h-5 text-gray-500" />
                                                                )}
                                                            </div>
                                                            <div className="flex-1 min-w-0 space-y-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-sm text-white truncate">{variant.name}</span>
                                                                    {isDefault && (
                                                                        <span className="text-[11px] text-primary flex items-center gap-1">
                                                                            Default
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-[11px] text-gray-500">Group: {group.name}</div>
                                                            </div>
                                                            <button
                                                                className="p-1.5 rounded-md border border-white/10 hover:border-white/20 hover:bg-white/10 transition-colors"
                                                                onClick={(e) => { e.stopPropagation(); openSelector(activeForm?.name ?? "", variant.name, e.currentTarget); }}
                                                                title="Change image"
                                                                aria-label="Change image"
                                                            >
                                                                <ImagePlus className="w-3 h-3" />
                                                            </button>
                                                            <button
                                                                className="p-1 rounded hover:bg-white/10"
                                                                onClick={(e) => openVariantMenu(e, activeForm?.name ?? "", group, variant.name)}
                                                                title="Variant actions"
                                                            >
                                                                <MoreVertical className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            {group.variants.length === 0 && (
                                                <div className="text-xs text-gray-500 px-2 pb-2">No variants yet, click "+" to add.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {!activeForm && (
                            <div className="text-sm text-gray-500">Select a form from the left.</div>
                        )}
                        {activeForm && ungroupedVariants.length === 0 && groupedGroups.length === 0 && (
                            <div className="text-sm text-gray-500">No variants yet, use the buttons above.</div>
                        )}
                    </div>
                </div>
            </div>

            <AssetSelector
                visible={selectorState.open}
                assetType={AssetType.Image}
                selectedIds={
                    selectorState.formName && selectorState.variantName && appearance?.getForm(selectorState.formName)?.variantAssets[selectorState.variantName]
                        ? [appearance.getForm(selectorState.formName)!.variantAssets[selectorState.variantName]!.data.id]
                        : []
                }
                onClose={handleCloseSelector}
                onConfirm={handleSelectAsset}
                anchorRef={selectorAnchorMemo}
                title="Select Variant Image"
                multiple={false}
            />
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={() => setMenuState(prev => ({ ...prev, visible: false }))}
            />
        </div>
    );
}