import { ChevronRight } from "lucide-react";
import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";

export interface SettingsNavCategory {
    category: SettingCategory;
    entries: SettingDescriptor[];
}

interface SettingsNavTreeProps {
    categories: SettingsNavCategory[];
    /** Category keys currently open. */
    expanded: ReadonlySet<string>;
    onToggle: (categoryKey: string) => void;
    selectedCategory?: string;
    selectedSettingId?: string;
    onSelectCategory: (categoryKey: string) => void;
    onSelectSetting: (categoryKey: string, settingId: string) => void;
}

/**
 * Left-hand navigation: categories as an accordion, each opening onto its own settings.
 *
 * Deliberately labels only — no descriptions on either level. The tree is for getting somewhere,
 * and a second line per row turns six categories into a wall of prose you have to read past; the
 * settings list on the right is where the explanations belong.
 */
export function SettingsNavTree({
    categories,
    expanded,
    onToggle,
    selectedCategory,
    selectedSettingId,
    onSelectCategory,
    onSelectSetting,
}: SettingsNavTreeProps) {
    return (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {categories.map(({ category, entries }) => {
                const isExpanded = expanded.has(category.key);
                // The category reads as current only when the selection is the category itself —
                // once a row inside it is chosen, that row carries the highlight instead.
                const isActive = selectedCategory === category.key && !selectedSettingId;
                return (
                    <div key={category.key}>
                        <div
                            className={`flex w-full items-center rounded-md transition-colors ${isActive ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"}`}
                        >
                            <button
                                type="button"
                                onClick={() => onToggle(category.key)}
                                aria-label={category.label}
                                aria-expanded={isExpanded}
                                className="flex h-8 w-7 shrink-0 items-center justify-center rounded-l-md text-fg-subtle transition-colors hover:text-fg"
                            >
                                <ChevronRight
                                    className={`h-3.5 w-3.5 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                                />
                            </button>
                            <button
                                type="button"
                                onClick={() => onSelectCategory(category.key)}
                                className="flex h-8 min-w-0 flex-1 items-center rounded-r-md pr-3 text-left"
                            >
                                <span className="truncate text-sm font-medium">{category.label}</span>
                            </button>
                        </div>

                        {isExpanded && entries.length > 0 && (
                            <div className="mb-1">
                                {entries.map(descriptor => {
                                    const isSelected = selectedSettingId === descriptor.id;
                                    return (
                                        <button
                                            key={descriptor.id}
                                            type="button"
                                            onClick={() => onSelectSetting(category.key, descriptor.id)}
                                            title={descriptor.label}
                                            className={`flex h-7 w-full items-center rounded-md pl-7 pr-3 text-left transition-colors ${isSelected ? "bg-fill text-fg" : "text-fg-subtle hover:bg-fill-subtle hover:text-fg"}`}
                                        >
                                            <span className="truncate text-xs">{descriptor.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
