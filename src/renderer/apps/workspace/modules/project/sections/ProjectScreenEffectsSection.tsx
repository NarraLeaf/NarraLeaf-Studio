/**
 * Project -> App -> Screen effects: the frame rate the effects Studio bakes are made at.
 *
 * One row, and the page is where it is because the answer is a property of the application this
 * project produces rather than of the game inside it: it changes what the package contains and how
 * long a build takes, and it changes nothing a player can choose.
 *
 * ## Why the row names weather rather than screen effects
 *
 * `/vfx` takes two kinds of source. A seed - snow, rain, sakura - is made here, and its frame rate
 * is therefore ours to decide. A clip the author imported travels through the ordinary media path,
 * which never restates a frame rate, so it keeps the one it was recorded at and nothing on this
 * panel could change that. A row titled for the whole command would promise the second.
 *
 * ## Why a select and not a number
 *
 * Frames are 12 seconds' worth each time, so the bake time and the packaged bytes are strictly
 * proportional to the rate. Four positions are the ones worth having; a free field would invite a
 * value that costs more and shows nothing. See `@shared/types/vfx`.
 */

import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { HelpTrigger } from "@/lib/help";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Select, type SelectOption } from "@/lib/components/elements";
import {
    normalizeVfxConfiguration,
    VFX_FRAME_RATES,
    type VfxConfiguration,
    type VfxFrameRate,
} from "@/lib/workspace/project/configuration";
import { SettingShell } from "./settingRows";
import { useConfigSlice } from "./useConfigSlice";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectScreenEffectsSection({
    projectService,
    uiService,
    config,
    onConfigChange,
}: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const stored = useMemo(() => normalizeVfxConfiguration(config.app?.vfx), [config.app?.vfx]);
    const { value: vfx, commit } = useConfigSlice<VfxConfiguration>({
        stored,
        write: patch => projectService.updateVfxConfiguration(patch),
        onConfigChange,
        uiService,
    });

    // Derived from the list rather than written out, so a rate added there appears here without this
    // file changing - and so the two can never offer different sets.
    const options = useMemo<SelectOption[]>(
        () => VFX_FRAME_RATES.map(rate => ({
            value: String(rate),
            label: t("project.screenEffects.frameRateOption", { rate: String(rate) }),
        })),
        [t],
    );

    return (
        <SettingsGroup
            title={t("project.group.screenEffects")}
            helpTopic="screenEffects"
            trailing={<HelpTrigger topic="screenEffects" />}
        >
            <SettingShell
                title={t("project.screenEffects.frameRateTitle")}
                description={t("project.screenEffects.frameRateDescription")}
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    portalMenu
                    className="w-24 shrink-0"
                    options={options}
                    value={String(vfx.frameRate)}
                    disabled={freeze.writes().disabled}
                    ariaLabel={t("project.screenEffects.frameRateTitle")}
                    onChange={value => void commit({ frameRate: Number(value) as VfxFrameRate })}
                />
            </SettingShell>
        </SettingsGroup>
    );
}
