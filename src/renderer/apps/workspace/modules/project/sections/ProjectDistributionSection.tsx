/**
 * Project -> Project: the key that ties this project to the builds it produces.
 *
 * One value, minted once and then carried with the project like any other file
 * in it, which is what lets any member of a team build - and lets an add-on made
 * months later be read by a build already in players' hands.
 *
 * The key itself is never on screen and there is no control that reveals it. It
 * would be a long opaque string that answers no question a person has, and a
 * field showing one invites copying it somewhere it does not belong. What is
 * shown is the date it was last replaced, because that is the part an author acts
 * on: it is what tells them which of their shipped builds still match.
 *
 * Replacing is destructive at a distance - every build shipped under the previous
 * key stops accepting add-ons made afterwards - and nothing about the screen after
 * the click looks different, so it goes through a destructive confirmation that
 * says so in as many words.
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { normalizeDistributionConfiguration } from "@/lib/workspace/project/configuration";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

export function ProjectDistributionSection({ projectService, uiService, config, onConfigChange }: ProjectSectionProps) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const distribution = useMemo(
        () => normalizeDistributionConfiguration(config.app?.distribution),
        [config.app?.distribution],
    );

    const rotate = useCallback(async () => {
        if (busy) {
            return;
        }
        // Only when there is something to lose. The first mint changes nothing that
        // exists yet, and a confirmation on it would teach the author to click
        // through the one that matters.
        if (distribution && uiService) {
            const confirmed = await uiService.dialogs.confirmDestructive(
                t("project.distribution.replaceConfirm"),
                t("project.distribution.replaceConfirmDetail"),
                t("project.distribution.replaceAction"),
            );
            if (!confirmed) {
                return;
            }
        }
        setBusy(true);
        try {
            onConfigChange(await projectService.rotateDistributionKey());
        } catch (error) {
            uiService?.showNotification(error instanceof Error ? error.message : String(error), "error");
        } finally {
            setBusy(false);
        }
    }, [busy, distribution, onConfigChange, projectService, t, uiService]);

    return (
        <SettingsGroup
            title={t("project.group.distribution")}
            description={t("project.distribution.description")}
            trailing={(
                <Button
                    size="sm"
                    variant={distribution ? "ghost" : "secondary"}
                    disabled={busy}
                    onClick={() => { void rotate(); }}
                >
                    {distribution ? t("project.distribution.replaceAction") : t("project.distribution.createAction")}
                </Button>
            )}
        >
            <div className="rounded-md border border-edge bg-fill-subtle p-3">
                <span className="text-2xs text-fg-muted">
                    {distribution
                        ? t("project.distribution.rotatedAt", { date: formatRotatedAt(distribution.rotatedAt) })
                        : t("project.distribution.absent")}
                </span>
            </div>
        </SettingsGroup>
    );
}

/**
 * The stamp as a reader's own locale writes it, or the stored value verbatim when
 * it is not a date this machine can parse. A key minted before the stamp existed,
 * or one edited by hand, still has to show something true rather than "Invalid
 * Date" - and the raw value is at least the thing that is actually in the file.
 */
function formatRotatedAt(rotatedAt: string): string {
    const parsed = new Date(rotatedAt);
    if (!rotatedAt || Number.isNaN(parsed.getTime())) {
        return rotatedAt || "—";
    }
    return parsed.toLocaleString();
}
