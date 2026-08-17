/**
 * Project -> Game -> Older saves: what a save written by an earlier build of this game may do.
 *
 * Its own group rather than two more rows under Saving, because it answers the opposite question:
 * Saving decides when a playthrough is written down, this decides whether one that was written down
 * is still offered. Both halves of the game read what is set here - the slots a save screen lists
 * and the load a player presses - so a slot that is hidden here is never quietly accepted elsewhere.
 *
 * Two rows and no third, because there is no third case. A build tells the same story or it does
 * not; the version beside it is the author's own label, compared and never interpreted. See
 * `@shared/types/saveCompatibility`.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Select, type SelectOption } from "@/lib/components/elements";
import {
    normalizeSaveCompatibilityConfiguration,
    type SaveCompatibilityConfiguration,
} from "@/lib/workspace/project/configuration";
import { SettingStack } from "./settingRows";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectSaveCompatibilitySection({
    projectService,
    uiService,
    config,
    onConfigChange,
}: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [policy, setPolicy] = useState<SaveCompatibilityConfiguration>(
        () => normalizeSaveCompatibilityConfiguration(config.app?.saveCompatibility),
    );
    const [saving, setSaving] = useState<keyof SaveCompatibilityConfiguration | null>(null);

    const commit = useCallback(async (
        field: keyof SaveCompatibilityConfiguration,
        patch: Partial<SaveCompatibilityConfiguration>,
    ) => {
        if (saving) {
            return;
        }
        const previous = policy;
        setSaving(field);
        setPolicy(current => ({ ...current, ...patch }));
        try {
            const updated = await projectService.updateSaveCompatibilityConfiguration(patch);
            setPolicy(normalizeSaveCompatibilityConfiguration(updated.app?.saveCompatibility));
            onConfigChange(updated);
        } catch (error) {
            setPolicy(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(null);
        }
    }, [onConfigChange, policy, projectService, saving, uiService]);

    const compatibleOptions = useMemo<SelectOption[]>(() => [
        { value: "resume", label: t("project.game.saveResume") },
        { value: "discard", label: t("project.game.saveDiscard") },
    ], [t]);
    // Ordered by how much of the playthrough survives, so the list reads as a scale rather than as
    // three unrelated answers.
    const incompatibleOptions = useMemo<SelectOption[]>(() => [
        { value: "force", label: t("project.game.saveForce") },
        { value: "resumeScene", label: t("project.game.saveResumeScene") },
        { value: "discard", label: t("project.game.saveDiscard") },
    ], [t]);

    return (
        <SettingsGroup title={t("project.group.olderSaves")}>
            <SettingStack
                title={t("project.game.saveCompatibleTitle")}
                description={t("project.game.saveCompatibleDescription")}
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={compatibleOptions}
                    value={policy.compatible}
                    disabled={freeze.writes(saving === "compatible").disabled}
                    ariaLabel={t("project.game.saveCompatibleTitle")}
                    onChange={value => void commit("compatible", {
                        compatible: value as SaveCompatibilityConfiguration["compatible"],
                    })}
                />
            </SettingStack>
            <SettingStack
                title={t("project.game.saveIncompatibleTitle")}
                description={t("project.game.saveIncompatibleDescription")}
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={incompatibleOptions}
                    value={policy.incompatible}
                    disabled={freeze.writes(saving === "incompatible").disabled}
                    ariaLabel={t("project.game.saveIncompatibleTitle")}
                    onChange={value => void commit("incompatible", {
                        incompatible: value as SaveCompatibilityConfiguration["incompatible"],
                    })}
                />
            </SettingStack>
        </SettingsGroup>
    );
}
