import { useState } from "react";

import { useTranslation } from "@/lib/i18n";

import { useTeamProjectSurface } from "./TeamProjectContext";

/**
 * Says what a reviewer or a viewer may do here, before they find out from a refused send.
 *
 * The server is what enforces it - the version-control server will not open the repository to
 * either role - so this is a sentence, not a lock: it explains the refusal in advance and in the
 * reader's language. Dismissed for the life of the window.
 */
export function TeamRoleNotice() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const [dismissed, setDismissed] = useState(false);
    const role = team.state.kind === "verified" ? team.state.project.role : undefined;
    if (dismissed || (role !== "reviewer" && role !== "viewer")) return null;
    return (
        <div
            data-team-role-notice={role}
            className="pointer-events-auto fixed left-1/2 top-12 z-40 flex max-w-[640px] -translate-x-1/2 items-center gap-3 rounded-lg border border-warning/30 bg-surface-overlay px-3 py-2 text-xs text-fg shadow-lg"
        >
            <span>{t(role === "reviewer" ? "workspace.shell.team.roleNotice.reviewer" : "workspace.shell.team.roleNotice.viewer")}</span>
            <button
                type="button"
                className="shrink-0 rounded px-2 py-0.5 text-fg-muted hover:bg-fill hover:text-fg"
                onClick={() => setDismissed(true)}
            >
                {t("workspace.shell.team.roleNotice.dismiss")}
            </button>
        </div>
    );
}
