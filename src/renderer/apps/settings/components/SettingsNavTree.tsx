import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";

export interface SettingsNavCategory {
    category: SettingCategory;
    entries: SettingDescriptor[];
}

interface SettingsNavTreeProps {
    categories: SettingsNavCategory[];
    selectedCategory?: string;
    onSelectCategory: (categoryKey: string) => void;
}

/**
 * Left-hand navigation: one row per category, nothing below it.
 *
 * The tree used to open each category onto its settings, which put individual options such as
 * "Confirm before quitting with ⌘Q" beside the categories as if they were places of their own. A
 * setting is found with the search box above, and the list on the right scrolls to it; the tree is
 * only for getting to a category. Labels only, no descriptions: the list is where explanations live.
 */
export function SettingsNavTree({ categories, selectedCategory, onSelectCategory }: SettingsNavTreeProps) {
    return (
        <nav className="min-h-0 flex-1 overflow-y-auto pr-1">
            {categories.map(({ category }) => {
                const isActive = selectedCategory === category.key;
                return (
                    <button
                        key={category.key}
                        type="button"
                        onClick={() => onSelectCategory(category.key)}
                        aria-current={isActive ? "true" : undefined}
                        className={`flex h-8 w-full min-w-0 items-center rounded-md px-3 text-left text-sm transition-colors ${isActive ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill hover:text-fg"}`}
                    >
                        <span className="truncate">{category.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
