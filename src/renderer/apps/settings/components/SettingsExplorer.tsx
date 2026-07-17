import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/lib/components/elements/Input";
import { Select, SelectOption } from "@/lib/components/elements/Select";
import { Slider } from "@/lib/components/elements/Slider";
import { Switch } from "@/lib/components/elements/Switch";
import { Button } from "@/lib/components/elements/Button";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { Loader2 } from "lucide-react";
import { SettingValueType } from "@/lib/settings/types";
import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";
import { useTranslation } from "@/lib/i18n";

/** `null` is the Action type's stand-in: it renders a button and stores nothing. */
export type SettingValue = string | number | boolean | null;

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
    /** Runs an `Action` entry once the user has confirmed it. Required if any entry is an Action. */
    onInvokeAction?: (setting: T, descriptor: SettingDescriptor) => Promise<void>;
    selectedCategory?: SettingCategory["key"];
    selectedCategoryScrollSignal?: number;
    searchQuery?: string;
    onSearchChange?: (value: string) => void;
    showSearch?: boolean;
    loading?: boolean;
    emptyStateMessage?: string;
    panelFocusHandler?: () => void;
}

function parseSettingInput(type: SettingValueType, rawValue: string): SettingValue | null {
    switch (type) {
        case SettingValueType.String:
            return rawValue;
        case SettingValueType.Number:
        case SettingValueType.Integer:
        case SettingValueType.Slider: {
            if (!rawValue.trim()) {
                return null;
            }
            const parsed = Number(rawValue);
            return Number.isNaN(parsed) ? null : parsed;
        }
        case SettingValueType.Enum:
            return rawValue;
        case SettingValueType.Boolean:
            return rawValue === "true";
        default:
            return null;
    }
}

/**
 * Bring a typed number onto the descriptor's range before it is stored. Without
 * this a hand-typed 500% would persist as 500 and only get clamped where it is
 * applied, leaving the field showing a value the app is not using.
 */
function normalizeSettingNumber(descriptor: SettingDescriptor, value: number): number {
    let next = descriptor.type === SettingValueType.Number ? value : Math.round(value);
    if (descriptor.min !== undefined) {
        next = Math.max(descriptor.min, next);
    }
    if (descriptor.max !== undefined) {
        next = Math.min(descriptor.max, next);
    }
    return next;
}

export function SettingsExplorer<T>({
    categories,
    getSettingsForCategory,
    describeSetting,
    getValue,
    onCommit,
    onInvokeAction,
    selectedCategory,
    selectedCategoryScrollSignal,
    searchQuery,
    onSearchChange,
    showSearch = true,
    loading = false,
    emptyStateMessage,
    panelFocusHandler,
}: SettingsExplorerProps<T>) {
    const { t } = useTranslation();
    const [localSearch, setLocalSearch] = useState("");
    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [pendingInputs, setPendingInputs] = useState<Record<string, string>>({});
    const [pendingBooleans, setPendingBooleans] = useState<Record<string, boolean>>({});
    /** Action ids awaiting their second, confirming click. */
    const [confirmingActions, setConfirmingActions] = useState<Set<string>>(new Set());
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const categoryRefs = useRef<Record<string, HTMLElement | null>>({});

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

    const setActionConfirming = useCallback((id: string, active: boolean) => {
        setConfirmingActions(prev => {
            const next = new Set(prev);
            if (active) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    }, []);

    /**
     * Run a confirmed Action. Unlike `handleCommit` this persists nothing itself — the entry's own
     * handler owns whatever it touches — so all this layer contributes is the pending/error chrome.
     */
    const handleInvokeAction = useCallback(
        async (entry: SettingEntry<T>) => {
            const id = entry.descriptor.id;
            setActionConfirming(id, false);
            setErrors(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            handleSavingState(id, true);
            try {
                await onInvokeAction?.(entry.source, entry.descriptor);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setErrors(prev => ({ ...prev, [id]: message }));
            } finally {
                handleSavingState(id, false);
            }
        },
        [handleSavingState, onInvokeAction, setActionConfirming],
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
                setErrors(prev => ({ ...prev, [id]: t("settings.invalidValue") }));
                return;
            }
            const value = typeof parsed === "number" ? normalizeSettingNumber(entry.descriptor, parsed) : parsed;
            if (typeof value === "number" && String(value) !== rawValue) {
                // Show the clamped/rounded value straight away; the commit below drops
                // the pending input once it lands, so the field would otherwise keep
                // displaying what was typed until the write resolves.
                setPendingInputs(prev => ({ ...prev, [id]: String(value) }));
            }
            handleCommit(entry, value);
        },
        [getValue, handleCommit, pendingInputs, t],
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
            case SettingValueType.Action: {
                // Two-step inline confirm rather than a modal: the settings window hosts no dialog
                // container, and an in-place "are you sure" reads better in a settings row anyway.
                const isConfirming = confirmingActions.has(descriptor.id);
                if (!isConfirming) {
                    return (
                        <Button
                            size="sm"
                            variant={descriptor.danger ? "danger" : "secondary"}
                            disabled={isSaving}
                            onClick={() => setActionConfirming(descriptor.id, true)}
                        >
                            {descriptor.actionLabel ?? descriptor.label}
                        </Button>
                    );
                }
                return (
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={isSaving}
                            onClick={() => setActionConfirming(descriptor.id, false)}
                        >
                            {t("common.cancel")}
                        </Button>
                        <Button
                            size="sm"
                            variant={descriptor.danger ? "danger" : "primary"}
                            disabled={isSaving}
                            onClick={() => handleInvokeAction(entry)}
                        >
                            {descriptor.confirmLabel ?? t("common.confirm")}
                        </Button>
                    </div>
                );
            }
            case SettingValueType.Boolean: {
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
            case SettingValueType.Slider: {
                const min = descriptor.min ?? 0;
                const max = descriptor.max ?? 100;
                const sliderValue = Number(displayValue);
                return (
                    <div className="flex items-center gap-3">
                        <Slider
                            value={Number.isFinite(sliderValue) ? sliderValue : Number(descriptor.defaultValue)}
                            min={min}
                            max={max}
                            step={descriptor.step ?? 1}
                            disabled={isSaving}
                            // Track the drag locally and only persist on release: committing
                            // per pixel would fire a write + a broadcast to every window on
                            // every frame.
                            onValueChange={(next) => handleInputChange(descriptor.id, String(next))}
                            onValueCommit={(next) => handleCommit(entry, next)}
                            aria-label={descriptor.label}
                            className="w-40"
                        />
                        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                            {displayValue}{descriptor.unit ?? ""}
                        </span>
                    </div>
                );
            }
            case SettingValueType.Enum: {
                const options = descriptor.options ?? [];
                const selectOptions: SelectOption[] = options.map(option => ({
                    value: option,
                    label: descriptor.optionLabels?.[option] ?? option,
                }));
                return (
                    <Select
                        size="sm"
                        fullWidth
                        options={selectOptions}
                        value={displayValue}
                        onChange={(value) => handleEnumChange(entry, value as string)}
                        disabled={isSaving || options.length === 0}
                        placeholder={descriptor.optionLabels?.[displayValue] ?? displayValue}
                    />
                );
            }
            case SettingValueType.Number:
            case SettingValueType.Integer:
            case SettingValueType.String:
            default: {
                const isNumeric = descriptor.type !== SettingValueType.String;
                const input = (
                    <Input
                        size="sm"
                        fullWidth
                        type={isNumeric ? "number" : "text"}
                        min={isNumeric ? descriptor.min : undefined}
                        max={isNumeric ? descriptor.max : undefined}
                        step={isNumeric ? descriptor.step : undefined}
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
                if (!descriptor.unit) {
                    return input;
                }
                return (
                    <div className="flex items-center gap-2">
                        <div className="w-24">{input}</div>
                        <span className="shrink-0 text-xs text-fg-muted">{descriptor.unit}</span>
                    </div>
                );
            }
        }
    };

    const renderSetting = (entry: SettingEntry<T>) => {
        const { descriptor } = entry;
        const isSaving = saving.has(descriptor.id);
        const error = errors[descriptor.id];
        if (descriptor.type === SettingValueType.Boolean) {
            // boolean control already renders loader
            return (
                <div key={descriptor.id} className="px-2 py-2 transition duration-200 hover:bg-fill-subtle">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <span className="text-sm font-medium text-fg">{descriptor.label}</span>
                            <span className="text-xs text-fg-subtle">{descriptor.description}</span>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {renderControl(entry)}
                            {isSaving && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                        </div>
                    </div>
                    {error && <p className="mt-1 text-xs text-danger">{error}</p>}
                </div>
            );
        }

        return (
            <div key={descriptor.id} className="px-2 py-2 transition duration-200 hover:bg-fill-subtle">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span className="text-sm font-medium text-fg">{descriptor.label}</span>
                        <span className="text-xs text-fg-subtle">{descriptor.description}</span>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {renderControl(entry)}
                        {isSaving && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                    </div>
                </div>
                {error && <p className="mt-1 text-xs text-danger">{error}</p>}
            </div>
        );
    };

    const categoryEntriesToRender = filteredCategories.length > 0 ? filteredCategories : [];

    useEffect(() => {
        if (!selectedCategory || loading) {
            return;
        }
        const container = scrollContainerRef.current;
        const section = categoryRefs.current[selectedCategory];
        if (!container || !section) {
            return;
        }
        const containerRect = container.getBoundingClientRect();
        const sectionRect = section.getBoundingClientRect();
        const nextTop = container.scrollTop + sectionRect.top - containerRect.top - 12;
        container.scrollTo({
            top: Math.max(0, nextTop),
            behavior: "smooth",
        });
    }, [loading, selectedCategory, selectedCategoryScrollSignal, effectiveSearch]);

    const setCategoryRef = useCallback((categoryKey: SettingCategory["key"], node: HTMLElement | null) => {
        categoryRefs.current[categoryKey] = node;
    }, []);

    return (
        <div
            className="h-full flex flex-col"
            onClick={() => panelFocusHandler?.()}
        >
            {showSearch && (
                <div className="px-3 py-2 border-b border-edge">
                    <SearchBox
                        value={effectiveSearch}
                        onChange={handleSearchChange}
                        placeholder={t("settings.searchPlaceholder")}
                        className="w-full"
                    />
                </div>
            )}

            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
                        {t("settings.loading")}
                    </div>
                ) : categoryEntriesToRender.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-fg-subtle">
                        {effectiveSearch.trim() ? t("settings.noResults") : (emptyStateMessage ?? t("settings.empty"))}
                    </div>
                ) : (
                    <div className="space-y-5 px-3 py-3">
                        {categoryEntriesToRender.map(entry => (
                            <section
                                key={entry.category.key}
                                ref={(node) => setCategoryRef(entry.category.key, node)}
                                className="scroll-mt-3"
                            >
                                <div className="mb-2 border-b border-edge px-2 pb-2">
                                    <h2 className="text-sm font-semibold text-fg">{entry.category.label}</h2>
                                </div>
                                <div className="space-y-0">
                                    {entry.entries.map(renderSetting)}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
