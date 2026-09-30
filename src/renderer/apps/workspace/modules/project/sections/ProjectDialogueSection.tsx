/**
 * Project → Game → Dialogue: the author's own pacing value.
 *
 * A group of its own rather than a row among the player defaults below it, because it is not one:
 * the player never sees this and no settings screen offers it. A pause written into a line is part
 * of the writing, and how long it lasts belongs with the writing. See @shared/types/dialogue.
 */

import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    AUTO_FORWARD_DEFAULT_PAUSE_MAX,
    AUTO_FORWARD_DEFAULT_PAUSE_MIN,
    normalizeDialogueConfiguration,
    type DialogueConfiguration,
} from "@/lib/workspace/project/configuration";
import { SettingShell } from "./settingRows";
import { NumberField } from "./NumberField";
import { useConfigSlice } from "./useConfigSlice";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectDialogueSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    // The field sits in a bare shell, which does not read the freeze itself.
    const freeze = useFreezeGuard();
    // The panel is keep-alive and the config can be replaced underneath it (a VCS restore, another
    // surface writing the same file), so the stored value stays the source of truth for the row.
    const stored = useMemo(() => normalizeDialogueConfiguration(config.app?.dialogue), [config.app?.dialogue]);
    const { value: dialogue, commit } = useConfigSlice<DialogueConfiguration>({
        stored,
        write: patch => projectService.updateDialogueConfiguration(patch),
        onConfigChange,
        uiService,
    });

    return (
        <SettingsGroup title={t("project.group.dialogue")}>
            <SettingShell
                title={t("project.game.autoForwardPauseTitle")}
                description={t("project.game.autoForwardPauseDescription")}
                tooltip={freeze.writes()["data-tip"]}
            >
                <NumberField
                    value={dialogue.autoForwardDefaultPause}
                    min={AUTO_FORWARD_DEFAULT_PAUSE_MIN}
                    max={AUTO_FORWARD_DEFAULT_PAUSE_MAX}
                    unit={t("project.game.autoForwardPauseUnit")}
                    disabled={freeze.writes().disabled}
                    ariaLabel={t("project.game.autoForwardPauseTitle")}
                    onCommit={value => void commit({ autoForwardDefaultPause: value })}
                />
            </SettingShell>
        </SettingsGroup>
    );
}
