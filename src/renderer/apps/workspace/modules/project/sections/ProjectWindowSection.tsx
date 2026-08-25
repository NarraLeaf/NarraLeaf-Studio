/**
 * Project -> App -> Window: the window the shipped game opens, and what the player may do to it.
 *
 * On this page rather than under Game because none of it is about the story: it decides the frame
 * the application puts on screen, the same way the icons and the player-files directory above it
 * decide what the application is called and where it writes.
 *
 * ## What is deliberately not here
 *
 * A list of window sizes was, and it was the wrong place for one. A project cannot know what will
 * fit the screen a player turns out to have - 200% is right on a 4K monitor and nonsense on a
 * laptop - and while it existed it was also a limit on what a running game could ask for. The
 * shipped game answers both questions itself now: the shell measures which multiples of the design
 * size fit the display in front of the player (the `Get Window Scale Options` node), and a graph
 * may set any size at all.
 *
 * What is left is what only the author can answer: whether the window may be dragged, whether it
 * comes back where it was, and whether the game starts full-screen.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Switch } from "@/lib/components/elements";
import { normalizeWindowConfiguration, type WindowConfiguration } from "@/lib/workspace/project/configuration";
import { SettingShell } from "./settingRows";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

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

    return (
        <SettingsGroup title={t("project.group.window")}>
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
