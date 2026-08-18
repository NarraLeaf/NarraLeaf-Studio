/**
 * Project -> Game -> Language: what happens to a playthrough when the player changes language.
 *
 * One row, and there is no second one, because the question only exists while a game is running. On
 * a title screen the language simply changes, and no setting could make that untrue.
 *
 * Its own group rather than a row under Saving, even though one of the two answers writes a save:
 * what is being decided here is what the player gets, not when the game writes one.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Select, type SelectOption } from "@/lib/components/elements";
import {
    normalizeLanguageChangeConfiguration,
    type LanguageChangeConfig,
} from "@/lib/workspace/project/configuration";
import { SettingStack } from "./settingRows";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectLanguageSection({
    projectService,
    uiService,
    config,
    onConfigChange,
}: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [policy, setPolicy] = useState<LanguageChangeConfig>(
        () => normalizeLanguageChangeConfiguration(config.app?.languageChange),
    );
    const [saving, setSaving] = useState(false);

    const commit = useCallback(async (patch: Partial<LanguageChangeConfig>) => {
        if (saving) {
            return;
        }
        const previous = policy;
        setSaving(true);
        setPolicy(current => ({ ...current, ...patch }));
        try {
            const updated = await projectService.updateLanguageChangeConfiguration(patch);
            setPolicy(normalizeLanguageChangeConfiguration(updated.app?.languageChange));
            onConfigChange(updated);
        } catch (error) {
            setPolicy(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(false);
        }
    }, [onConfigChange, policy, projectService, saving, uiService]);

    // Ordered by how much of the game ends up in the new language, so the list reads as a scale.
    const options = useMemo<SelectOption[]>(() => [
        { value: "restart", label: t("project.game.languageRestart") },
        { value: "nextScene", label: t("project.game.languageNextScene") },
    ], [t]);

    return (
        <SettingsGroup title={t("project.group.language")}>
            <SettingStack
                title={t("project.game.languageInGameTitle")}
                description={t("project.game.languageInGameDescription")}
                helpTopic="localization"
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={options}
                    value={policy.inGame}
                    disabled={freeze.writes(saving).disabled}
                    ariaLabel={t("project.game.languageInGameTitle")}
                    onChange={value => void commit({ inGame: value as LanguageChangeConfig["inGame"] })}
                />
            </SettingStack>
        </SettingsGroup>
    );
}
