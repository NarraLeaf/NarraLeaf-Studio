import { useMemo } from "react";
import { ChevronsLeft, Clock, Cloud, GitBranch, GitCommitHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { serverDisplayName } from "@/lib/vcs/servers";
import { APP_DISPLAY_NAME } from "@shared/constants/app";
import type { TranslationKey } from "@shared/i18n";
import { composeVcsIdentity } from "@shared/types/vcs";
import { useOnboardingPreferences } from "../onboardingPreferences";
import { useOnboardingServers } from "../onboardingServers";

/**
 * The version column, as `VersionRail` draws one.
 *
 * The surface behind the two screens that ask who the work is by and where it is kept: in a working
 * project both answers are read off this column, so both screens show it rather than describing it.
 *
 * **The signature is composed, not spelled here.** `composeVcsIdentity` is the same fold that
 * reaches the repository, so the line under the version on screen is the string a recorded version
 * would actually carry - the `Name <email>` shape included, and the tool's own name when both
 * fields are empty.
 *
 * **The server row is live.** The Team screen signs in through the ordinary dialog, so a server
 * appears here the moment it is added, which is the whole answer to whether it worked.
 *
 * Copied from the rail it stands for: the 320px column with its own edge against the panel rail, the
 * 48px header, the version block, the server line under it, and the history rows under their
 * eyebrow. The times are formatted the way the rail formats one, so the column reads in the same
 * calendar the interface language sets.
 */

/** `VERSION_RAIL_EXPANDED_WIDTH` - the width the column opens at. */
const COLUMN_WIDTH_PX = 320;

/** How far back each sample version was recorded, in minutes. */
const HISTORY: readonly { messageKey: TranslationKey; number: number; minutesAgo: number; icon: LucideIcon }[] = [
    { messageKey: "onboarding.sample.versions.latest", number: 12, minutesAgo: 35, icon: GitCommitHorizontal },
    { messageKey: "onboarding.sample.versions.checkpoint", number: 11, minutesAgo: 190, icon: Clock },
    { messageKey: "onboarding.sample.versions.earlier", number: 9, minutesAgo: 1520, icon: GitCommitHorizontal },
];

export function VersionRailPreview() {
    const { t, locale } = useTranslation();
    const { authorName, authorEmail } = useOnboardingPreferences();
    const { servers } = useOnboardingServers();
    const identity = composeVcsIdentity(authorName, authorEmail) || APP_DISPLAY_NAME;
    // Read once per mount rather than per render, so the column does not re-date itself while a
    // name is being typed beside it.
    const now = useMemo(() => Date.now(), []);
    const time = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toLocaleString(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <div
            className="flex min-h-0 shrink-0 flex-col border-r border-edge bg-surface-sunken"
            style={{ width: COLUMN_WIDTH_PX }}
        >
            <div className="flex h-12 shrink-0 items-center border-b border-edge px-3">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <GitBranch className="h-4 w-4 shrink-0 text-fg-muted" />
                    <span className="truncate text-sm font-medium text-fg">
                        {t("workspace.shell.versionControl.title")}
                    </span>
                </span>
                <ChevronsLeft className="h-4 w-4 shrink-0 text-fg-muted" />
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
                {/* The version on screen, signed the way this installation signs one. */}
                <div className="border-b border-edge px-3 py-3">
                    <p className="truncate text-sm font-medium text-fg">
                        {t("onboarding.sample.versions.latest")}
                    </p>
                    <p className="mt-0.5 truncate text-2xs text-fg-muted">
                        {time(HISTORY[0].minutesAgo)} · {identity}
                    </p>
                    <p className="mt-0.5 truncate text-2xs tabular-nums text-fg-subtle">
                        #{HISTORY[0].number}
                    </p>
                </div>

                <div className="border-b border-edge px-3 py-2">
                    {servers.length > 0 ? (
                        <span className="flex items-center gap-1.5">
                            <Cloud className="h-3 w-3 shrink-0 text-fg-subtle" />
                            <span className="min-w-0 truncate text-2xs text-fg">
                                {serverDisplayName(servers[0])}
                            </span>
                        </span>
                    ) : (
                        <p className="text-2xs text-fg-subtle">
                            {t("workspace.shell.versionControl.server.none")}
                        </p>
                    )}
                </div>

                <div className="px-3 pb-1 pt-2 text-2xs text-fg-subtle">
                    {t("workspace.shell.versionControl.history")}
                </div>
                {HISTORY.map(entry => (
                    <div key={entry.number} className="flex items-start gap-2 px-3 py-1.5 text-fg-muted">
                        <span className="mt-0.5 w-3 shrink-0 text-fg-subtle">
                            <entry.icon className="h-3 w-3" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs">{t(entry.messageKey)}</span>
                            <span className="mt-0.5 block truncate text-2xs text-fg-subtle">
                                #{entry.number} · {time(entry.minutesAgo)}
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
