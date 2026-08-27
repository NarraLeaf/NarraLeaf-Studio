import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/lib/components/elements/Button";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Modal } from "@/lib/components/elements/Modal";
import { Select } from "@/lib/components/elements/Select";
import { refuseLiveSessionEntry } from "@/lib/team/liveSessionEntry";
import type { StoryId } from "@shared/types/story";
import type { TeamLiveJoinRule, TeamLiveMember, TeamLiveSession } from "@shared/types/team";
import type { TranslationKey } from "@shared/i18n";
import { useWorkspaceFreeze } from "../../hooks/useWorkspaceFrozen";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";
import { LiveMemberAvatars } from "./LiveMemberAvatars";
import {
    liveEndSentence,
    liveEntryFailureRemedy,
    liveEntryFailureSentence,
    liveLeaveAct,
    liveMemberRoleKey,
    liveStandingKey,
} from "./liveSessionText";
import { useJoinableRoom, useLiveSession, useLiveSessionStories } from "./useLiveSession";

/**
 * A live session, whole: what it is, who is in it, where this window's uncommitted work went, and
 * the one control that ends it.
 *
 * **Everything here is read from one subscription.** `LiveSessionView` moves as a single value - a
 * message arrives, a phase turns over, the room ends - and a dialog drawing from several readers
 * would put several moments of the same session on screen at once.
 *
 * **The two ways in are dialogs because both are irreversible and neither is instant.** Starting
 * records a checkpoint, pushes it, opens the room on it and freezes the project; joining records a
 * checkpoint, brings the tree to the room's version and freezes the project. Neither can be
 * cancelled once pressed, so what they are about to do is stated where they are pressed rather than
 * discovered afterwards.
 *
 * **A `Modal`, and it has to be**: the story picker portals into the window's overlay layer, and a
 * body-level popover would paint over a dialog it opened and take both down on the first click
 * inside it (see `windowOverlayHost`). Modals nest; popovers over modals do not.
 *
 * ⚠ Nothing here calls the server's `live.open` / `live.join`. Entering a session is more than
 * opening a room - the tree is checkpointed and pushed, the workspace freezes behind it, and the
 * story editor's gestures start flowing to the room - so every act goes through `Services.Live` by
 * way of `useLiveSession`.
 */
export function LiveSessionDialog({ team, isOpen, onClose }: {
    team: TeamProjectSurface;
    isOpen: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const live = useLiveSession();
    const stories = useLiveSessionStories();
    // Asked of the freeze rather than derived from it, because the latch is a module-level
    // singleton: a session entered while the workspace is frozen for something else would replace
    // that freeze instead of adding to it. The acts behind these controls ask again for the reason.
    const freeze = useWorkspaceFreeze();
    const room = useJoinableRoom(team, live.view);
    const { view } = live;
    const inRoom = view.phase !== "idle";
    // Only where entering is what is being offered: inside a session the answer is always this
    // session's own freeze, which would read as the room refusing to let its own members in.
    const blocked = inRoom ? null : refuseLiveSessionEntry(freeze);

    /**
     * Which document a room opened from here would be about.
     *
     * Held rather than derived so the author's choice survives the library being re-read, and reset
     * to the suggestion whenever the dialog is opened - a picker still showing last week's pick is
     * a picker that decides for somebody who did not look at it.
     */
    const [chosen, setChosen] = useState<StoryId | null>(null);
    useEffect(() => {
        if (isOpen) {
            setChosen(stories.suggested);
        }
    }, [isOpen, stories.suggested]);

    const failure = view.entryFailure === null ? null : liveEntryFailureSentence(view.entryFailure);
    const remedy = view.entryFailure === null ? null : liveEntryFailureRemedy(view.entryFailure);
    // Survives into `idle` so it can still be read, so it is drawn only where this window is not in
    // a session - and never for an author who left of their own accord, who pressed the control and
    // watched the dialog change.
    const leaving = liveLeaveAct(view);
    const ended = inRoom ? null : view.ended;
    const endedSentence = ended === null ? null : liveEndSentence(ended);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t("workspace.shell.team.livePresence")}
            size="sm"
            footer={inRoom ? (
                <Button
                    data-live-act="leave"
                    // Named after what it does rather than after which half of the session this
                    // window is: a host walking out of a room with somebody else in it hands it
                    // over, and only a host walking out of a room of one ends anything.
                    variant={leaving.destructive ? "danger" : "secondary"}
                    disabled={live.busy || view.phase === "leaving"}
                    onClick={live.leave}
                >
                    {t(leaving.key)}
                </Button>
            ) : room !== null ? (
                <Button
                    data-live-act="join"
                    variant="primary"
                    disabled={live.busy || blocked !== null}
                    onClick={() => live.join({ session: room })}
                >
                    {t("workspace.shell.team.liveJoin")}
                </Button>
            ) : (
                <Button
                    data-live-act="open"
                    variant="primary"
                    disabled={live.busy || blocked !== null || chosen === null}
                    onClick={() => {
                        const story = stories.all.find(one => one.id === chosen);
                        if (story) {
                            // The story's own name, so the room is called what everybody in it is
                            // looking at. The revision comes from the checkpoint the session records
                            // on its way in, never from here.
                            live.open({ storyId: story.id, title: story.name });
                        }
                    }}
                >
                    {t("workspace.shell.team.liveOpen")}
                </Button>
            )}
        >
            <div data-live-dialog={view.phase} className="flex flex-col gap-4">
                {inRoom
                    ? <InSession team={team} live={live} />
                    : room !== null
                        ? <JoinOffer room={room} />
                        : <StartOffer stories={stories} chosen={chosen} onChoose={setChosen} />}

                {/* One line, and the current one. The session keeps the last refusal and the last
                    ending until something replaces them, so a column of every answer it has given
                    would put a refusal from ten minutes ago under the state standing now. */}
                {blocked !== null && (
                    <Note seam="blocked" tone="text-warning">{t(blocked.message)}</Note>
                )}
                {blocked === null && failure !== null && (
                    <div>
                        <Note seam="failure" tone="text-warning">{t(failure.key, failure.params)}</Note>
                        {/* The two refusals pressing the control again cannot get past. */}
                        {remedy !== null && <Note seam="remedy">{t(remedy)}</Note>}
                    </div>
                )}
                {blocked === null && failure === null && endedSentence !== null && (
                    <div>
                        <Note seam="ended" tone={ended?.cause === "diverged" ? "text-danger" : "text-fg-muted"}>
                            {t(endedSentence)}
                        </Note>
                        {ended?.cause === "diverged" && (
                            <Note seam="remedy">{t("workspace.shell.team.liveEndedDivergedNext")}</Note>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

/**
 * How people get into this room, and the digits they get in with. Host only.
 *
 * **Three controls that each say both halves**, because the two questions behind them are
 * different ones: whether the room can be found at all, and whether a person decides who comes in.
 * A list that said only "passcode" would leave an author to discover by trying it that the room
 * had also left the server's list.
 *
 * The digits are shown for every rule rather than only for the one that needs them. They belong to
 * the room and not to the setting: a host who switches to `code` has not been given a new passcode
 * and must not be led to think so, which is what the line under them says.
 */
function HowPeopleJoin({ live }: { live: ReturnType<typeof useLiveSession> }) {
    const { t } = useTranslation();
    const { view } = live;
    const [busy, setBusy] = useState(false);
    const rule = view.rule ?? "open";

    const choices: { value: TeamLiveJoinRule; label: TranslationKey; detail: TranslationKey }[] = [
        {
            value: "open",
            label: "workspace.shell.team.liveRuleOpen",
            detail: "workspace.shell.team.liveRuleOpenDetail",
        },
        {
            value: "request",
            label: "workspace.shell.team.liveRuleRequest",
            detail: "workspace.shell.team.liveRuleRequestDetail",
        },
        {
            value: "code",
            label: "workspace.shell.team.liveRuleCode",
            detail: "workspace.shell.team.liveRuleCodeDetail",
        },
    ];

    return (
        <div data-live-block="join-rule" className="mt-3 flex flex-col gap-2">
            <div className="flex flex-col gap-1" role="radiogroup">
                {choices.map(choice => (
                    <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={rule === choice.value}
                        data-live-rule={choice.value}
                        disabled={busy}
                        onClick={() => {
                            if (rule === choice.value) {
                                return;
                            }
                            setBusy(true);
                            void live.setRule(choice.value).finally(() => setBusy(false));
                        }}
                        className={cn(
                            "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left",
                            "transition-colors disabled:opacity-50",
                            rule === choice.value
                                ? "border-primary bg-primary/10"
                                : "border-line hover:bg-fill",
                        )}
                    >
                        <span className="text-xs text-fg">{t(choice.label)}</span>
                        <span className="text-2xs text-fg-subtle">{t(choice.detail)}</span>
                    </button>
                ))}
            </div>
            {view.code !== null && (
                <div data-live-block="join-code" className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xs text-fg-subtle">
                            {t("workspace.shell.team.liveCodeLabel")}
                        </span>
                        {/* Spaced out because it is read aloud as often as it is copied. */}
                        <span data-live-code className="font-mono text-sm tracking-[0.3em] text-fg">
                            {view.code}
                        </span>
                    </div>
                    <Note seam="code-fixed">{t("workspace.shell.team.liveCodeFixed")}</Note>
                </div>
            )}
        </div>
    );
}

/** What a session opened from here would do, and which document it would be about. */
function StartOffer({ stories, chosen, onChoose }: {
    stories: ReturnType<typeof useLiveSessionStories>;
    chosen: StoryId | null;
    onChoose: (story: StoryId) => void;
}) {
    const { t } = useTranslation();

    if (stories.all.length === 0) {
        // A project with no story has nothing to open a room on. It has everything it needs to join
        // one, which is why this is said here and not beside the join control.
        return <Note seam="no-story" tone="text-warning">{t("workspace.shell.team.liveNoStory")}</Note>;
    }

    return (
        <div data-live-block="start" className="flex flex-col gap-2">
            <div>
                <FieldLabel as="div">{t("workspace.shell.team.liveStory")}</FieldLabel>
                <Select
                    size="sm"
                    className="mt-1 w-full"
                    value={chosen ?? undefined}
                    options={stories.all.map(one => ({ value: one.id, label: one.name }))}
                    onChange={value => onChoose(value as StoryId)}
                />
            </div>
            <p className="text-2xs text-fg-muted">{t("workspace.shell.team.liveStartWhat")}</p>
        </div>
    );
}

/** The room somebody else has open: whose it is, what it is about, and what joining does. */
function JoinOffer({ room }: { room: TeamLiveSession }) {
    const { t } = useTranslation();
    return (
        <div data-live-block="join" className="flex flex-col gap-2">
            <div>
                <p className="truncate text-sm text-fg">
                    {room.title ?? t("workspace.shell.team.liveUntitled")}
                </p>
                <p className="mt-0.5 truncate text-2xs text-fg-muted">
                    {t("workspace.shell.team.liveHostedBy", { name: room.openedBy })}
                </p>
            </div>
            <MemberList members={room.members} host={room.openedBy} self={null} />
            <p className="text-2xs text-fg-muted">{t("workspace.shell.team.liveJoinWhat")}</p>
        </div>
    );
}

/** The session this window is in. */
function InSession({ team, live }: {
    team: TeamProjectSurface;
    live: ReturnType<typeof useLiveSession>;
}) {
    const { t } = useTranslation();
    const { view } = live;
    const standing = liveStandingKey(view);
    const pending = view.pendingIntents;
    const members = view.session?.members ?? [];

    return (
        <>
            {/* No eyebrow: the dialog is already titled with what this is, and a label repeating
                its own title over the room's name reads as branding rather than as a field. */}
            <div data-live-block="standing">
                <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {view.session?.title ?? t("workspace.shell.team.liveUntitled")}
                    </span>
                    {standing !== null && (
                        <span data-live-standing className="shrink-0 text-2xs text-fg-subtle">
                            {t(standing)}
                        </span>
                    )}
                </div>
                {/* Behind the room rather than following it: what is on screen is the version the
                    room opened on until everything since has been applied. */}
                {view.phase === "catching-up" && (
                    <Note seam="catching-up">{t("workspace.shell.team.liveCatchingUp")}</Note>
                )}
                {/* Whose room this is decides whether there is anything here to change. */}
                {view.role === "host" && <HowPeopleJoin live={live} />}
                {/* The guest's own traffic. A document does not move under a guest's hands until the
                    host answers, so without this a round trip in flight and an editor that has
                    stopped working look the same. Always zero for a host, and drawn at zero for
                    nobody: a counter that reads 0 all afternoon is a counter nobody reads. */}
                {pending > 0 && (
                    <Note seam="pending">
                        {pending === 1
                            ? t("workspace.shell.team.livePendingOne")
                            : t("workspace.shell.team.livePendingMany", { count: String(pending) })}
                    </Note>
                )}
            </div>

            <MemberList
                members={members}
                host={view.session?.openedBy ?? null}
                self={view.self}
            />

            {/* Where the work that was uncommitted on the way in went. A checkpoint nobody can name
                is a checkpoint nobody can go back to, and the version panel is not where somebody
                looks for it while a session is running. */}
            <div data-live-block="checkpoint">
                <FieldLabel as="div">{t("workspace.shell.team.liveCheckpoint")}</FieldLabel>
                <p className="mt-1 text-2xs text-fg-muted">
                    {view.checkpoint === null
                        ? t("workspace.shell.team.liveCheckpointNone")
                        : t("workspace.shell.team.liveCheckpointAt", {
                            version: shortRevision(view.checkpoint),
                        })}
                </p>
            </div>

            {/* What the session takes, said once. Otherwise it is discovered one greyed control at
                a time, across four panels. */}
            <p data-live-block="frozen" className="text-2xs text-fg-muted">
                {t("workspace.shell.team.liveFrozenWhat")}
            </p>

            {/* Only where the server knows of more windows on this project than are in the room.
                Otherwise it repeats the member list in a smaller font. */}
            {team.canSeeClients && team.clients.length > members.length && (
                <p data-live-block="clients" className="text-2xs text-fg-subtle">
                    {t("workspace.shell.team.hereMany", { count: String(team.clients.length) })}
                </p>
            )}
        </>
    );
}

/**
 * Who is in the room, one row each.
 *
 * The host is named rather than merely ringed, because leaving means something different for that
 * window: it ends the room for everybody. This window's own row says so too - a room of two where
 * both rows are somebody's account name is a room a reader has to work out their place in.
 */
function MemberList({ members, host, self }: {
    members: readonly TeamLiveMember[];
    host: string | null;
    self: string | null;
}) {
    const { t } = useTranslation();
    if (members.length === 0) {
        return null;
    }
    return (
        <div data-live-block="members">
            <FieldLabel as="div">{t("workspace.shell.team.liveMembersLabel")}</FieldLabel>
            <div className="mt-1 flex flex-col gap-1">
                {members.map(member => (
                    <div
                        key={member.instance}
                        data-live-member={member.account}
                        className="flex min-h-5 items-center gap-2 text-sm text-fg-muted"
                    >
                        <LiveMemberAvatars members={[member]} host={host} size="md" />
                        <span className="min-w-0 flex-1 truncate">{member.account}</span>
                        <span className="shrink-0 text-2xs text-fg-subtle">
                            {member.instance === self
                                ? t("workspace.shell.team.liveThisMachine")
                                : t(liveMemberRoleKey(member.account, host))}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

/** A line under a block, for the one thing that block cannot fit. */
function Note({ tone, seam, children }: {
    /** A tailwind text-colour class; the default is the muted one every value here uses. */
    tone?: string;
    seam?: string;
    children: React.ReactNode;
}) {
    return (
        <p data-live-note={seam} className={cn("mt-1 text-2xs", tone ?? "text-fg-muted")}>
            {children}
        </p>
    );
}

/**
 * A revision as much of it as a person can hold in their head.
 *
 * Lore revision ids are 64 hex characters and the version panel shows the same seven that every
 * other surface in Studio does.
 */
function shortRevision(revision: string): string {
    return revision.slice(0, 7);
}
