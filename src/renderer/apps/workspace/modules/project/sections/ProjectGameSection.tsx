/**
 * Project → Game: how the shipped game behaves for the player, as opposed to
 * how it is packaged (Settings) or what it is made of (Assets, Dependencies).
 *
 * Automatic saving is the first tenant. It lives here rather than behind a
 * plugin or a sidebar panel of its own because it is the same class of thing as
 * "encrypt assets" or "mobile orientation": authored once, travels with the
 * project, and changes what the player experiences.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    AUTO_SAVE_INTERVAL_SECONDS_MAX,
    AUTO_SAVE_INTERVAL_SECONDS_MIN,
    AUTO_SAVE_SLOTS_MAX,
    AUTO_SAVE_SLOTS_MIN,
    normalizeAutoSaveConfiguration,
    type AutoSaveConfiguration,
} from "@/lib/workspace/project/configuration";
import { SettingRow, SettingShell } from "./settingRows";
import { NumberField } from "./NumberField";
import type { ProjectSectionProps } from "./types";

export function ProjectGameSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    // SettingRow reads the freeze itself; the two number fields sit in bare shells and need their own.
    const freeze = useFreezeGuard();
    const [autoSave, setAutoSave] = useState<AutoSaveConfiguration>(
        () => normalizeAutoSaveConfiguration(config.app?.autoSave),
    );
    const [saving, setSaving] = useState<keyof AutoSaveConfiguration | null>(null);

    const commit = useCallback(async (
        field: keyof AutoSaveConfiguration,
        patch: Partial<AutoSaveConfiguration>,
    ) => {
        if (saving) {
            return;
        }
        const previous = autoSave;
        setSaving(field);
        setAutoSave(current => ({ ...current, ...patch }));
        try {
            const updated = await projectService.updateAutoSaveConfiguration(patch);
            setAutoSave(normalizeAutoSaveConfiguration(updated.app?.autoSave));
            onConfigChange(updated);
        } catch (error) {
            setAutoSave(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(null);
        }
    }, [autoSave, onConfigChange, projectService, saving, uiService]);

    return (
        <div className="grid gap-3">
            <SettingRow
                title={t("project.game.autoSaveTitle")}
                description={t("project.game.autoSaveDescription")}
                checked={autoSave.enabled}
                loading={saving === "enabled"}
                onChange={value => void commit("enabled", { enabled: value })}
            />
            <SettingShell
                title={t("project.game.autoSaveIntervalTitle")}
                description={t("project.game.autoSaveIntervalDescription")}
                titleAttr={freeze.writes().title}
            >
                <NumberField
                    value={autoSave.intervalSeconds}
                    min={AUTO_SAVE_INTERVAL_SECONDS_MIN}
                    max={AUTO_SAVE_INTERVAL_SECONDS_MAX}
                    unit={t("project.game.autoSaveIntervalUnit")}
                    disabled={freeze.writes(!autoSave.enabled || saving === "intervalSeconds").disabled}
                    ariaLabel={t("project.game.autoSaveIntervalTitle")}
                    onCommit={value => void commit("intervalSeconds", { intervalSeconds: value })}
                />
            </SettingShell>
            <SettingShell
                title={t("project.game.autoSaveSlotsTitle")}
                description={t("project.game.autoSaveSlotsDescription")}
                titleAttr={freeze.writes().title}
            >
                <NumberField
                    value={autoSave.slots}
                    min={AUTO_SAVE_SLOTS_MIN}
                    max={AUTO_SAVE_SLOTS_MAX}
                    disabled={freeze.writes(saving === "slots").disabled}
                    ariaLabel={t("project.game.autoSaveSlotsTitle")}
                    onCommit={value => void commit("slots", { slots: value })}
                />
            </SettingShell>
        </div>
    );
}
