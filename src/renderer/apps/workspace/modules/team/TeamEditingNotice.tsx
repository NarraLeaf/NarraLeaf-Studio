import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import type { TeamClientInstance } from "@shared/types/team";

import { useActiveEditorTab } from "../../hooks/useUIService";
import { useTeamProjectSurface } from "./TeamProjectContext";
import { teamEditingDocument } from "./teamEditing";

/** The other windows that have this document in front of them, longest first. */
export function othersEditing(
    clients: readonly TeamClientInstance[],
    document: string | null,
    self: string | undefined,
): TeamClientInstance[] {
    if (document === null) return [];
    return clients
        .filter(client => client.id !== self && client.editing === document)
        .sort((a, b) => (a.editingSince ?? 0) - (b.editingSince ?? 0));
}

/**
 * "Bob is in this chapter too, for twelve minutes now" - said when the author opens a story or a
 * blueprint somebody else on the project already has open.
 *
 * A soft lock: a sentence and nothing else. Version control merges what two people did; what this
 * saves is the surprise of finding out at the merge. Dismissed per document for the life of the
 * window, and gone by itself when the other person moves on.
 */
export function TeamEditingNotice() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const { tab } = useActiveEditorTab();
    const document = teamEditingDocument(tab);
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
    const [now, setNow] = useState(() => Date.now());
    const others = othersEditing(team.clients, document, team.instance);

    useEffect(() => {
        if (others.length === 0) return;
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, [others.length]);

    if (document === null || others.length === 0 || dismissed.has(document)) return null;
    const first = others[0]!;
    const minutes = first.editingSince === undefined ? 0 : Math.max(0, Math.floor((now - first.editingSince) / 60_000));
    const names = [...new Set(others.map(other => other.account))].join(", ");
    return (
        <div
            data-team-editing-notice={document}
            className="pointer-events-auto fixed bottom-10 right-4 z-40 flex max-w-[420px] items-center gap-3 rounded-lg border border-edge bg-surface-overlay px-3 py-2 text-xs text-fg shadow-lg"
        >
            <span>
                {t("workspace.shell.team.editingNotice.here", {
                    name: names,
                    since: minutes < 1
                        ? t("workspace.shell.team.editingNotice.justNow")
                        : t("workspace.shell.team.editingNotice.minutes", { minutes: String(minutes) }),
                })}
            </span>
            <button
                type="button"
                className="shrink-0 rounded px-2 py-0.5 text-fg-muted hover:bg-fill hover:text-fg"
                onClick={() => setDismissed(current => new Set([...current, document]))}
            >
                {t("workspace.shell.team.editingNotice.dismiss")}
            </button>
        </div>
    );
}
