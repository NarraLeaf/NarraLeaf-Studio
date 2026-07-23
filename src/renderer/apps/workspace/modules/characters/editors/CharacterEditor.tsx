import { useWorkspace } from "@/apps/workspace/context";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import { FormsPanel } from "./components/FormsPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { VariantsPanel } from "./components/VariantsPanel";
import { AssetView } from "./components/types";
import { createInputDialog } from "@/lib/components/dialogs";
import { useTranslation } from "@/lib/i18n";
import { ContextMenu, ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterForm, CharacterVariantGroup, CharacterVariant } from "@/lib/workspace/services/character/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";

type CharacterEditorPayload = {
    character: Character;
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
        portrait: form.portrait,
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

export function CharacterEditor({ payload }: EditorComponentProps<CharacterEditorPayload>) {
    const { t } = useTranslation();
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
    const [formsCollapsed, setFormsCollapsed] = useState(false);
    const [variantsCollapsed, setVariantsCollapsed] = useState(false);

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
            setPreviewError(result.error || t("characters.errors.assetLoad"));
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
    }, [assetViews, assetsService, t]);

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
            title: t("characters.editor.dialog.newFormTitle"),
            placeholder: t("characters.editor.dialog.formNamePlaceholder"),
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return t("characters.editor.validation.nameRequired");
                const exists = forms.some(f => f.name.toLowerCase() === trimmed.toLowerCase());
                if (exists) return t("characters.editor.validation.formExists");
                return null;
            },
        });
        if (!name) return;
        const exists = forms.some(f => f.name.toLowerCase() === name.trim().toLowerCase());
        if (exists) {
            uiService?.showNotification(t("characters.editor.validation.formExists"), "error");
            return;
        }
        appearance.ensureForm(name.trim());
        if (!profile?.getDefaultForm()) {
            profile?.setDefaultForm(name.trim());
        }
        setActiveFormName(name.trim());
        setProfileVersion(v => v + 1);
    }, [appearance, forms, inputDialog, profile, uiService, t]);

    const handleDeleteForm = useCallback(async (name: string) => {
        if (!appearance || !uiService) return;
        const confirmed = await uiService.showConfirm(t("characters.editor.confirm.deleteFormTitle", { name }), t("characters.editor.confirm.deleteFormDetail"));
        if (!confirmed) return;
        appearance.removeForm(name);
        if (profile?.getDefaultForm() === name) {
            profile.setDefaultForm(null);
        }
        const remaining = appearance.getForms();
        setActiveFormName(remaining[0]?.name ?? "");
        setProfileVersion(v => v + 1);
        setMenuState(prev => ({ ...prev, visible: false }));
    }, [appearance, profile, uiService, t]);

    const handleRenameForm = useCallback(async (currentName: string) => {
        if (!appearance || !inputDialog) return;
        const nextName = await inputDialog.show({
            title: t("characters.editor.dialog.renameFormTitle"),
            placeholder: t("characters.editor.dialog.formNamePlaceholder"),
            initialValue: currentName,
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return t("characters.editor.validation.nameRequired");
                const exists = appearance.getForms().some(f => f.name.toLowerCase() === trimmed.toLowerCase());
                if (exists && trimmed.toLowerCase() !== currentName.toLowerCase()) return t("characters.editor.validation.formExists");
                return null;
            },
        });
        if (!nextName) return;
        const normalized = nextName.trim();
        const success = appearance.renameForm(currentName, normalized);
        if (!success) {
            uiService?.showNotification(t("characters.editor.notify.renameFormFailed"), "error");
            return;
        }
        setExpandedGroups(prev => {
            if (!Array.from(prev).some(key => key.startsWith(`${currentName}:`))) {
                return prev;
            }
            const next = new Set<string>();
            prev.forEach(key => {
                if (key.startsWith(`${currentName}:`)) {
                    next.add(key.replace(`${currentName}:`, `${normalized}:`));
                } else {
                    next.add(key);
                }
            });
            return next;
        });
        setSelectorState(prev => prev.formName === currentName ? { ...prev, formName: normalized } : prev);
        if (profile?.getDefaultForm() === currentName) {
            profile.setDefaultForm(normalized);
        }
        setActiveFormName(prev => (prev === currentName ? normalized : prev));
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, profile, uiService, t]);

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
            title: t("characters.editor.dialog.newVariantTitle"),
            placeholder: t("characters.editor.dialog.variantNamePlaceholder"),
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return t("characters.editor.validation.nameRequired");
                const form = appearance.getForm(formName);
                if (!form) return t("characters.editor.validation.formNotFound");
                const exists = form.groups.some(g => g.variants.some(v => v.name.toLowerCase() === trimmed.toLowerCase()));
                if (exists) return t("characters.editor.validation.variantExists");
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
            uiService?.showNotification(t("characters.editor.notify.variantNameUnique"), "error");
            return;
        }
        const created = appearance.createVariantInGroup(formName, group.name, normalizedName);
        if (!group.defaultVariant) {
            appearance.setGroupDefaultVariant(formName, group.name, created.name);
        }
        setPreviewVariant(created.name);
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, uiService, ensureDefaultGroup, t]);

    const handleAddGroup = useCallback(async (formName: string) => {
        if (!appearance || !inputDialog) return;
        const name = await inputDialog.show({
            title: t("characters.editor.dialog.newGroupTitle"),
            placeholder: t("characters.editor.dialog.groupNamePlaceholder"),
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return t("characters.editor.validation.nameRequired");
                const form = appearance.getForm(formName);
                if (!form) return t("characters.editor.validation.formNotFound");
                const exists = form.groups.some(g => g.name.toLowerCase() === trimmed.toLowerCase());
                if (exists) return t("characters.editor.validation.groupExists");
                return null;
            },
        });
        if (!name) return;
        const form = appearance.getForm(formName);
        if (form?.groups.some(g => g.name.toLowerCase() === name.trim().toLowerCase())) {
            uiService?.showNotification(t("characters.editor.validation.groupExists"), "error");
            return;
        }
        appearance.createGroup(formName, name.trim(), [], null);
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, uiService, t]);

    const handleDeleteGroup = useCallback(async (formName: string, groupName: string) => {
        if (!appearance || !uiService) return;
        if (groupName === DEFAULT_GROUP) {
            uiService?.showNotification(t("characters.editor.notify.deleteUngroupedBucket"), "warning");
            return;
        }
        const confirmed = await uiService.showConfirm(t("characters.editor.confirm.deleteGroupTitle", { name: groupName }), t("characters.editor.confirm.deleteGroupDetail"));
        if (!confirmed) return;
        const form = appearance.getForm(formName);
        const isPreviewVariantInGroup = form?.groups.find(g => g.name === groupName)?.variants.some(v => v.name === previewVariant);
        appearance.removeGroup(formName, groupName);
        if (isPreviewVariantInGroup) {
            setPreviewVariant(findFirstAssetVariant(appearance.getForm(formName)) ?? null);
        }
        setProfileVersion(v => v + 1);
    }, [appearance, previewVariant, uiService, t]);

    const handleRenameGroup = useCallback(async (formName: string, currentName: string) => {
        if (!appearance || !inputDialog) return;
        if (currentName === DEFAULT_GROUP) {
            uiService?.showNotification(t("characters.editor.notify.renameUngroupedBucket"), "warning");
            return;
        }
        const form = appearance.getForm(formName);
        if (!form) return;
        const nextName = await inputDialog.show({
            title: t("characters.editor.dialog.renameGroupTitle"),
            placeholder: t("characters.editor.dialog.groupNamePlaceholder"),
            initialValue: currentName,
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return t("characters.editor.validation.nameRequired");
                const exists = form.groups.some(g => g.name.toLowerCase() === trimmed.toLowerCase());
                if (exists && trimmed.toLowerCase() !== currentName.toLowerCase()) return t("characters.editor.validation.groupExists");
                return null;
            },
        });
        if (!nextName) return;
        const normalized = nextName.trim();
        const success = appearance.renameGroup(formName, currentName, normalized);
        if (!success) {
            uiService?.showNotification(t("characters.editor.notify.renameGroupFailed"), "error");
            return;
        }
        setExpandedGroups(prev => {
            const oldKey = `${formName}:${currentName}`;
            const newKey = `${formName}:${normalized}`;
            if (!prev.has(oldKey) || oldKey === newKey) return prev;
            const next = new Set(prev);
            next.delete(oldKey);
            next.add(newKey);
            return next;
        });
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, uiService, t]);

    const handleDeleteVariant = useCallback(async (formName: string, group: CharacterVariantGroup, variantName: string) => {
        if (!appearance || !uiService) return;
        const confirmed = await uiService.showConfirm(t("characters.editor.confirm.deleteVariantTitle", { name: variantName }), t("characters.editor.confirm.deleteVariantDetail"));
        if (!confirmed) return;
        appearance.removeVariant(formName, group.name, variantName);
        if (previewVariant === variantName) {
            setPreviewVariant(findFirstAssetVariant(appearance.getForm(formName)) ?? null);
        }
        setProfileVersion(v => v + 1);
    }, [appearance, previewVariant, uiService, t]);

    const handleRenameVariant = useCallback(async (formName: string, groupName: string, currentName: string) => {
        if (!appearance || !inputDialog) return;
        const form = appearance.getForm(formName);
        if (!form) return;
        const nextName = await inputDialog.show({
            title: t("characters.editor.dialog.renameVariantTitle"),
            placeholder: t("characters.editor.dialog.variantNamePlaceholder"),
            initialValue: currentName,
            required: true,
            maxLength: 80,
            validation: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return t("characters.editor.validation.nameRequired");
                const exists = form.groups.some(g => g.variants.some(v => v.name.toLowerCase() === trimmed.toLowerCase()));
                if (exists && trimmed.toLowerCase() !== currentName.toLowerCase()) return t("characters.editor.validation.variantExists");
                return null;
            },
        });
        if (!nextName) return;
        const normalized = nextName.trim();
        const success = appearance.renameVariant(formName, groupName, currentName, normalized);
        if (!success) {
            uiService?.showNotification(t("characters.editor.notify.renameVariantFailed"), "error");
            return;
        }
        setPreviewVariant(prev => (prev === currentName ? normalized : prev));
        setSelectorState(prev => (prev.variantName === currentName ? { ...prev, variantName: normalized } : prev));
        setProfileVersion(v => v + 1);
    }, [appearance, inputDialog, uiService, t]);

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
                id: "rename-variant",
                label: t("characters.editor.menu.renameVariant"),
                onClick: () => handleRenameVariant(formName, group.name, variantName),
            },
            {
                id: "set-default-variant",
                label: t("characters.editor.menu.setAsDefault"),
                onClick: () => handleSetDefaultVariant(formName, group.name, variantName),
                disabled: group.defaultVariant === variantName,
            },
            {
                id: "delete-variant",
                label: t("characters.editor.menu.deleteVariant"),
                onClick: () => handleDeleteVariant(formName, group, variantName),
            },
        ];
        setMenuItems(items);
        setMenuState({ visible: true, position: { x: rect.right, y: rect.bottom } });
    }, [handleDeleteVariant, handleRenameVariant, handleSetDefaultVariant, t]);

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
                id: "rename-form",
                label: t("characters.editor.menu.renameForm"),
                onClick: () => handleRenameForm(form.name),
            },
            {
                id: "set-default-form",
                label: t("characters.editor.menu.setAsDefault"),
                onClick: () => {
                    profile?.setDefaultForm(form.name);
                    setProfileVersion(v => v + 1);
                },
                disabled: profile?.getDefaultForm() === form.name,
            },
            {
                id: "delete-form",
                label: t("characters.editor.menu.deleteForm"),
                onClick: () => handleDeleteForm(form.name),
            },
        ];
        setMenuItems(items);
        setMenuState({ visible: true, position: { x: rect.right, y: rect.bottom } });
    }, [handleDeleteForm, handleRenameForm, profile, t]);

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

    const gridTemplateColumns = useMemo(() => {
        const left = formsCollapsed ? "32px" : "260px";
        const right = variantsCollapsed ? "32px" : "360px";
        return `${left} 1fr ${right}`;
    }, [formsCollapsed, variantsCollapsed]);

    return (
        <div className="h-full bg-surface text-fg flex flex-col">
            <div className="px-4 py-2 border-b border-edge flex items-center gap-2">
                <span className="text-sm font-semibold truncate">
                    {payload?.character.profile.getProfile().name || t("characters.editor.header.fallbackName")}
                </span>
                <span className="text-xs text-fg-subtle">{t("characters.editor.header.subtitle")}</span>
            </div>

            <div
                className="flex-1 grid gap-0 overflow-hidden"
                style={{ gridTemplateColumns }}
            >
                <FormsPanel
                    forms={forms}
                    activeFormName={activeForm?.name ?? activeFormName}
                    defaultFormName={profile?.getDefaultForm() ?? null}
                    thumbnails={formThumbnailUrls}
                    onAddForm={handleAddForm}
                    onSelectForm={setActiveFormName}
                    onOpenMenu={openFormMenu}
                    collapsed={formsCollapsed}
                    onToggleCollapse={() => setFormsCollapsed(prev => !prev)}
                />

                <PreviewPanel
                    activeForm={activeForm}
                    previewVariant={previewVariant}
                    previewAsset={previewAsset}
                    previewLoading={previewLoading}
                    previewError={previewError}
                />

                <VariantsPanel
                    activeForm={activeForm}
                    assetViews={assetViews}
                    expandedGroups={expandedGroups}
                    onToggleGroup={toggleGroup}
                    onAddGroup={handleAddGroup}
                    onAddVariant={handleAddVariant}
                    onDeleteGroup={handleDeleteGroup}
                    onRenameGroup={handleRenameGroup}
                    onSelectVariant={handleSelectVariantForPreview}
                    onOpenSelector={openSelector}
                    onOpenVariantMenu={openVariantMenu}
                    selectedVariant={previewVariant}
                    collapsed={variantsCollapsed}
                    onToggleCollapse={() => setVariantsCollapsed(prev => !prev)}
                />
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
                title={t("characters.editor.selectVariantImage")}
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