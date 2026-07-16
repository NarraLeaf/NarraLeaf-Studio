import { CharacterForm } from "@/lib/workspace/services/character/types";
import { useTranslation } from "@/lib/i18n";
import { ChevronLeft, ChevronRight, Image as ImageIcon, MoreVertical, Plus } from "lucide-react";
import React from "react";

type FormsPanelProps = {
    forms: CharacterForm[];
    activeFormName: string;
    defaultFormName: string | null | undefined;
    thumbnails: Record<string, string | null>;
    onAddForm: () => void;
    onSelectForm: (name: string) => void;
    onOpenMenu: (event: React.MouseEvent, form: CharacterForm) => void;
    collapsed: boolean;
    onToggleCollapse: () => void;
};

export function FormsPanel({
    forms,
    activeFormName,
    defaultFormName,
    thumbnails,
    onAddForm,
    onSelectForm,
    onOpenMenu,
    collapsed,
    onToggleCollapse,
}: FormsPanelProps) {
    const { t, tn } = useTranslation();
    return (
        <div className="border-r border-edge h-full bg-surface">
            <div className={`text-xs text-fg-muted flex items-center justify-between ${collapsed ? "px-1 py-2" : "px-3 py-2"}`}>
                {!collapsed && <span className="tracking-wide text-2xs text-fg-muted">{t("characters.formsPanel.title")}</span>}
                <div className="flex items-center gap-1">
                    {!collapsed && (
                        <button
                            className="p-1 rounded-md text-fg hover:bg-fill transition-colors"
                            onClick={onAddForm}
                            title={t("characters.formsPanel.addForm")}
                            aria-label={t("characters.formsPanel.addForm")}
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="p-1 rounded-md text-fg hover:bg-fill transition-colors"
                        onClick={onToggleCollapse}
                        title={collapsed ? t("characters.formsPanel.expand") : t("characters.formsPanel.collapse")}
                        aria-label={collapsed ? t("characters.formsPanel.expand") : t("characters.formsPanel.collapse")}
                    >
                        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                    </button>
                </div>
            </div>
            {!collapsed ? (
                <div className="space-y-1 px-2 pb-3 overflow-y-auto">
                    {forms.map(form => {
                        const isActive = form.name === activeFormName;
                        const thumb = thumbnails[form.name];
                        return (
                            <div
                                key={form.name}
                                className={`w-full px-3 py-2 rounded-md border transition-colors cursor-pointer flex items-center justify-between ${isActive
                                    ? "border-primary/60 bg-primary/10 text-fg"
                                    : "border-edge hover:border-edge-strong text-fg"
                                    }`}
                                onClick={() => onSelectForm(form.name)}
                                onContextMenu={(e) => onOpenMenu(e, form)}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-md bg-fill flex items-center justify-center overflow-hidden border border-edge">
                                        {thumb ? (
                                            <img src={thumb} alt={form.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon className="w-5 h-5 text-fg-subtle" />
                                        )}
                                    </div>
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-sm truncate">{form.name}</span>
                                        <span className="text-2xs text-fg-muted truncate">{tn("characters.formsPanel.groupCount", form.groups.length)}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {defaultFormName === form.name && (
                                        <span className="text-2xs text-primary flex items-center gap-1">
                                            {t("characters.formsPanel.default")}
                                        </span>
                                    )}
                                    <button
                                        className="p-1 rounded hover:bg-fill"
                                        onClick={(e) => onOpenMenu(e, form)}
                                        title={t("characters.formsPanel.formActions")}
                                    >
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {forms.length === 0 && (
                        <div className="px-3 py-2 text-sm text-fg-subtle">{t("characters.formsPanel.empty")}</div>
                    )}
                </div>
            ) : (
                <div className="h-full flex items-center justify-center">
                    <span className="text-2xs text-fg-subtle rotate-90">{t("characters.formsPanel.title")}</span>
                </div>
            )}
        </div>
    );
}

