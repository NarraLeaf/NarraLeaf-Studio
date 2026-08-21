import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { Type } from "lucide-react";
import {
    AssetSelector,
    type AssetSelectorVirtualGroup,
} from "@/apps/workspace/modules/assets/components/AssetSelector";
import {
    EDITOR_BUILTIN_FONT_VIRTUAL_GROUP,
    getBuiltinEditorFontDisplayName,
} from "@/lib/ui-editor/fonts/builtinVirtualEditorFonts";
import {
    PROJECT_DEFAULT_FONT_OPTION_ID,
    projectDefaultFontVirtualGroup,
} from "@/lib/ui-editor/fonts/projectDefaultFontOption";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetLibraryRevision } from "@/lib/workspace/hooks/useAssetLibraryRevision";
import { useEditorFontFamily } from "@/lib/workspace/hooks/useEditorFontFamily";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import type { FontAssetFieldDefinition } from "../types";
import { FieldLayout } from "./FieldLayout";
import { makeFreezeGuard, useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

interface FontAssetFieldProps<TData extends UIInspectorData = UIInspectorData> {
    field: FontAssetFieldDefinition<TData>;
    data: TData;
    onSaving: (saving: boolean) => void;
}

export function FontAssetField<TData extends UIInspectorData>({
    field,
    data,
    onSaving,
}: FontAssetFieldProps<TData>) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const assetsService = useMemo(() => {
        if (!context) {
            return null;
        }
        return context.services.get<AssetsService>(Services.Assets);
    }, [context]);

    const assetId = field.getValue(data);
    const { cssFamily, loading: fontLoading, error: fontError } = useEditorFontFamily(assetId);

    /**
     * The project's own default is offered first, above the built-in stacks and the library.
     *
     * It is an entry in the picker rather than only the empty state, because "follows the project"
     * is a choice an author makes on purpose - having picked a font and changed their mind, the way
     * back has to be somewhere they can press. What it writes is null: absence *is* the state (see
     * `@shared/types/typography`), so nothing new is stored in any document.
     */
    const virtualGroups = useMemo<AssetSelectorVirtualGroup[]>(
        () => [
            projectDefaultFontVirtualGroup(
                t("properties.fontAsset.projectSection"),
                t("properties.fontAsset.projectDefault"),
            ),
            EDITOR_BUILTIN_FONT_VIRTUAL_GROUP,
        ],
        [t],
    );

    const [selectorOpen, setSelectorOpen] = useState(false);
    const previewRef = useRef<HTMLButtonElement | null>(null);

    /**
     * The tile is a preview, but pressing it opens the font picker whose choice is written straight
     * back through `setValue`, and the Clear nested in it drops the binding outright. On a frozen
     * project both went through and the widget's typography changed until the thaw threw it away.
     *
     * Read off the definition's own `readOnly` flag rather than the workspace, because
     * `fieldReadOnlyStrategy` lists `"fontAsset"` among the types that make themselves read-only -
     * `FieldRenderer` sets the flag and renders no clamp around this field, so nothing else is coming.
     * The workspace guard is here for the hover string alone. Only the buttons go dead; the sample
     * text and the family name keep their own colours, which is what the author came to read.
     */
    const workspaceFreeze = useFreezeGuard();
    const freeze = useMemo(
        () => makeFreezeGuard(field.readOnly === true, workspaceFreeze.reason),
        [field.readOnly, workspaceFreeze.reason],
    );

    const assetLibraryRevision = useAssetLibraryRevision();
    const assetName = useMemo(() => {
        if (!assetId) {
            return null;
        }
        const builtinName = getBuiltinEditorFontDisplayName(assetId);
        if (builtinName) {
            return builtinName;
        }
        if (!assetsService) {
            return null;
        }
        return assetsService.getAssets()[AssetType.Font]?.[assetId]?.name ?? null;
        // `assetLibraryRevision`: the record is mutated in place, so a rename changes nothing this
        // memo keys on. Without it the field keeps the name the font had when the panel opened.
    }, [assetId, assetLibraryRevision, assetsService]);

    // Never "no font": a widget that has chosen nothing is set in the project's default, so naming
    // the state after what it does is the only reading that matches what is on screen beside it.
    const previewLabel = assetId
        ? assetName ?? t("properties.fontAsset.fallbackName")
        : t("properties.fontAsset.projectDefault");

    const applyAssetId = useCallback(
        (next: string | null) => {
            onSaving(true);
            try {
                field.setValue(data, next);
            } finally {
                onSaving(false);
            }
        },
        [data, field, onSaving],
    );

    const handleConfirm = useCallback(
        (assets: Asset[]) => {
            const selected = assets[0];
            if (!selected) {
                return;
            }
            // The project-default row is an offer, not an id: it is stored as absence, which is what
            // every widget that has never been touched already holds.
            applyAssetId(selected.id === PROJECT_DEFAULT_FONT_OPTION_ID ? null : selected.id);
            setSelectorOpen(false);
        },
        [applyAssetId],
    );

    const handleClear = useCallback(
        (e: MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            applyAssetId(null);
        },
        [applyAssetId],
    );

    return (
        <>
            <FieldLayout field={field}>
                <button
                    type="button"
                    ref={previewRef}
                    onClick={() => setSelectorOpen(true)}
                    className="relative mt-1 w-full rounded-xl border border-edge bg-surface px-3 py-3 text-left focus:outline-none focus:ring-2 focus:ring-primary/70"
                    {...freeze.writes()}
                >
                    <div className="flex items-center gap-2 text-xs text-fg-muted tracking-widest">
                        <Type className="h-3.5 w-3.5 shrink-0" />
                        <span>{t("properties.preview")}</span>
                    </div>
                    <div
                        className="mt-2 text-sm text-fg truncate"
                        style={cssFamily ? { fontFamily: cssFamily } : undefined}
                    >
                        {fontLoading ? t("common.loading") : "Aa Bb Cc 123"}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
                        <span className="truncate">{previewLabel}</span>
                        {assetId ? (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="shrink-0 rounded-md px-2 py-0.5 text-2xs tracking-wider text-fg-subtle hover:bg-fill hover:text-fg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                {...freeze.writes()}
                            >
                                {t("common.clear")}
                            </button>
                        ) : null}
                    </div>
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 text-2xs tracking-[0.3em] text-white transition hover:opacity-100">
                        {t("properties.fontAsset.choose")}
                    </div>
                </button>
            </FieldLayout>

            {assetId && fontError ? (
                <p className="mt-1 text-2xs text-warning leading-snug">
                    {t("properties.fontAsset.loadError", { error: fontError })}
                </p>
            ) : null}

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Font}
                virtualGroups={virtualGroups}
                virtualGroupsPlacement="before"
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleConfirm}
                selectedIds={assetId ? [assetId] : [PROJECT_DEFAULT_FONT_OPTION_ID]}
                anchorRef={previewRef}
                title={t("properties.fontAsset.select")}
                multiple={false}
            />
        </>
    );
}
