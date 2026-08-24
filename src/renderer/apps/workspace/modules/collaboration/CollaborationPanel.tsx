import { useMemo } from "react";
import { Radio } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/lib/components/elements/Button";
import { EmptyState } from "@/lib/components/elements/EmptyState";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { LiveMemberAvatars } from "../team/LiveMemberAvatars";
import {
    liveMemberRoleKey,
    livePresenceRefusal,
    liveRefusalSentence,
    liveStandingKey,
} from "../team/liveSessionText";
import { useTeamProjectSurface } from "../team/TeamProjectContext";
import { useJoinableRoom, useLiveSession } from "../team/useLiveSession";
import { openLiveSessionDialog } from "../team/liveSessionController";

/**
 * The live session, open for as long as somebody wants to watch it.
 *
 * **The dialog is where a session is entered and left; this is where it is read.** Both draw from
 * the same `LiveSessionView`, and neither holds a copy: who is in the room, which lines they are
 * holding and what the host last refused all move together, and two readers of the same value can
 * never disagree about which moment they are showing.
 *
 * **Nothing here writes.** A session's three acts each take seconds and cannot be cancelled, so
 * they belong where they can be stated before they are taken - which is the dialog. What is left is
 * a row for every fact that changes while the author is working, in the one place they can keep on
 * screen beside the scene they are writing.
 *
 * The claims are counted per account rather than listed per row. A room of two writing four lines
 * between them is four rows of block ids nobody can read; the mark on the row itself is what names
 * a particular line, and this says who is at work.
 */
export function CollaborationPanel() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const live = useLiveSession();
    const room = useJoinableRoom(team, live.view);
    const { view } = live;
    const inRoom = view.phase !== "idle";

    /** How many lines each account is holding, biggest first. */
    const claims = useMemo(() => {
        const held = new Map<string, number>();
        for (const account of Object.values(view.claims)) {
            held.set(account, (held.get(account) ?? 0) + 1);
        }
        return [...held.entries()].sort((left, right) => right[1] - left[1]);
    }, [view.claims]);

    if (team.state.kind === "none") {
        return (
            <Empty>
                <p className="text-2xs text-fg-subtle">{t("workspace.shell.team.liveNoServer")}</p>
            </Empty>
        );
    }

    const refusal = livePresenceRefusal(team.state, team.canLive);
    if (refusal !== null) {
        return (
            <Empty>
                <p className="text-2xs text-fg-subtle">{t(refusal)}</p>
            </Empty>
        );
    }

    if (!inRoom) {
        return (
            <Empty>
                <p className="text-2xs text-fg-subtle">
                    {room === null
                        ? t("workspace.shell.team.liveNobody")
                        : t("workspace.shell.team.liveRoomOpen", { name: room.openedBy })}
                </p>
                <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    data-collaboration-act="open-dialog"
                    onClick={openLiveSessionDialog}
                >
                    {t(room === null
                        ? "workspace.shell.team.liveOpen"
                        : "workspace.shell.team.liveJoin")}
                </Button>
            </Empty>
        );
    }

    const members = view.session?.members ?? [];
    const host = view.session?.openedBy ?? null;
    const standing = liveStandingKey(view);
    const refused = view.lastRefusal === null ? null : liveRefusalSentence(view.lastRefusal);

    return (
        <div data-collaboration-panel={view.phase} className="flex h-full flex-col gap-4 overflow-y-auto p-3">
            {/* No eyebrow over the room: the panel is already titled with what this is. */}
            <div data-collaboration-seam="standing">
                <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {view.session?.title ?? t("workspace.shell.team.liveUntitled")}
                    </span>
                    {standing !== null && (
                        <span className="shrink-0 text-2xs text-fg-subtle">{t(standing)}</span>
                    )}
                </div>
                {view.phase === "catching-up" && (
                    <p className="mt-1 text-2xs text-fg-muted">
                        {t("workspace.shell.team.liveCatchingUp")}
                    </p>
                )}
                {view.pendingIntents > 0 && (
                    <p data-collaboration-seam="pending" className="mt-1 text-2xs text-fg-muted">
                        {view.pendingIntents === 1
                            ? t("workspace.shell.team.livePendingOne")
                            : t("workspace.shell.team.livePendingMany", {
                                count: String(view.pendingIntents),
                            })}
                    </p>
                )}
            </div>

            <Block seam="members" label={t("workspace.shell.team.liveMembersLabel")}>
                <div className="flex flex-col gap-1">
                    {members.map(member => (
                        <div
                            key={member.instance}
                            data-collaboration-member={member.account}
                            className="flex min-h-6 items-center gap-2 text-sm text-fg-muted"
                        >
                            <LiveMemberAvatars members={[member]} host={host} size="md" />
                            <span className="min-w-0 flex-1 truncate">{member.account}</span>
                            <span className="shrink-0 text-2xs text-fg-subtle">
                                {member.instance === view.self
                                    ? t("workspace.shell.team.liveThisMachine")
                                    : t(liveMemberRoleKey(member.account, host))}
                            </span>
                        </div>
                    ))}
                </div>
            </Block>

            {/* Drawn only while somebody is holding a line. An empty heading over an empty list is
                a heading that is on screen for the whole of a quiet afternoon. */}
            {claims.length > 0 && (
                <Block seam="claims" label={t("workspace.shell.team.liveClaimsLabel")}>
                    <div className="flex flex-col gap-0.5">
                        {claims.map(([account, count]) => (
                            <p
                                key={account}
                                data-collaboration-claim={account}
                                className="truncate text-2xs text-fg-muted"
                            >
                                {count === 1
                                    ? t("workspace.shell.team.liveClaimOne", { name: account })
                                    : t("workspace.shell.team.liveClaimMany", {
                                        name: account,
                                        count: String(count),
                                    })}
                            </p>
                        ))}
                    </div>
                </Block>
            )}

            {/* The host's last answer, where it was no. The notification said it once as it
                happened; this is where it can still be read a minute later. */}
            {refused !== null && (
                <p data-collaboration-seam="refusal" className="text-2xs text-warning">
                    {t(refused.key, refused.params)}
                </p>
            )}

            <Block seam="checkpoint" label={t("workspace.shell.team.liveCheckpoint")}>
                <p className="text-2xs text-fg-muted">
                    {view.checkpoint === null
                        ? t("workspace.shell.team.liveCheckpointNone")
                        : t("workspace.shell.team.liveCheckpointAt", {
                            version: view.checkpoint.slice(0, 7),
                        })}
                </p>
            </Block>

            <p data-collaboration-seam="frozen" className="text-2xs text-fg-subtle">
                {t("workspace.shell.team.liveFrozenWhat")}
            </p>
        </div>
    );
}

/** One labelled group. Spacing between groups and no rules, as every panel here is. */
function Block({ seam, label, children }: {
    seam: string;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div data-collaboration-seam={seam}>
            <FieldLabel as="div">{label}</FieldLabel>
            <div className="mt-1">{children}</div>
        </div>
    );
}

/** What the panel says when there is no session to describe. */
function Empty({ children }: { children: React.ReactNode }) {
    const { t } = useTranslation();
    return (
        <div className={cn("flex h-full flex-col items-center justify-center p-6 text-center")}>
            <EmptyState
                icon={<Radio className="h-5 w-5" />}
                title={t("workspace.shell.team.livePresence")}
            />
            {children}
        </div>
    );
}
