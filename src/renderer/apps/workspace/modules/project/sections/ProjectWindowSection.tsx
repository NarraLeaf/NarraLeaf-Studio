/**
 * Project -> App -> Window: the window the shipped game opens, and what the player may do to it.
 *
 * On this page rather than under Game because none of it is about the story: it decides the frame
 * the application puts on screen, the same way the icons and the player-files directory above it
 * decide what the application is called and where it writes.
 *
 * ## Why the sizes are ticks rather than a number
 *
 * A window size is only worth having as a multiple of the size the game was drawn at - the stage is
 * scaled to whatever the window is, so a size that is not a clean multiple is a blurred stage the
 * author cannot see on their own screen. The ladder is therefore fixed and the author's choice is
 * which rungs to offer; the design size itself is always on, because a game with no way back to it
 * is a game whose art can never be seen as it was made.
 *
 * One rung per line, each carrying the pixels it comes to for THIS project. A multiplier alone is
 * a number an author has to do arithmetic on to picture, and picturing it is the whole decision -
 * whether 150% still fits the screens their players have. The vertical list is also how the rest of
 * Studio asks about membership of a set (see the font locale panel in `ProjectDesignSection`).
 *
 * Dragging is the free half, and deliberately separate: the ticks are what a configuration screen
 * offers, the switch is what the window frame allows. A window dragged off the design ratio
 * letterboxes the stage, the same way a screen of another shape does.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Checkbox, Switch } from "@/lib/components/elements";
import {
    normalizeWindowConfiguration,
    WINDOW_SCALE_STEPS,
    type WindowConfiguration,
    type WindowScaleStep,
} from "@/lib/workspace/project/configuration";
import { SettingShell, SettingStack } from "./settingRows";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/** The one step that is always offered, and so is shown ticked and cannot be unticked. */
const DESIGN_STEP: WindowScaleStep = 1;

export function ProjectWindowSection({
    projectService,
    uiService,
    config,
    onConfigChange,
}: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [windowConfig, setWindowConfig] = useState<WindowConfiguration>(
        () => normalizeWindowConfiguration(config.app?.window),
    );
    const [saving, setSaving] = useState(false);

    /**
     * The size the game is drawn at, so each rung can say what it comes to in pixels. Absent on a
     * project whose resolution has not been settled, where the multiplier stands on its own rather
     * than beside a made-up number.
     */
    const design = useMemo(() => {
        const resolution = config.metadata?.resolution;
        return resolution && resolution.width > 0 && resolution.height > 0 ? resolution : null;
    }, [config.metadata?.resolution]);

    const commit = useCallback(async (patch: Partial<WindowConfiguration>) => {
        if (saving) {
            return;
        }
        const previous = windowConfig;
        setSaving(true);
        setWindowConfig(current => normalizeWindowConfiguration({ ...current, ...patch }));
        try {
            const updated = await projectService.updateWindowConfiguration(patch);
            setWindowConfig(normalizeWindowConfiguration(updated.app?.window));
            onConfigChange(updated);
        } catch (error) {
            setWindowConfig(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(false);
        }
    }, [onConfigChange, projectService, saving, uiService, windowConfig]);

    const toggleStep = useCallback((step: WindowScaleStep, offered: boolean) => {
        const next = offered
            ? [...windowConfig.scaleSteps, step]
            : windowConfig.scaleSteps.filter(kept => kept !== step);
        void commit({ scaleSteps: next });
    }, [commit, windowConfig.scaleSteps]);

    return (
        <SettingsGroup title={t("project.group.window")}>
            <SettingStack
                title={t("project.window.sizesTitle")}
                description={t("project.window.sizesDescription")}
                tooltip={freeze.writes(saving)["data-tip"]}
            >
                <div className="grid gap-1.5">
                    {WINDOW_SCALE_STEPS.map(step => (
                        <Checkbox
                            key={step}
                            className="w-full text-xs"
                            checked={windowConfig.scaleSteps.includes(step)}
                            // The design size is not a choice, so its box states the fact rather
                            // than offering to remove it.
                            disabled={step === DESIGN_STEP || freeze.writes(saving).disabled}
                            onCheckedChange={offered => toggleStep(step, offered)}
                        >
                            <span className="flex w-full items-center justify-between gap-3">
                                <span className="text-fg">
                                    {t("project.window.sizeOption", { percent: String(Math.round(step * 100)) })}
                                </span>
                                {design ? (
                                    <span className="tabular-nums text-2xs text-fg-subtle">
                                        {t("project.window.sizeDimensions", {
                                            width: String(Math.round(design.width * step)),
                                            height: String(Math.round(design.height * step)),
                                        })}
                                    </span>
                                ) : null}
                            </span>
                        </Checkbox>
                    ))}
                </div>
            </SettingStack>
            <SettingShell
                title={t("project.window.resizableTitle")}
                description={t("project.window.resizableDescription")}
                tooltip={freeze.writes(saving)["data-tip"]}
            >
                <Switch
                    size="sm"
                    checked={windowConfig.resizable}
                    disabled={freeze.writes(saving).disabled}
                    aria-label={t("project.window.resizableTitle")}
                    onCheckedChange={value => void commit({ resizable: value })}
                />
            </SettingShell>
            <SettingShell
                title={t("project.window.rememberTitle")}
                description={t("project.window.rememberDescription")}
                tooltip={freeze.writes(saving)["data-tip"]}
            >
                <Switch
                    size="sm"
                    checked={windowConfig.rememberGeometry}
                    disabled={freeze.writes(saving).disabled}
                    aria-label={t("project.window.rememberTitle")}
                    onCheckedChange={value => void commit({ rememberGeometry: value })}
                />
            </SettingShell>
            <SettingShell
                title={t("project.window.fullscreenTitle")}
                description={t("project.window.fullscreenDescription")}
                tooltip={freeze.writes(saving)["data-tip"]}
            >
                <Switch
                    size="sm"
                    checked={windowConfig.startFullscreen}
                    disabled={freeze.writes(saving).disabled}
                    aria-label={t("project.window.fullscreenTitle")}
                    onCheckedChange={value => void commit({ startFullscreen: value })}
                />
            </SettingShell>
        </SettingsGroup>
    );
}
