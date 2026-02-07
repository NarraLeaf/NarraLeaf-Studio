import { useCallback, useMemo } from "react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { SettingsService } from "@/lib/workspace/services/core/SettingsService";
import { RuntimeSettingSchema, RuntimeSettingType, TypeofSettingSchema } from "@/lib/workspace/services/settings/types";
import { RSCategories, RuntimeSettings } from "@/lib/workspace/services/settings/settings";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { SettingsExplorer } from "@/apps/settings/components/SettingsExplorer";
import { SettingCategory, SettingDescriptor } from "@/lib/settings/models";

export function SettingsPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const settingsService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<SettingsService>(Services.Settings);
    }, [context, isInitialized]);

    const categories = useMemo(() => {
        if (!settingsService) {
            return [];
        }
        return settingsService.getCategories();
    }, [settingsService]);

    const describeSetting = useCallback(
        (setting: RuntimeSettingSchema<RuntimeSettingType>): SettingDescriptor => ({
            id: setting.name,
            type: setting.type,
            label: setting.label,
            description: setting.description,
            defaultValue: setting.defaultValue,
            options: ("options" in setting ? setting.options : undefined),
        }),
        [],
    );

    const getValue = useCallback(
        (setting: RuntimeSettingSchema<RuntimeSettingType>, descriptor: SettingDescriptor) => {
            if (!settingsService) {
                return descriptor.defaultValue;
            }
            return settingsService.getValue(setting.name) ?? descriptor.defaultValue;
        },
        [settingsService],
    );

    const commitValue = useCallback(
        async (setting: RuntimeSettingSchema<RuntimeSettingType>, _descriptor: SettingDescriptor, value: string | number | boolean) => {
            if (!settingsService) {
                return;
            }
            await settingsService.setValue(setting.name, value as TypeofSettingSchema<RuntimeSettingType>);
        },
        [settingsService],
    );

    const focusPanel = useCallback(() => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
    }, [context, panelId]);

    const categoryMetadata = useMemo<SettingCategory[]>(() => {
        return categories.map((categoryKey, index) => {
            const meta = RuntimeSettings[categoryKey];
            return {
                key: categoryKey,
                label: meta.name,
                description: meta.description,
                order: index,
            };
        });
    }, [categories]);

    if (!settingsService) {
        return (
            <div className="flex h-full items-center justify-center text-xs text-gray-500" data-panel-id={panelId} onClick={focusPanel}>
                Loading settings...
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col" data-panel-id={panelId} onClick={focusPanel}>
            <SettingsExplorer
                categories={categoryMetadata}
                getSettingsForCategory={(category) => settingsService.getSettings(category as RSCategories)}
                describeSetting={describeSetting}
                getValue={(setting, descriptor) => getValue(setting as RuntimeSettingSchema<RuntimeSettingType>, descriptor)}
                onCommit={(setting, descriptor, value) =>
                    commitValue(setting as RuntimeSettingSchema<RuntimeSettingType>, descriptor, value)
                }
                emptyStateMessage="No runtime settings defined yet."
                panelFocusHandler={focusPanel}
            />
        </div>
    );
}
