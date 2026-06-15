import { CharacterForm } from "@/lib/workspace/services/character/types";
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
    return (
        <div className="border-r border-white/10 h-full bg-[#0f1115]">
            <div className={`text-xs text-gray-400 flex items-center justify-between ${collapsed ? "px-1 py-2" : "px-3 py-2"}`}>
                {!collapsed && <span className="uppercase tracking-wide text-[11px] text-gray-400">Forms</span>}
                <div className="flex items-center gap-1">
                    {!collapsed && (
                        <button
                            className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                            onClick={onAddForm}
                            title="Add form"
                            aria-label="Add form"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        className="p-1 rounded-md text-gray-200 hover:text-white hover:bg-white/10 transition-colors"
                        onClick={onToggleCollapse}
                        title={collapsed ? "Expand forms" : "Collapse forms"}
                        aria-label={collapsed ? "Expand forms" : "Collapse forms"}
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
                                    ? "border-primary/60 bg-primary/10 text-white"
                                    : "border-white/10 hover:border-white/20 text-gray-200"
                                    }`}
                                onClick={() => onSelectForm(form.name)}
                                onContextMenu={(e) => onOpenMenu(e, form)}
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
                                    {defaultFormName === form.name && (
                                        <span className="text-[11px] text-primary flex items-center gap-1">
                                            Default
                                        </span>
                                    )}
                                    <button
                                        className="p-1 rounded hover:bg-white/10"
                                        onClick={(e) => onOpenMenu(e, form)}
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
            ) : (
                <div className="h-full flex items-center justify-center">
                    <span className="text-[10px] text-gray-500 rotate-90">Forms</span>
                </div>
            )}
        </div>
    );
}

