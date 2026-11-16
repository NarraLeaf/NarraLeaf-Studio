import { useCallback, useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n";
import { teamCall, useTeamCapability, useTeamConnection, useTeamTopics, type TeamOutcome } from "@/lib/team";
import { TeamMethod, teamProjectLocksTopic, type TeamAssetLock } from "@shared/types/team";

import { useActiveEditorTab } from "../../hooks/useUIService";
import { editorSubjectOf } from "../lint/problemsScope";
import { useTeamProjectSurface } from "./TeamProjectContext";
import { assetLockState, readAssetLocks } from "./teamAssetLock";

const NO_TOPICS: readonly string[] = [];

function clock(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Says so when the asset in front of the author is held by somebody else on the team - before the
 * edit, rather than as a refusal after it. The server is what enforces a lock: until it lapses or is
 * let go, every edit to that asset from anybody but its holder is refused. This only says it first.
 *
 * Held by the author themself, it says until when and offers to let go. Locks are taken in the web
 * console, beside each asset; Studio does not take them.
 */
export function TeamAssetLockNotice() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const { tab } = useActiveEditorTab();
    const remoteOrigin = team.state.kind === "verified" ? team.remoteOrigin : null;
    const project = team.state.kind === "verified" ? team.state.project.id : null;
    const connection = useTeamConnection(remoteOrigin);
    const withLocks = useTeamCapability(connection, "locks");
    const me = connection.account?.username;
    const subject = tab === null ? null : editorSubjectOf(tab);
    const assetId = subject?.kind === "asset" ? subject.assetId : null;
    const following = withLocks && project !== null && assetId !== null;

    const topics = useMemo(
        () => (following && project !== null ? [teamProjectLocksTopic(project)] : NO_TOPICS),
        [following, project],
    );
    const read = useCallback(async (): Promise<TeamOutcome<TeamAssetLock[]>> => {
        if (remoteOrigin === null || project === null) return { ok: true, value: [] };
        const answer = await teamCall(remoteOrigin, TeamMethod.assetsLocks, { project });
        return answer.ok ? { ok: true, value: readAssetLocks(answer.value) } : answer;
    }, [remoteOrigin, project]);
    const locks = useTeamTopics(following ? remoteOrigin : null, topics, read);

    const [now, setNow] = useState(() => Date.now());
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!following) return;
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, [following]);

    if (!following || assetId === null || remoteOrigin === null || project === null) return null;
    const state = assetLockState(locks.value ?? [], assetId, me, now);
    if (state.kind === "free") return null;
    const key = `${assetId}:${state.lock.holder}:${state.lock.expiresAt}`;
    if (dismissed.has(key)) return null;

    const release = async () => {
        setBusy(true);
        try {
            await teamCall(remoteOrigin, TeamMethod.assetsUnlock, { project, asset: assetId });
            locks.refresh();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            data-team-asset-lock={state.kind}
            className={`pointer-events-auto fixed bottom-24 right-4 z-40 flex max-w-[420px] items-start gap-3 rounded-lg border bg-surface-overlay px-3 py-2 text-xs text-fg shadow-lg ${
                state.kind === "theirs" ? "border-warning" : "border-edge"
            }`}
        >
            <span className="min-w-0 flex-1">
                {state.kind === "theirs"
                    ? t("workspace.shell.team.assetLock.theirs", { name: state.lock.holder, until: clock(state.lock.expiresAt) })
                    : t("workspace.shell.team.assetLock.mine", { until: clock(state.lock.expiresAt) })}
                {state.lock.note === undefined ? null : <span className="mt-1 block text-fg-muted">{state.lock.note}</span>}
            </span>
            {state.kind === "mine" ? (
                <button
                    type="button"
                    disabled={busy}
                    className="shrink-0 rounded-md px-2 py-0.5 text-fg-muted hover:bg-fill hover:text-fg disabled:opacity-50"
                    onClick={() => void release()}
                >
                    {t("workspace.shell.team.assetLock.release")}
                </button>
            ) : null}
            <button
                type="button"
                className="shrink-0 rounded-md px-2 py-0.5 text-fg-muted hover:bg-fill hover:text-fg"
                onClick={() => setDismissed(current => new Set([...current, key]))}
            >
                {t("workspace.shell.team.assetLock.dismiss")}
            </button>
        </div>
    );
}
