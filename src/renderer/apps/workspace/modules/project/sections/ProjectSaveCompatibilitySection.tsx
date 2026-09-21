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

import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { HelpTrigger } from "@/lib/help";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Select, type SelectOption } from "@/lib/components/elements";
import {
    normalizeSaveCompatibilityConfiguration,
    type SaveCompatibilityConfiguration,
} from "@/lib/workspace/project/configuration";
import { SettingStack } from "./settingRows";
import { useConfigSlice } from "./useConfigSlice";
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
    const stored = useMemo(
        () => normalizeSaveCompatibilityConfiguration(config.app?.saveCompatibility),
        [config.app?.saveCompatibility],
    );
    const { value: policy, commit } = useConfigSlice<SaveCompatibilityConfiguration>({
        stored,
        write: patch => projectService.updateSaveCompatibilityConfiguration(patch),
        onConfigChange,
        uiService,
    });

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
        // The one visible `?` on the page. A save from an earlier build is in one of three states
        // and only two of them are settings, which is the part no arrangement of these rows can
        // state; the rows themselves carry a control each and take the attribute without a glyph.
        <SettingsGroup
            title={t("project.group.olderSaves")}
            helpTopic="olderSaves"
            trailing={<HelpTrigger topic="olderSaves" />}
        >
            <SettingStack
                title={t("project.game.saveCompatibleTitle")}
                description={t("project.game.saveCompatibleDescription")}
                helpTopic="saveSameStory"
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={compatibleOptions}
                    value={policy.compatible}
                    disabled={freeze.writes().disabled}
                    ariaLabel={t("project.game.saveCompatibleTitle")}
                    onChange={value => void commit({
                        compatible: value as SaveCompatibilityConfiguration["compatible"],
                    })}
                />
            </SettingStack>
            <SettingStack
                title={t("project.game.saveIncompatibleTitle")}
                description={t("project.game.saveIncompatibleDescription")}
                helpTopic="saveStoryChanged"
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={incompatibleOptions}
                    value={policy.incompatible}
                    disabled={freeze.writes().disabled}
                    ariaLabel={t("project.game.saveIncompatibleTitle")}
                    onChange={value => void commit({
                        incompatible: value as SaveCompatibilityConfiguration["incompatible"],
                    })}
                />
            </SettingStack>
        </SettingsGroup>
    );
}
