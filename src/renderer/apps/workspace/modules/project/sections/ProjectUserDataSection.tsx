/**
 * Project -> App: where a shipped desktop game keeps the files that belong to the player.
 *
 * Here rather than in the build dialog because the answer is partly a consequence of the app id two
 * rows above it: an author who changes that is looking at this list at the moment it changes.
 *
 * Two settings and not one. The game's own folder is a folder the player has on Windows and Linux
 * and an application bundle on macOS, so one control would leave each platform to interpret a single
 * answer and the author unable to say where a macOS player's saves are.
 *
 * What the locations are for is left to the reader. Every storefront that offers to carry saves
 * between a player's machines asks for the same three things, and none of them accepts an absolute
 * path from the machine that produced the build, so what is published is the shape those forms take:
 * a per-user root, a path relative to it, and a filename mask. Which of them to tell, and whether to
 * tell any, is the author's decision and not a setting.
 */

import { useCallback, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { IconButton, Select, type SelectOption } from "@/lib/components/elements";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { deriveGameAppId } from "@shared/types/gameBuild";
import {
    describeUserDataLocations,
    formatUserDataLocation,
    normalizeSaveLocationConfiguration,
    USER_DATA_CONTENT_GROUPS,
    userDataDirectoryName,
    type SaveLocationConfiguration,
    type SaveLocationMode,
    type UserDataLocation,
} from "@shared/utils/userDataLocation";
import { SettingStack } from "./settingRows";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectUserDataSection({
    projectService,
    uiService,
    config,
    onConfigChange,
}: ProjectSectionProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [saveLocation, setSaveLocation] = useState<SaveLocationConfiguration>(
        () => normalizeSaveLocationConfiguration(config.app?.saveLocation),
    );
    const [saving, setSaving] = useState<keyof SaveLocationConfiguration | null>(null);

    const locations = useMemo(
        () => describeUserDataLocations(
            userDataDirectoryName(deriveGameAppId(config.identifier, config.name ?? "")),
            saveLocation,
        ),
        [config.identifier, config.name, saveLocation],
    );
    const gameFolder = t("project.userData.gameFolder");

    const commit = useCallback(async (
        field: keyof SaveLocationConfiguration,
        mode: SaveLocationMode,
    ) => {
        if (saving) {
            return;
        }
        const previous = saveLocation;
        setSaving(field);
        setSaveLocation(current => ({ ...current, [field]: mode }));
        try {
            const updated = await projectService.updateSaveLocationConfiguration({ [field]: mode });
            setSaveLocation(normalizeSaveLocationConfiguration(updated.app?.saveLocation));
            onConfigChange(updated);
        } catch (error) {
            setSaveLocation(previous);
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setSaving(null);
        }
    }, [onConfigChange, projectService, saveLocation, saving, uiService]);

    const options = useMemo<SelectOption[]>(() => [
        { value: "app-root", label: t("project.userData.mode.appRoot") },
        { value: "user-data", label: t("project.userData.mode.userData") },
    ], [t]);

    return (
        // No `?` beside the copy button: the part carries the topic for F1, and a second glyph on
        // the heading row would be one to skim past rather than one to press.
        <SettingsGroup
            title={t("project.group.userData")}
            description={t("project.userData.description")}
            helpTopic="saveLocation"
            trailing={(
                <IconButton
                    size="sm"
                    aria-label={t("project.userData.copy")}
                    title={t("project.userData.copy")}
                    onClick={() => void copy(locations, gameFolder, t, uiService)}
                >
                    <Copy className="h-3.5 w-3.5" />
                </IconButton>
            )}
        >
            <SettingStack
                title={t("project.userData.windowsLinux")}
                description={t("project.userData.windowsLinuxDescription")}
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={options}
                    value={saveLocation.windowsLinux}
                    disabled={freeze.writes(saving === "windowsLinux").disabled}
                    ariaLabel={t("project.userData.windowsLinux")}
                    onChange={value => void commit("windowsLinux", value as SaveLocationMode)}
                />
            </SettingStack>
            <SettingStack
                title={t("project.userData.macos")}
                description={t("project.userData.macosDescription")}
                tooltip={freeze.writes()["data-tip"]}
            >
                <Select
                    size="sm"
                    fullWidth
                    portalMenu
                    className="min-w-0"
                    options={options}
                    value={saveLocation.macos}
                    disabled={freeze.writes(saving === "macos").disabled}
                    ariaLabel={t("project.userData.macos")}
                    onChange={value => void commit("macos", value as SaveLocationMode)}
                />
            </SettingStack>

            <div className="grid gap-2 rounded-md border border-edge bg-fill-subtle p-3">
                {locations.map(location => (
                    <div key={location.platform} className="grid gap-0.5">
                        <span className="text-2xs text-fg-subtle">{t(`project.userData.platform.${location.platform}`)}</span>
                        {/* `break-words` rather than `break-all`: a path in a 320px panel has to
                            wrap, but breaking it wherever the line happens to end splits the app id
                            down the middle (…narraleaf.game / s.demo), which reads as two different
                            names. This breaks at the spaces and slashes first and only cuts a token
                            that cannot fit a line on its own. */}
                        <span className="min-w-0 break-words font-mono text-2xs text-fg-muted">
                            {formatUserDataLocation(location, gameFolder)}
                        </span>
                    </div>
                ))}
            </div>

            <div className="grid gap-2 rounded-md border border-edge bg-fill-subtle p-3">
                {USER_DATA_CONTENT_GROUPS.map(group => (
                    <div key={group.id} className="grid gap-0.5">
                        <span className="min-w-0 break-words font-mono text-2xs text-fg-muted">
                            {group.subdirectory === "." ? group.pattern : `${group.subdirectory}/${group.pattern}`}
                        </span>
                        <span className="text-2xs text-fg-subtle">{t(`project.userData.content.${group.id}`)}</span>
                    </div>
                ))}
            </div>
        </SettingsGroup>
    );
}

type Translate = ReturnType<typeof useTranslation>["t"];

async function copy(
    locations: UserDataLocation[],
    gameFolder: string,
    t: Translate,
    uiService: ProjectSectionProps["uiService"],
): Promise<void> {
    return copyTextToClipboard(summarize(locations, gameFolder, t)).then(
        () => uiService?.showNotification(t("project.userData.copied"), "success"),
        () => uiService?.showNotification(t("project.userData.copyFailed"), "error"),
    );
}

/**
 * The clipboard form, which is the one that gets pasted into somebody else's form. It names each
 * root as those forms name it, since the resolved path a reader can see on screen is the one thing
 * they cannot type into one.
 */
function summarize(locations: UserDataLocation[], gameFolder: string, t: Translate): string {
    const lines = [t("project.userData.description"), ""];
    for (const location of locations) {
        lines.push(
            `${t(`project.userData.platform.${location.platform}`)}: `
            + `${formatUserDataLocation(location, gameFolder)}  (${location.root})`,
        );
    }
    lines.push("");
    for (const group of USER_DATA_CONTENT_GROUPS) {
        const relative = group.subdirectory === "." ? group.pattern : `${group.subdirectory}/${group.pattern}`;
        lines.push(`${relative}: ${t(`project.userData.content.${group.id}`)}`);
    }
    return lines.join("\n");
}
