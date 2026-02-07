import { useCallback, useMemo, useState } from "react";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Input } from "@/lib/components/elements/Input";
import { Select, SelectOption } from "@/lib/components/elements/Select";
import { Switch } from "@/lib/components/elements/Switch";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { Loader2 } from "lucide-react";
import { RuntimeSettingType } from "@/lib/workspace/services/settings/types";
import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";

export type SettingValue = string | number | boolean;

interface SettingEntry<T> {
    descriptor: SettingDescriptor;
    source: T;
}

interface SettingsExplorerProps<T> {
    categories: SettingCategory[];
    getSettingsForCategory: (categoryKey: SettingCategory["key"]) => T[];
    describeSetting: (setting: T) => SettingDescriptor;
    getValue: (setting: T, descriptor: SettingDescriptor) => SettingValue | undefined;
    onCommit: (setting: T, descriptor: SettingDescriptor, value: SettingValue) => Promise<void>;
    selectedCategory?: SettingCategory["key"];
    onCategoryChange?: (categoryKey: SettingCategory["key"] | null) => void;
    searchQuery?: string;
    onSearchChange?: (value: string) => void;
    showSearch?: boolean;
    loading?: boolean;
    emptyStateMessage?: string;
    panelFocusHandler?: () => void;
}

function parseSettingInput(type: RuntimeSettingType, rawValue: string): SettingValue | null {
    switch (type) {
        case RuntimeSettingType.String:
            return rawValue;
        case RuntimeSettingType.Number:
        case RuntimeSettingType.Integer: {
            if (!rawValue.trim()) {
                return null;
            }
            const parsed = Number(rawValue);
            return Number.isNaN(parsed) ? null : parsed;
        }
        case RuntimeSettingType.Enum:
            return rawValue;
        case RuntimeSettingType.Boolean:
            return rawValue === "true";
        default:
            return null;
    }
}

export function SettingsExplorer<T>({
    categories,
    getSettingsForCategory,
    describeSetting,
    getValue,
    onCommit,
    selectedCategory,
    onCategoryChange,
    searchQuery,
    onSearchChange,
    showSearch = true,
    loading = false,
    emptyStateMessage = "No settings available.",
    panelFocusHandler,
}: SettingsExplorerProps<T>) {
    const [localSearch, setLocalSearch] = useState("");
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [pendingInputs, setPendingInputs] = useState<Record<string, string>>({});
    const [pendingBooleans, setPendingBooleans] = useState<Record<string, boolean>>({});

    const isSearchControlled = typeof searchQuery === "string";
    const effectiveSearch = isSearchControlled ? searchQuery! : localSearch;

    const handleSearchChange = useCallback(
        (value: string) => {
            onSearchChange?.(value);
            if (!isSearchControlled) {
                setLocalSearch(value);
            }
        },
        [isSearchControlled, onSearchChange],
    );

    const categoryEntries = useMemo(() => {
        return categories.map(category => {
            const settings = getSettingsForCategory(category.key);
            const entries: SettingEntry<T>[] = settings.map(setting => ({
                descriptor: describeSetting(setting),
                source: setting,
            }));
            return { category, entries };
        });
    }, [categories, getSettingsForCategory, describeSetting]);

    const filteredCategories = useMemo(() => {
        if (!effectiveSearch.trim()) {
            return categoryEntries;
        }
        const query = effectiveSearch.toLowerCase();
        return categoryEntries
            .map(entry => {
                const matched = entry.entries.filter(item => {
                    const { descriptor } = item;
                    const targets = [
                        descriptor.label,
                        descriptor.description,
                        descriptor.id,
                        ...(descriptor.options ?? []),
                    ];
                    return targets.some(text => text.toLowerCase().includes(query));
                });
                const categoryMatch = entry.category.label.toLowerCase().includes(query)
                    || entry.category.description.toLowerCase().includes(query);
                if (categoryMatch || matched.length > 0) {
                    return {
                        category: entry.category,
                        entries: matched.length > 0 ? matched : entry.entries,
                    };
                }
                return null;
            })
            .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    }, [categoryEntries, effectiveSearch]);

    const handleSavingState = useCallback((id: string, active: boolean) => {
        setSaving(prev => {
            const next = new Set(prev);
            if (active) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);

    const handleCommit = useCallback(
        async (entry: SettingEntry<T>, value: SettingValue) => {
            const id = entry.descriptor.id;
            setErrors(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            handleSavingState(id, true);
            try {
                await onCommit(entry.source, entry.descriptor, value);
                setPendingInputs(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                setPendingBooleans(prev => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setErrors(prev => ({ ...prev, [id]: message }));
            } finally {
                handleSavingState(id, false);
            }
        },
        [handleSavingState, onCommit],
    );

    const handleBooleanToggle = useCallback(
        (entry: SettingEntry<T>) => {
            const current = Boolean(getValue(entry.source, entry.descriptor));
            const nextValue = !current;
            setPendingBooleans(prev => ({ ...prev, [entry.descriptor.id]: nextValue }));
            handleCommit(entry, nextValue);
        },
        [getValue, handleCommit],
    );

    const handleInputChange = useCallback((id: string, nextValue: string) => {
        setPendingInputs(prev => ({ ...prev, [id]: nextValue }));
    }, []);

    const handleInputCommit = useCallback(
        (entry: SettingEntry<T>) => {
            const id = entry.descriptor.id;
            const rawValue = pendingInputs[id] ?? String(getValue(entry.source, entry.descriptor) ?? entry.descriptor.defaultValue ?? "");
            const parsed = parseSettingInput(entry.descriptor.type, rawValue);
            if (parsed === null) {
                setErrors(prev => ({ ...prev, [id]: "Please provide a valid value" }));
                return;
            }
            handleCommit(entry, parsed);
        },
        [getValue, handleCommit, pendingInputs],
    );

    const handleEnumChange = useCallback(
        (entry: SettingEntry<T>, nextValue: string) => {
            handleInputChange(entry.descriptor.id, nextValue);
            handleCommit(entry, nextValue);
        },
        [handleCommit, handleInputChange],
    );

    const renderControl = (entry: SettingEntry<T>) => {
        const { descriptor } = entry;
        const currentValue = getValue(entry.source, descriptor);
        const pendingInput = pendingInputs[descriptor.id];
        const pendingBoolean = pendingBooleans[descriptor.id];
        const displayValue = pendingInput ?? (currentValue !== undefined ? String(currentValue) : "");
        const isSaving = saving.has(descriptor.id);
        const error = errors[descriptor.id];

        switch (descriptor.type) {
            case RuntimeSettingType.Boolean: {
                const booleanValue = pendingBoolean !== undefined ? pendingBoolean : Boolean(currentValue);
                return (
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={booleanValue}
                            onCheckedChange={() => handleBooleanToggle(entry)}
                            disabled={isSaving}
                            loading={isSaving}
                            size="md"
                        />
                    </div>
                );
            }
            case RuntimeSettingType.Enum: {
                const options = descriptor.options ?? [];
                const selectOptions: SelectOption[] = options.map(option => ({
                    value: option,
                    label: option,
                }));
                return (
                    <Select
                        size="sm"
                        fullWidth
                        options={selectOptions}
                        value={displayValue}
                        onChange={(value) => handleEnumChange(entry, value as string)}
                        disabled={isSaving || options.length === 0}
                        placeholder={displayValue || "Select..."}
                    />
                );
            }
            case RuntimeSettingType.Number:
            case RuntimeSettingType.Integer:
            case RuntimeSettingType.String:
            default:
                return (
                    <Input
                        size="sm"
                        fullWidth
                        type={descriptor.type === RuntimeSettingType.String ? "text" : "number"}
                        value={displayValue}
                        onChange={(event) => handleInputChange(descriptor.id, event.target.value)}
                        onBlur={() => handleInputCommit(entry)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                (event.currentTarget as HTMLInputElement).blur();
                                handleInputCommit(entry);
                            }
                        }}
                        disabled={isSaving}
                    />
                );
        }
    };

    const renderSetting = (entry: SettingEntry<T>) => {
        const { descriptor } = entry;
        const isSaving = saving.has(descriptor.id);
        const error = errors[descriptor.id];
        if (descriptor.type === RuntimeSettingType.Boolean) {
            // boolean control already renders loader
            return (
                <div key={descriptor.id} className="px-2 py-2 transition duration-200 hover:bg-white/[0.02]">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-100">{descriptor.label}</span>
                            <span className="text-xs text-gray-500">{descriptor.description}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {renderControl(entry)}
                            {isSaving && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                        </div>
                    </div>
                    {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
                </div>
            );
        }

        return (
            <div key={descriptor.id} className="px-2 py-2 transition duration-200 hover:bg-white/[0.02]">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-100">{descriptor.label}</span>
                        <span className="text-xs text-gray-500">{descriptor.description}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {renderControl(entry)}
                        {isSaving && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                    </div>
                </div>
                {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
            </div>
        );
    };

    const categoryEntriesToRender = filteredCategories.length > 0 ? filteredCategories : [];

    const handleAccordionOpenChange = (openItems: string[]) => {
        if (!onCategoryChange) {
            return;
        }
        if (openItems.length === 0) {
            onCategoryChange(null);
            return;
        }
        const lastOpen = openItems[openItems.length - 1] as SettingCategory["key"];
        onCategoryChange(lastOpen);
    };

    const openItems = selectedCategory ? [selectedCategory] : undefined;

    return (
        <div
            className="h-full flex flex-col"
            onClick={() => panelFocusHandler?.()}
        >
            {showSearch && (
                <div className="px-3 py-2 border-b border-white/10">
                    <SearchBox
                        value={effectiveSearch}
                        onChange={handleSearchChange}
                        placeholder="Search settings..."
                        className="w-full"
                    />
                </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3">
                {loading ? (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500">
                        Loading settings...
                    </div>
                ) : categoryEntriesToRender.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-500">
                        {effectiveSearch.trim() ? "No settings match your search." : emptyStateMessage}
                    </div>
                ) : (
                    <Accordion
                        defaultOpen={openItems ?? [categoryEntriesToRender[0]?.category.key].filter(Boolean) as string[]}
                        multiple
                        className=""
                        openItems={openItems}
                        onOpenChange={handleAccordionOpenChange}
                    >
                        {categoryEntriesToRender.map(entry => (
                            <AccordionItem
                                key={entry.category.key}
                                id={entry.category.key}
                                title={entry.category.label}
                                contentClassName="px-3 py-1"
                            >
                                <div className="space-y-1">
                                    {entry.entries.length === 0 ? (
                                        <div className="px-2 py-3 text-xs text-gray-500"></div>
                                    ) : (
                                        <div className="space-y-0">
                                            {entry.entries.map(renderSetting)}
                                        </div>
                                    )}
                                </div>
                            </AccordionItem>
                        ))}
                    </Accordion>
                )}
            </div>
        </div>
    );
}
