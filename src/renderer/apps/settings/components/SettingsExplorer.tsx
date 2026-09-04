import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/lib/components/elements/Input";
import { Select, SelectOption } from "@/lib/components/elements/Select";
import { Slider } from "@/lib/components/elements/Slider";
import { Switch } from "@/lib/components/elements/Switch";
import { Button } from "@/lib/components/elements/Button";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { Loader2, RotateCcw } from "lucide-react";
import { SettingValueType } from "@/lib/settings/types";
import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";
import { filterCategoryEntries } from "@/lib/settings/searchSettings";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SETTING_PANELS } from "../panels";
import { SettingColorPicker } from "./SettingColorPicker";
import { SettingFontPicker } from "./SettingFontPicker";
import { SettingSourcePicker } from "./SettingSourcePicker";
import { SETTING_CONTROL_WIDTH } from "./settingControlWidth";
import {
    SETTINGS_HIGHLIGHT_RING,
    SettingsHighlightContext,
    type SettingsHighlightState,
} from "./settingsHighlight";
import { ACCENT_COLOR_DEFAULT, ACCENT_SWATCHES, normalizeHexColor } from "@shared/constants/accent";

/** How long the tint on a navigated-to row lasts. Long enough to be seen, short enough to be a hint. */
const ROW_FLASH_MS = 1600;

/**
 * How long a `Custom` panel wears its mark.
 *
 * Longer than the row tint. A row is where the author's eye already is - they clicked it in
 * the tree beside it - while a panel highlight arrives from another window, so the first of
 * those seconds is spent on a window appearing and being read.
 */
const PANEL_HIGHLIGHT_MS = 4000;

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
    /**
     * Whether this row holds something other than its default. Drives the per-row reset, which
     * appears on hover and only where there is something to undo - a permanent reset control on
     * every row would put thirty of them on screen to serve the two an author changed.
     */
    isModified?: (setting: T, descriptor: SettingDescriptor) => boolean;
    /** Put this row back to its default. Absent means no per-row reset is offered at all. */
    onReset?: (setting: T, descriptor: SettingDescriptor) => Promise<void>;
    selectedCategory?: SettingCategory["key"];
    /** A specific row to scroll to and flash; takes precedence over `selectedCategory`. */
    selectedSettingId?: string;
    /** Bump to re-run the scroll even when the selection itself did not change. */
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
        case SettingValueType.Color:
        case SettingValueType.Font:
        case SettingValueType.Source:
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
    isModified,
    onReset,
    selectedCategory,
    selectedSettingId,
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
    /** The row a navigation click just landed on; cleared on a timer so the tint is a hint, not a state. */
    const [flashedSettingId, setFlashedSettingId] = useState<string | null>(null);
    /** The `Custom` panel another window opened Settings at, marked until its own timer runs out. */
    const [highlightedPanelId, setHighlightedPanelId] = useState<string | null>(null);
    /** Whether that panel put the mark on a control of its own. See `settingsHighlight`. */
    const [panelClaimedHighlight, setPanelClaimedHighlight] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const categoryRefs = useRef<Record<string, HTMLElement | null>>({});
    const settingRefs = useRef<Record<string, HTMLElement | null>>({});

    const isSearchControlled = typeof searchQuery === "string";
    const effectiveSearch = isSearchControlled ? searchQuery! : localSearch;

    // One object for the one panel that can be highlighted at a time, so the hook reading it
    // does not re-claim on every render of this explorer.
    const claimPanelHighlight = useCallback(() => {
        setPanelClaimedHighlight(true);
        return () => setPanelClaimedHighlight(false);
    }, []);
    const panelHighlightState = useMemo<SettingsHighlightState>(
        () => ({ highlighted: true, claim: claimPanelHighlight }),
        [claimPanelHighlight],
    );

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
        return categoryEntries
            .map(entry => {
                const matched = filterCategoryEntries(entry.category, entry.entries, effectiveSearch);
                return matched ? { category: entry.category, entries: matched } : null;
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

    /**
     * The write a row is still waiting on, per row, and how many have been asked for.
     *
     * A row does not refuse a second choice while the first is in flight - see `renderControl` for
     * why not - so two things have to be true without the author having to wait. The chain keeps the
     * writes for one row in the order they were made, so the last thing chosen is the last thing
     * stored; the counter says which of them is still the latest, so a write that lands after a
     * newer one neither clears the newer pending value nor puts the row back to `saved`.
     */
    const commitChains = useRef(new Map<string, Promise<void>>());
    const commitCounts = useRef(new Map<string, number>());

    const handleCommit = useCallback(
        (entry: SettingEntry<T>, value: SettingValue) => {
            const id = entry.descriptor.id;
            const token = (commitCounts.current.get(id) ?? 0) + 1;
            commitCounts.current.set(id, token);
            const isLatest = () => commitCounts.current.get(id) === token;
            setErrors(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            handleSavingState(id, true);
            const run = (commitChains.current.get(id) ?? Promise.resolve()).then(async () => {
                try {
                    await onCommit(entry.source, entry.descriptor, value);
                    if (!isLatest()) {
                        return;
                    }
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
                    if (isLatest()) {
                        handleSavingState(id, false);
                    }
                }
            });
            commitChains.current.set(id, run);
            return run;
        },
        [handleSavingState, onCommit],
    );

    const handleBooleanToggle = useCallback(
        (entry: SettingEntry<T>) => {
            // A disabled switch is still a switch: it keeps its keyboard focus and, on some
            // platforms, still reports a click. Refusing the write here rather than only in the
            // control is what makes the row's reason ("not available on this system") true.
            if (entry.descriptor.disabled) {
                return;
            }
            const id = entry.descriptor.id;
            // What the switch is showing, which is not the stored value while a write is in flight.
            // Reading the stored one would make a second toggle write the value that is already on
            // its way, and leave the switch showing the opposite of what it just did.
            const shown = pendingBooleans[id];
            const nextValue = !(shown !== undefined ? shown : Boolean(getValue(entry.source, entry.descriptor)));
            setPendingBooleans(prev => ({ ...prev, [id]: nextValue }));
            handleCommit(entry, nextValue);
        },
        [getValue, handleCommit, pendingBooleans],
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

    /**
     * Put a row back to its default and forget what this session had it showing.
     *
     * The stored value is only half of what a row displays: text typed into a field lives in
     * `pendingInputs` until it is committed. Resetting without clearing it leaves the old text on
     * screen, which is a row saying it is at its default and showing something else.
     */
    const handleResetRow = useCallback(
        async (entry: SettingEntry<T>) => {
            const id = entry.descriptor.id;
            setPendingInputs(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
            });
            await onReset?.(entry.source, entry.descriptor);
        },
        [onReset],
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
                            // The one place an in-flight write still closes a control. An Action runs
                            // something with a side effect of its own - a cache cleared, a file
                            // written - and starting a second one before the first has answered is
                            // not a change of mind, it is the same thing happening twice.
                            disabled={isSaving || descriptor.disabled}
                            onClick={() =>
                                descriptor.skipConfirm
                                    ? handleInvokeAction(entry)
                                    : setActionConfirming(descriptor.id, true)
                            }
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
                        {/* No `loading`: a loading Switch refuses the click as firmly as a disabled
                            one does, which would put the swallow back on this row. The write in
                            flight is shown by the row's own spinner, beside the control. */}
                        <Switch
                            checked={booleanValue}
                            onCheckedChange={() => handleBooleanToggle(entry)}
                            disabled={descriptor.disabled}
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
                    <div className="flex w-full items-center gap-3">
                        <Slider
                            value={Number.isFinite(sliderValue) ? sliderValue : Number(descriptor.defaultValue)}
                            min={min}
                            max={max}
                            step={descriptor.step ?? 1}
                            // Track the drag locally and only persist on release: committing
                            // per pixel would fire a write + a broadcast to every window on
                            // every frame.
                            onValueChange={(next) => handleInputChange(descriptor.id, String(next))}
                            onValueCommit={(next) => handleCommit(entry, next)}
                            aria-label={descriptor.label}
                            className="min-w-0 flex-1"
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
                        disabled={options.length === 0}
                        placeholder={descriptor.optionLabels?.[displayValue] ?? displayValue}
                    />
                );
            }
            case SettingValueType.Source: {
                return (
                    <div className="w-full">
                        <SettingSourcePicker
                            value={displayValue}
                            presets={descriptor.options ?? []}
                            presetLabels={descriptor.optionLabels}
                            onChange={(next) => handleEnumChange(entry, next)}
                            disabled={descriptor.disabled}
                            ariaLabel={descriptor.label}
                        />
                    </div>
                );
            }
            case SettingValueType.Font: {
                return (
                    <div className="w-full">
                        <SettingFontPicker
                            value={displayValue}
                            presets={descriptor.options ?? []}
                            presetLabels={descriptor.optionLabels}
                            presetStacks={descriptor.optionFontStacks}
                            onChange={(next) => handleEnumChange(entry, next)}
                            ariaLabel={descriptor.label}
                        />
                    </div>
                );
            }
            case SettingValueType.Color: {
                // A row of swatches rather than a dropdown: the option list is short and the
                // thing being chosen is the color itself, which no label describes as well as
                // the color does. The name still reaches a screen reader through the label.
                const options = descriptor.options ?? [];
                // Anything that is not one of the preset ids is a custom hex, which puts the
                // selection on the picker chip instead of a swatch.
                const isCustom = !options.includes(displayValue);
                // Falling back to the brand anchor, not white: before global state resolves there is
                // no selection yet, and seeding the picker with white would commit white on open.
                const effectiveHex = (isCustom ? normalizeHexColor(displayValue) : descriptor.optionColors?.[displayValue])
                    ?? ACCENT_SWATCHES[ACCENT_COLOR_DEFAULT];
                return (
                    // Wraps: at a high UI zoom the row this sits in is narrower than the swatches
                    // are long. Unwrapped it just ran off the right edge, taking the picker chip
                    // (the way to any OTHER colour) with it.
                    <div className="flex flex-wrap items-center justify-end gap-1.5" role="radiogroup" aria-label={descriptor.label}>
                        {options.map(option => {
                            const selected = option === displayValue;
                            const name = descriptor.optionLabels?.[option] ?? option;
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={name}
                                    data-tip={name}
                                    onClick={() => handleEnumChange(entry, option)}
                                    // The ring sits outside the swatch so the color the user is
                                    // judging is never overlaid by the selection indicator.
                                    className={`h-5 w-5 rounded-full transition duration-150 disabled:opacity-50 ${
                                        selected
                                            ? "ring-2 ring-offset-2 ring-fg/60 ring-offset-surface"
                                            : "ring-1 ring-inset ring-edge-strong hover:scale-110"
                                    }`}
                                    style={{ backgroundColor: descriptor.optionColors?.[option] }}
                                />
                            );
                        })}
                        {descriptor.allowCustomColor && (
                            <>
                                <span className="mx-0.5 h-4 w-px bg-edge" aria-hidden />
                                <SettingColorPicker
                                    hex={effectiveHex}
                                    selected={isCustom}
                                    label={t("settings.customColor")}
                                    // Live preview while dragging, one write on release: a
                                    // commit persists and broadcasts to every window, and the
                                    // picker's map emits on every pointer move.
                                    onPreview={descriptor.onPreview}
                                    onCommit={(hex) => handleEnumChange(entry, hex)}
                                />
                            </>
                        )}
                    </div>
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
                        // A row whose value is decided elsewhere is closed rather than merely
                        // ignored: the descriptor's own description has already been replaced
                        // with the reason, and a field that takes typing it will not keep is
                        // the one thing worse than a field that cannot be typed in.
                        disabled={descriptor.disabled}
                    />
                );
                if (!descriptor.unit) {
                    return input;
                }
                return (
                    // The unit gets a fixed gutter rather than its own natural width, so the field
                    // beside it ends where every other unit-bearing field does. Sized to hold the
                    // longest of them (`min`); letting each size itself left the `ms` field and the
                    // `%` field one row below it nine pixels out of line with each other.
                    <div className="flex w-full items-center gap-2">
                        <div className="min-w-0 flex-1">{input}</div>
                        <span className="w-7 shrink-0 text-xs text-fg-muted">{descriptor.unit}</span>
                    </div>
                );
            }
        }
    };

    /**
     * A Custom entry is its own editing surface, so it gets the full width with only its name
     * above it — a label/control row cannot hold a table, and a description under the heading
     * would just repeat what the panel's own chrome already says.
     *
     * It is also the one row a highlight can be sent to that a tint does not answer: the author
     * pressed something in another window to be put in front of one control inside this panel.
     * The panel is handed that fact and can ring the control itself; where it does not, the ring
     * goes around the block, which still says which of these surfaces was meant.
     */
    const renderPanel = (entry: SettingEntry<T>) => {
        const { descriptor } = entry;
        const Panel = descriptor.panel ? SETTING_PANELS[descriptor.panel] : undefined;
        if (!Panel) {
            return null;
        }
        const highlighted = highlightedPanelId === descriptor.id;
        const marksItsOwnBlock = highlighted && !panelClaimedHighlight;
        return (
            <div
                key={descriptor.id}
                ref={(node) => setSettingRef(descriptor.id, node)}
                data-settings-panel={descriptor.id}
                data-settings-highlight={marksItsOwnBlock ? "on" : undefined}
                className={cn(
                    "rounded-md px-2 py-2 transition duration-500",
                    flashedSettingId === descriptor.id && "bg-fill",
                    marksItsOwnBlock && SETTINGS_HIGHLIGHT_RING,
                )}
            >
                <span className="text-sm font-medium text-fg">{descriptor.label}</span>
                <div className="mt-2">
                    {highlighted ? (
                        <SettingsHighlightContext.Provider value={panelHighlightState}>
                            <Panel />
                        </SettingsHighlightContext.Provider>
                    ) : (
                        <Panel />
                    )}
                </div>
            </div>
        );
    };

    const renderSetting = (entry: SettingEntry<T>) => {
        const { descriptor } = entry;
        const isSaving = saving.has(descriptor.id);
        const error = errors[descriptor.id];
        if (descriptor.type === SettingValueType.Custom) {
            return renderPanel(entry);
        }
        // Actions store nothing, so there is nothing of theirs to put back.
        const canReset =
            Boolean(onReset) &&
            descriptor.type !== SettingValueType.Action &&
            Boolean(isModified?.(entry.source, descriptor));
        return (
            <div
                key={descriptor.id}
                ref={(node) => setSettingRef(descriptor.id, node)}
                className={`group/setting rounded-md px-2 py-2 transition duration-200 hover:bg-fill-subtle ${flashedSettingId === descriptor.id ? "bg-fill" : ""}`}
            >
                {/* Wraps rather than clips. The label used to be `flex-1 min-w-0` (basis 0), so it
                    shrank away to nothing and the row never wrapped — past a point the control simply
                    ran off the right edge, and this pane has no horizontal scroll to go after it. At
                    200% UI zoom that put the theme dropdown, the reduced-motion switch and the accent
                    swatches out of reach, including the zoom field needed to undo it. A real basis
                    makes the control drop onto its own line instead; `ml-auto` keeps it right-aligned
                    there, where `justify-between` alone would push a lone item back to the left. */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0 grow basis-64">
                        <span className="flex items-center gap-1 text-sm font-medium text-fg">
                            {descriptor.label}
                            {/* Hover-revealed and only where there is something to undo; see
                                `isModified`. `focus-within` on the row would be the keyboard
                                equivalent, but the button itself carries focus-visible, so it
                                becomes reachable by Tab without a second rule. */}
                            {canReset && (
                                <button
                                    type="button"
                                    data-tip={t("settings.resetToDefault")}
                                    aria-label={t("settings.resetToDefault")}
                                    onClick={() => void handleResetRow(entry)}
                                    className="rounded-md p-0.5 text-fg-subtle opacity-0 transition-opacity hover:bg-fill hover:text-fg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50 group-hover/setting:opacity-100"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                </button>
                            )}
                        </span>
                        <span className="text-xs text-fg-subtle">{descriptor.description}</span>
                    </div>
                    {/* One width for every row - see `SETTING_CONTROL_WIDTH`. Fields fill it; a switch,
                        an action button or the accent strip keeps its own size and sits at the right
                        of it. `max-w-full` rather than the fixed width alone: once this column has
                        wrapped onto its own line it must be allowed to stay inside the pane, or a
                        wide control overflows to the right exactly as it did before the wrap. */}
                    <div className={cn("flex flex-col items-end gap-1 ml-auto max-w-full", SETTING_CONTROL_WIDTH)}>
                        {renderControl(entry)}
                        {isSaving && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                    </div>
                </div>
                {error && <p className="mt-1 text-xs text-danger">{error}</p>}
            </div>
        );
    };

    const categoryEntriesToRender = filteredCategories.length > 0 ? filteredCategories : [];

    // Scroll to whatever the navigation last pointed at: a specific row when one was named
    // (opening Settings straight at the shortcut table), else the top of its category.
    useEffect(() => {
        if (loading) {
            return;
        }
        const target = selectedSettingId
            ? settingRefs.current[selectedSettingId]
            : selectedCategory
                ? categoryRefs.current[selectedCategory]
                : null;
        const container = scrollContainerRef.current;
        if (!container || !target) {
            return;
        }
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const nextTop = container.scrollTop + targetRect.top - containerRect.top - 12;
        container.scrollTo({
            top: Math.max(0, nextTop),
            behavior: "smooth",
        });
    }, [loading, selectedCategory, selectedSettingId, selectedCategoryScrollSignal, effectiveSearch]);

    // Tint the row that was navigated to, so a jump into a long category is visibly *at* something.
    // A panel keeps its mark for longer and on its own timer - see `PANEL_HIGHLIGHT_MS`. Both are
    // re-armed by the scroll signal, so asking Settings for the same thing twice marks it again
    // rather than doing nothing because the selection did not change.
    useEffect(() => {
        if (loading || !selectedSettingId) {
            return;
        }
        setFlashedSettingId(selectedSettingId);
        setHighlightedPanelId(selectedSettingId);
        const tint = window.setTimeout(() => setFlashedSettingId(null), ROW_FLASH_MS);
        const mark = window.setTimeout(() => setHighlightedPanelId(null), PANEL_HIGHLIGHT_MS);
        return () => {
            window.clearTimeout(tint);
            window.clearTimeout(mark);
        };
    }, [loading, selectedSettingId, selectedCategoryScrollSignal]);

    const setCategoryRef = useCallback((categoryKey: SettingCategory["key"], node: HTMLElement | null) => {
        categoryRefs.current[categoryKey] = node;
    }, []);

    const setSettingRef = useCallback((settingId: string, node: HTMLElement | null) => {
        settingRefs.current[settingId] = node;
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
