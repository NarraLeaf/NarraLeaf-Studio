import React from "react";
import { CharacterForm, CharacterVariantGroup } from "@/lib/workspace/services/character/types";
import { useTranslation } from "@/lib/i18n";
import { ChevronDown, ChevronLeft, ChevronRight, ImagePlus, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { HeadThumbnail } from "./HeadThumbnail";
import { AssetView } from "./types";

type VariantsPanelProps = {
    activeForm: CharacterForm | null;
    assetViews: Record<string, AssetView>;
    expandedGroups: Set<string>;
    onToggleGroup: (formName: string, groupName: string) => void;
    onAddGroup: (formName: string) => void;
    onAddVariant: (formName: string, targetGroupName?: string) => void;
    onDeleteGroup: (formName: string, groupName: string) => void;
    onRenameGroup: (formName: string, groupName: string) => void;
    onSelectVariant: (variantName: string) => void;
    onOpenSelector: (formName: string, variantName: string, anchor: HTMLElement | null) => void;
    onOpenVariantMenu: (event: React.MouseEvent, formName: string, group: CharacterVariantGroup, variantName: string) => void;
    selectedVariant: string | null;
    collapsed: boolean;
    onToggleCollapse: () => void;
};

const DEFAULT_GROUP = "__default__";

export function VariantsPanel({
    activeForm,
    assetViews,
    expandedGroups,
    onToggleGroup,
    onAddGroup,
    onAddVariant,
    onDeleteGroup,
    onRenameGroup,
    onSelectVariant,
    onOpenSelector,
    onOpenVariantMenu,
    selectedVariant,
    collapsed,
    onToggleCollapse,
}: VariantsPanelProps) {
    const { t, tn } = useTranslation();
    const ungroupedVariants = React.useMemo(() => {
        if (!activeForm) return [];
        const defaultGroup = activeForm.groups.find(g => g.name === DEFAULT_GROUP);
        if (!defaultGroup) return [];
        return defaultGroup.variants.map(variant => ({ variant, group: defaultGroup }));
    }, [activeForm]);

    const groupedGroups = React.useMemo(() => {
        if (!activeForm) return [];
        return activeForm.groups.filter(g => g.name !== DEFAULT_GROUP);
    }, [activeForm]);

    const getCardClasses = (isSelected: boolean) =>
        `rounded-md border cursor-pointer transition-colors hover:border-primary/40 ${isSelected ? "border-primary/60 bg-primary/10" : "border-edge bg-fill-subtle"}`;

    return (
        <div className="border-l border-edge h-full bg-surface">
            <div className={`border-b border-edge flex items-center justify-between ${collapsed ? "px-1 py-2" : "px-4 py-2"}`}>
                <div className="flex items-center gap-2">
                    <button
                        className="p-1 rounded-md text-fg hover:bg-fill transition-colors"
                        onClick={onToggleCollapse}
                        title={collapsed ? t("characters.variantsPanel.expand") : t("characters.variantsPanel.collapse")}
                        aria-label={collapsed ? t("characters.variantsPanel.expand") : t("characters.variantsPanel.collapse")}
                    >
                        {collapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {!collapsed && <span className="tracking-wide text-2xs text-fg-muted">{t("characters.variantsPanel.title")}</span>}
                </div>
                {!collapsed && (
                    <div className="flex items-center gap-2">
                        <button
                            className="p-1 rounded-md text-fg hover:bg-fill transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={() => activeForm && onAddGroup(activeForm.name)}
                            disabled={!activeForm}
                            title={t("characters.variantsPanel.addGroup")}
                            aria-label={t("characters.variantsPanel.addGroup")}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                        <button
                            className="p-1 rounded-md text-fg hover:bg-fill transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={() => activeForm && onAddVariant(activeForm.name)}
                            disabled={!activeForm}
                            title={t("characters.variantsPanel.addVariant")}
                            aria-label={t("characters.variantsPanel.addVariant")}
                        >
                            <ImagePlus className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
            {!collapsed ? (
                <div className="p-3 space-y-3 overflow-y-auto">
                    {ungroupedVariants.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-2xs tracking-wide text-fg-subtle px-1">{t("characters.variantsPanel.ungrouped")}</div>
                            {ungroupedVariants.map(({ variant, group }) => {
                                const asset = activeForm?.variantAssets[variant.name]?.data ?? null;
                                const view = asset ? assetViews[asset.id] : null;
                                const isDefault = group.defaultVariant === variant.name;
                                const isSelected = selectedVariant === variant.name;
                                return (
                                    <div
                                        key={`${group.name}-${variant.name}`}
                                        className={getCardClasses(isSelected)}
                                        onClick={() => onSelectVariant(variant.name)}
                                    >
                                        <div className="flex gap-3 px-3 py-2 items-center">
                                            <HeadThumbnail
                                                url={view?.url}
                                                alt={variant.name}
                                                className="w-16 h-16 rounded-md bg-surface border border-edge"
                                            />
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-fg truncate">{variant.name}</span>
                                                    {isDefault && (
                                                        <span className="text-2xs text-primary flex items-center gap-1">
                                                            {t("characters.variantsPanel.default")}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                className="p-1.5 rounded-md border border-edge hover:border-edge-strong hover:bg-fill transition-colors"
                                                onClick={(e) => { e.stopPropagation(); onOpenSelector(activeForm?.name ?? "", variant.name, e.currentTarget); }}
                                                title={t("characters.variantsPanel.changeImage")}
                                                aria-label={t("characters.variantsPanel.changeImage")}
                                            >
                                                <ImagePlus className="w-3 h-3" />
                                            </button>
                                            <button
                                                className="p-1 rounded hover:bg-fill"
                                                onClick={(e) => onOpenVariantMenu(e, activeForm?.name ?? "", group, variant.name)}
                                                title={t("characters.variantsPanel.variantActions")}
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
                            <div key={group.name} className="border border-edge rounded-lg">
                                <div
                                    role="button"
                                    tabIndex={0}
                                    className="w-full px-3 py-2 border-b border-edge flex items-center justify-between text-left hover:bg-fill-subtle transition-colors"
                                    onClick={() => activeForm && onToggleGroup(activeForm.name, group.name)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            activeForm && onToggleGroup(activeForm.name, group.name);
                                        }
                                    }}
                                >
                                    <div className="flex items-center gap-2">
                                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        <span className="text-sm text-fg">{group.name}</span>
                                        <span className="text-2xs text-fg-muted">{tn("characters.variantsPanel.variantCount", group.variants.length)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="p-1 rounded-md text-fg hover:bg-fill transition-colors"
                                            onClick={(e) => { e.stopPropagation(); activeForm && onAddVariant(activeForm.name, group.name); }}
                                            title={t("characters.variantsPanel.addVariant")}
                                            aria-label={t("characters.variantsPanel.addVariantToGroup")}
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                        <button
                                            className="p-1 rounded-md text-fg hover:bg-fill transition-colors"
                                            onClick={(e) => { e.stopPropagation(); activeForm && onRenameGroup(activeForm.name, group.name); }}
                                            title={t("characters.variantsPanel.renameGroup")}
                                            aria-label={t("characters.variantsPanel.renameGroup")}
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            className="p-1.5 rounded-md text-danger hover:text-danger/80 hover:bg-fill transition-colors"
                                            onClick={(e) => { e.stopPropagation(); activeForm && onDeleteGroup(activeForm.name, group.name); }}
                                            title={t("characters.variantsPanel.deleteGroup")}
                                            aria-label={t("characters.variantsPanel.deleteGroup")}
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
                                            const isSelected = selectedVariant === variant.name;
                                            return (
                                                <div
                                                    key={`${group.name}-${variant.name}`}
                                                    className={getCardClasses(isSelected)}
                                                    onClick={() => onSelectVariant(variant.name)}
                                                >
                                                    <div className="flex gap-3 px-3 py-2 items-center">
                                                        <HeadThumbnail
                                                            url={view?.url}
                                                            alt={variant.name}
                                                            className="w-16 h-16 rounded-md bg-surface border border-edge"
                                                        />
                                                        <div className="flex-1 min-w-0 space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm text-fg truncate">{variant.name}</span>
                                                                {isDefault && (
                                                                    <span className="text-2xs text-primary flex items-center gap-1">
                                                                        {t("characters.variantsPanel.default")}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-2xs text-fg-subtle">{t("characters.variantsPanel.groupPrefix", { name: group.name })}</div>
                                                        </div>
                                                        <button
                                                            className="p-1.5 rounded-md border border-edge hover:border-edge-strong hover:bg-fill transition-colors"
                                                            onClick={(e) => { e.stopPropagation(); onOpenSelector(activeForm?.name ?? "", variant.name, e.currentTarget); }}
                                                            title={t("characters.variantsPanel.changeImage")}
                                                            aria-label={t("characters.variantsPanel.changeImage")}
                                                        >
                                                            <ImagePlus className="w-3 h-3" />
                                                        </button>
                                                        <button
                                                            className="p-1 rounded hover:bg-fill"
                                                            onClick={(e) => onOpenVariantMenu(e, activeForm?.name ?? "", group, variant.name)}
                                                            title={t("characters.variantsPanel.variantActions")}
                                                        >
                                                            <MoreVertical className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {group.variants.length === 0 && (
                                            <div className="text-xs text-fg-subtle px-2 pb-2">{t("characters.variantsPanel.groupNoVariants")}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {!activeForm && (
                        <div className="text-sm text-fg-subtle">{t("characters.variantsPanel.selectForm")}</div>
                    )}
                    {activeForm && ungroupedVariants.length === 0 && groupedGroups.length === 0 && (
                        <div className="text-sm text-fg-subtle">{t("characters.variantsPanel.noVariants")}</div>
                    )}
                </div>
            ) : (
                <div className="h-full flex items-center justify-center">
                    <span className="text-2xs text-fg-subtle -rotate-90">{t("characters.variantsPanel.title")}</span>
                </div>
            )}
        </div>
    );
}

