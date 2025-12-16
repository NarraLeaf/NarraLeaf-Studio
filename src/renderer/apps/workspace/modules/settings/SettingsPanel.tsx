import { useCallback, useMemo, useState } from "react";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Input } from "@/lib/components/elements/Input";
import { Select, SelectOption } from "@/lib/components/elements/Select";
import { Switch } from "@/lib/components/elements/Switch";
import { SearchBox } from "../assets/components/SearchBox";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { SettingsService } from "@/lib/workspace/services/core/SettingsService";
import { RuntimeSettingSchema, RuntimeSettingType, TypeofSettingSchema } from "@/lib/workspace/services/settings/types";
import { RSCategories, RuntimeSettings } from "@/lib/workspace/services/settings/settings";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Loader2 } from "lucide-react";

function parseSettingInput(
    setting: RuntimeSettingSchema<RuntimeSettingType>,
    rawValue: string,
): TypeofSettingSchema<RuntimeSettingType> | null {
    switch (setting.type) {
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
        default:
            return null;
    }
}

export function SettingsPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const settingsService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<SettingsService>(Services.Settings);
    }, [context, isInitialized]);

    const [saving, setSaving] = useState<Set<string>>(new Set());
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [pendingInputs, setPendingInputs] = useState<Record<string, string>>({});
    const [pendingBooleans, setPendingBooleans] = useState<Record<string, boolean>>({});
    const [version, setVersion] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");

    const categories = useMemo<RSCategories[]>(() => {
        if (!settingsService) {
            return [];
        }
        return settingsService.getCategories();
    }, [settingsService, version]);

    const filteredCategories = useMemo(() => {
        if (!settingsService || !searchQuery.trim()) {
            return categories;
        }

        const query = searchQuery.toLowerCase().trim();
        return categories.filter(category => {
            const meta = RuntimeSettings[category];
            const settings = settingsService.getSettings(category);

            // Check if category name matches
            if (meta.name.toLowerCase().includes(query)) {
                return true;
            }

            // Check if any setting in this category matches
            return settings.some(setting =>
                setting.label.toLowerCase().includes(query) ||
                setting.description.toLowerCase().includes(query) ||
                setting.name.toLowerCase().includes(query)
            );
        });
    }, [categories, settingsService, searchQuery]);

    const getSettingValue = useCallback(
        (setting: RuntimeSettingSchema<RuntimeSettingType>): TypeofSettingSchema<RuntimeSettingType> => {
            if (!settingsService) {
                return setting.defaultValue;
            }
            return settingsService.getValue(setting.name) ?? setting.defaultValue;
        },
        [settingsService, version],
    );

    const setSavingState = useCallback((name: string, active: boolean) => {
        setSaving((prev) => {
            const next = new Set(prev);
            if (active) {
                next.add(name);
            } else {
                next.delete(name);
            }
            return next;
        });
    }, []);

    const commitValue = useCallback(
        async (setting: RuntimeSettingSchema<RuntimeSettingType>, value: TypeofSettingSchema<RuntimeSettingType>) => {
            if (!settingsService) {
                return;
            }

            setErrors((prev) => {
                const next = { ...prev };
                delete next[setting.name];
                return next;
            });
            setSavingState(setting.name, true);

            try {
                await settingsService.setValue(setting.name, value);
                setVersion((prev) => prev + 1);
                setPendingInputs((prev) => {
                    const next = { ...prev };
                    delete next[setting.name];
                    return next;
                });
                setPendingBooleans((prev) => {
                    const next = { ...prev };
                    delete next[setting.name];
                    return next;
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                setErrors((prev) => ({ ...prev, [setting.name]: message }));
                setPendingBooleans((prev) => {
                    const next = { ...prev };
                    delete next[setting.name];
                    return next;
                });
            } finally {
                setSavingState(setting.name, false);
            }
        },
        [settingsService, setSavingState],
    );

    const handleBooleanToggle = useCallback(
        (setting: RuntimeSettingSchema<RuntimeSettingType>) => {
            const current = Boolean(getSettingValue(setting));
            const newValue = !current;

            setPendingBooleans((prev) => ({ ...prev, [setting.name]: newValue }));

            commitValue(setting, newValue as TypeofSettingSchema<RuntimeSettingType>);
        },
        [commitValue, getSettingValue],
    );

    const handleInputChange = useCallback((settingName: string, nextValue: string) => {
        setPendingInputs((prev) => ({ ...prev, [settingName]: nextValue }));
    }, []);

    const handleInputCommit = useCallback(
        (setting: RuntimeSettingSchema<RuntimeSettingType>) => {
            const rawValue = pendingInputs[setting.name] ?? String(getSettingValue(setting) ?? "");
            const parsed = parseSettingInput(setting, rawValue);
            if (parsed === null) {
                setErrors((prev) => ({ ...prev, [setting.name]: "Please provide a valid value" }));
                return;
            }
            commitValue(setting, parsed);
        },
        [pendingInputs, commitValue, getSettingValue],
    );

    const handleEnumChange = useCallback(
        (setting: RuntimeSettingSchema<RuntimeSettingType>, next: string) => {
            handleInputChange(setting.name, next);
            commitValue(setting, next as TypeofSettingSchema<RuntimeSettingType>);
        },
        [commitValue, handleInputChange],
    );

    const focusPanel = useCallback(() => {
        if (!context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
    }, [context, panelId]);

    const renderSettingRow = (setting: RuntimeSettingSchema<RuntimeSettingType>) => {
        const currentValue = getSettingValue(setting);
        const pendingValue = pendingInputs[setting.name];
        const pendingBoolean = pendingBooleans[setting.name];
        const displayValue = pendingValue ?? (currentValue !== undefined ? String(currentValue) : "");
        const isSaving = saving.has(setting.name);
        const error = errors[setting.name];

        const renderControl = () => {
            switch (setting.type) {
                case RuntimeSettingType.Boolean: {
                    const booleanValue = pendingBoolean !== undefined ? pendingBoolean : Boolean(currentValue);
                    return (
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={booleanValue}
                                onCheckedChange={() => handleBooleanToggle(setting)}
                                disabled={isSaving}
                                loading={isSaving}
                                size="md"
                            />
                        </div>
                    );
                }
                case RuntimeSettingType.Enum: {
                    const enumSetting = setting as RuntimeSettingSchema<RuntimeSettingType.Enum>;
                    const options: string[] = enumSetting.options ?? [];
                    const selectOptions: SelectOption[] = options.map(option => ({
                        value: option,
                        label: option
                    }));

                    return (
                        <Select
                            size="sm"
                            fullWidth
                            options={selectOptions}
                            value={displayValue}
                            onChange={(value) => handleEnumChange(setting, value as string)}
                            disabled={isSaving || options.length === 0}
                            placeholder={displayValue || "N/A"}
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
                            type={setting.type === RuntimeSettingType.String ? "text" : "number"}
                            value={displayValue}
                            onChange={(event) => handleInputChange(setting.name, event.target.value)}
                            onBlur={() => handleInputCommit(setting)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                    handleInputCommit(setting);
                                }
                            }}
                            disabled={isSaving}
                        />
                    );
            }
        };

        return (
            <div
                key={setting.name}
                className="px-2 py-2 transition duration-200 hover:bg-white/[0.02]"
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-100">{setting.label}</span>
                        <span className="text-xs text-gray-500">{setting.description}</span>
                    </div>

                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        {renderControl()}
                        {isSaving && <Loader2 className="w-3 h-3 text-primary animate-spin" />}
                    </div>
                </div>

                {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
            </div>
        );
    };

    const defaultCategory = categories.length > 0 ? [categories[0]] : [];

    return (
        <div className="h-full flex flex-col" data-panel-id={panelId} onClick={focusPanel}>
            <div className="px-3 py-2 border-b border-white/10 space-y-3">
                <SearchBox
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search settings..."
                    className="w-full"
                />
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
                {!settingsService ? (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500">
                        Loading settings...
                    </div>
                ) : filteredCategories.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-500">
                        {searchQuery.trim() ? "No settings match your search." : "No runtime settings defined yet."}
                    </div>
                ) : (
                    <Accordion defaultOpen={defaultCategory} multiple className="">
                        {filteredCategories.map((category) => {
                            const meta = RuntimeSettings[category];
                            let settings = settingsService.getSettings(category);
                            if (searchQuery.trim()) {
                                const query = searchQuery.toLowerCase().trim();
                                settings = settings.filter(setting =>
                                    setting.label.toLowerCase().includes(query) ||
                                    setting.description.toLowerCase().includes(query) ||
                                    setting.name.toLowerCase().includes(query)
                                );
                            }
                            return (
                                <AccordionItem
                                    key={category}
                                    id={category}
                                    title={meta.name}
                                    contentClassName="px-3 py-1"
                                >
                                    <div className="space-y-1">

                                        {settings.length === 0 ? (
                                            <div className="px-2 py-3 text-xs text-gray-500"></div>
                                        ) : (
                                            <div className="space-y-0">
                                                {settings.map(renderSettingRow)}
                                            </div>
                                        )}
                                    </div>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                )}
            </div>
        </div>
    );
}

