/**
 * Project -> App: where a shipped game keeps the files that belong to the player.
 *
 * Read-only, and here rather than in the build dialog because the answer is a
 * consequence of the app id two rows above it: an author who changes that is
 * looking at this list at the moment it changes.
 *
 * What it is for is left to the reader. Every storefront that offers to carry
 * saves between a player's machines asks for the same three things, and none of
 * them accepts an absolute path from the machine that produced the build, so
 * what is published is the shape those forms take: a per-user root, a path
 * relative to it, and a filename mask. Which of them to tell, and whether to
 * tell any, is the author's decision and not a setting.
 */

import { useCallback, useMemo } from "react";
import { Copy } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { IconButton } from "@/lib/components/elements";
import { copyTextToClipboard } from "@shared/utils/copyText";
import { deriveGameAppId } from "@shared/types/gameBuild";
import {
    describeUserDataLocations,
    USER_DATA_CONTENT_GROUPS,
    userDataDirectoryName,
    type UserDataLocation,
} from "@shared/utils/userDataLocation";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectUserDataSection({ config, uiService }: ProjectSectionProps) {
    const { t } = useTranslation();
    const locations = useMemo(
        () => describeUserDataLocations(userDataDirectoryName(deriveGameAppId(config.identifier, config.name ?? ""))),
        [config.identifier, config.name],
    );

    const copy = useCallback(() => {
        void copyTextToClipboard(summarize(locations, t)).then(
            () => uiService?.showNotification(t("project.userData.copied"), "success"),
            () => uiService?.showNotification(t("project.userData.copyFailed"), "error"),
        );
    }, [locations, t, uiService]);

    return (
        <SettingsGroup
            title={t("project.group.userData")}
            description={t("project.userData.description")}
            trailing={(
                <IconButton
                    size="sm"
                    aria-label={t("project.userData.copy")}
                    title={t("project.userData.copy")}
                    onClick={copy}
                >
                    <Copy className="h-3.5 w-3.5" />
                </IconButton>
            )}
        >
            <div className="grid gap-2 rounded-md border border-edge bg-fill-subtle p-3">
                {locations.map(location => (
                    <div key={location.platform} className="grid gap-0.5">
                        <span className="text-2xs text-fg-subtle">{t(`project.userData.platform.${location.platform}`)}</span>
                        {/* `break-words` rather than `break-all`: a path in a 320px panel has to
                            wrap, but breaking it wherever the line happens to end splits the app id
                            down the middle (…narraleaf.game / s.demo), which reads as two different
                            names. This breaks at the spaces and slashes first and only cuts a token
                            that cannot fit a line on its own. */}
                        <span className="min-w-0 break-words font-mono text-2xs text-fg-muted">{location.display}</span>
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

/**
 * The clipboard form, which is the one that gets pasted into somebody else's
 * form. It names each root as those forms name it, since the resolved path a
 * reader can see on screen is the one thing they cannot type into one.
 */
function summarize(locations: UserDataLocation[], t: ReturnType<typeof useTranslation>["t"]): string {
    const lines = [t("project.userData.description"), ""];
    for (const location of locations) {
        lines.push(`${t(`project.userData.platform.${location.platform}`)}: ${location.display}  (${location.root})`);
    }
    lines.push("");
    for (const group of USER_DATA_CONTENT_GROUPS) {
        const relative = group.subdirectory === "." ? group.pattern : `${group.subdirectory}/${group.pattern}`;
        lines.push(`${relative}: ${t(`project.userData.content.${group.id}`)}`);
    }
    return lines.join("\n");
}
