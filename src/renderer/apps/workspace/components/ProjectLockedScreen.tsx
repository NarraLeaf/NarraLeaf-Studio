import React from "react";
import { useTranslation } from "@/lib/i18n";
import type { ProjectSessionHolder } from "@shared/types/projectSession";
import { ErrorScreen } from "./ErrorScreen";

interface ProjectLockedScreenProps {
    holder: ProjectSessionHolder;
    onRetry?: () => void;
}

/**
 * What a workspace shows when the project it was opened on is already open somewhere else.
 *
 * The screen itself is {@link ErrorScreen}, because the two ways out are the ones it already
 * offers: try again once the other Studio has let go, or go back to the home screen. Two of its
 * answers are turned off here:
 *
 *  - **Recovery mode**, because it opens the project in a shell that runs before this check and
 *    would walk straight past it, into the project a second Studio is editing.
 *  - **The stack**, because the sentence above it is the whole account. Nothing was thrown that
 *    anybody would read a trace of.
 *
 * What the author is told is the machine and the time, and nothing else the record carries. A
 * process id is not something they can act on, and the digest beside it is an identifier, which the
 * interface never shows.
 */
export function ProjectLockedScreen({ holder, onRetry }: ProjectLockedScreenProps) {
    const { t } = useTranslation();

    const error = React.useMemo(() => {
        const since = formatHeldSince(holder.startedAt);
        return new Error(holder.sameHost
            ? t("workspace.shell.projectLockedHere", { time: since })
            : t("workspace.shell.projectLockedElsewhere", { host: holder.hostname, time: since }));
    }, [holder, t]);

    return (
        <ErrorScreen
            error={error}
            onRetry={onRetry}
            title={t("workspace.shell.projectLockedTitle")}
            allowRecovery={false}
            showStackTrace={false}
        />
    );
}

/**
 * When the other session took the project, in this machine's own locale.
 *
 * The time alone for a session that started today, which is nearly all of them; the date as well
 * for one that did not, because "since 09:14" for a Studio somebody left open on Friday reads as
 * this morning.
 */
function formatHeldSince(startedAt: string): string {
    const started = new Date(startedAt);
    if (Number.isNaN(started.getTime())) {
        return startedAt;
    }

    const now = new Date();
    const sameDay = started.getFullYear() === now.getFullYear()
        && started.getMonth() === now.getMonth()
        && started.getDate() === now.getDate();

    return sameDay
        ? started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : started.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}
