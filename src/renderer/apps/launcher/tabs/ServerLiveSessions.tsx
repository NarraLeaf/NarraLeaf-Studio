import { useCallback, useMemo, useState } from "react";
import { Radio } from "lucide-react";

import { Button, FieldLabel, Input } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import {
    findLiveSessionByCode,
    listLiveSessions,
    useTeamConnection,
    useTeamTopics,
    type TeamOutcome,
} from "@/lib/team";
import { teamProjectLiveTopic, type TeamLiveSession } from "@shared/types/team";
import type { VcsLocalRepository, VcsServerProject } from "@shared/types/vcs";
import { joinLiveSession } from "../projectActions";
import { localCopyOf } from "./localCopy";

/**
 * Every way into somebody else's live session, and the only place there is one.
 *
 * ⚠ **This is where joining lives, and the workspace deliberately has no control for it.** A
 * room's membership is recorded per instance and a launcher window is a different instance from
 * the workspace it opens, so the launcher cannot join on the editor's behalf - what it does is
 * the half the editor cannot: work out which room is meant, fetch the project when this machine
 * has never had it, and hand the intent to the window it opens. Cloning needs a window with no
 * project open, which is this one; a join control in the editor would work only for the people
 * who already had the project.
 *
 * Two ways in, because a room can be found two ways. One is listed under the project it is
 * about, for the rooms a server lists at all. The other is four digits, which exist precisely
 * so that somebody who has never had the project - and so cannot find it under anything - can
 * still be let in by being read a number over a call.
 */

/**
 * The rooms open on one project, under the project itself.
 *
 * **Only drawn where the server offers rooms, and only where there are any.** A section that
 * said "nobody is collaborating on this" would be on every project screen in the launcher,
 * saying nothing, for ever.
 */
export function ProjectLiveSessions({ remoteOrigin, project, localPath }: {
    remoteOrigin: string;
    project: VcsServerProject;
    /** Where this machine keeps this project, or null when it has never had it. */
    localPath: string | null;
}) {
    const connection = useTeamConnection(remoteOrigin);
    // What the server said it serves, which it goes on having said while the session is down -
    // see `TeamClient.dropped`. A section that vanished on a restart would be claiming the
    // deployment does not do this, which is a different statement.
    if (!connection.capabilities.includes("live")) {
        return null;
    }
    return <Rooms remoteOrigin={remoteOrigin} project={project} localPath={localPath} />;
}

function Rooms({ remoteOrigin, project, localPath }: {
    remoteOrigin: string;
    project: VcsServerProject;
    localPath: string | null;
}) {
    const { t } = useTranslation();
    const [failure, setFailure] = useState<string | null>(null);
    const [entering, setEntering] = useState(false);

    const read = useCallback(
        (): Promise<TeamOutcome<TeamLiveSession[]>> => listLiveSessions(remoteOrigin, project.id),
        [remoteOrigin, project.id],
    );
    const topics = useMemo(() => [teamProjectLiveTopic(project.id)], [project.id]);
    const { value } = useTeamTopics(remoteOrigin, topics, read);

    // ⚠ A room joined by passcode is not in this list for anybody outside it, and the server is
    // what keeps it out - see `TeamLiveJoinRule`. The field below is how those are reached.
    const rooms = value ?? [];
    if (rooms.length === 0) {
        return null;
    }

    const enter = async (room: TeamLiveSession): Promise<void> => {
        setEntering(true);
        setFailure(await joinLiveSession({
            joinLive: { session: room.id },
            localPath,
            remote: project.remote,
            unreachable: t("launcher.servers.live.unreachable"),
        }));
        setEntering(false);
    };

    return (
        <section className="mt-4" data-project-live>
            <FieldLabel as="div">{t("launcher.servers.live.title")}</FieldLabel>
            <ul className="space-y-1">
                {rooms.map(room => (
                    <li
                        key={room.id}
                        data-live-room={room.id}
                        className="flex items-center gap-2 rounded-md border border-edge px-3 py-2"
                    >
                        <Radio className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-fg">
                                {room.title ?? t("launcher.servers.live.untitled")}
                            </p>
                            <p className="truncate text-2xs text-fg-subtle">
                                {t("launcher.servers.live.hostedBy", { name: room.openedBy })}
                                {" · "}
                                {t("launcher.servers.live.members", {
                                    count: String(room.members.length),
                                })}
                            </p>
                        </div>
                        {/* Named after what pressing it does. A room joined by asking does not
                            let anybody in on the press - it puts a question in front of its
                            host - and a button that said "Join" would be promising that. */}
                        <Button
                            size="sm"
                            variant="secondary"
                            className="shrink-0"
                            disabled={entering}
                            data-live-room-action="join"
                            onClick={() => void enter(room)}
                        >
                            {t(room.rule === "request"
                                ? "launcher.servers.live.ask"
                                : "launcher.servers.live.join")}
                        </Button>
                    </li>
                ))}
            </ul>
            {failure !== null && (
                <p className="mt-1 text-xs text-danger" data-live-problem>{failure}</p>
            )}
        </section>
    );
}

/** How many digits a passcode has. One room, one code; see `TeamLiveJoinRule`. */
const PASSCODE_LENGTH = 4;

/**
 * The way into a room that is on no list.
 *
 * **Above the project list rather than inside any project**, because somebody typing four digits
 * does not know which project the room is about - that is the whole of what the passcode saves
 * them from having to know. The server answers which project it is, and everything after that is
 * the ordinary flow: fetch it if this machine has not got it, then open it and join.
 *
 * ⚠ **Nothing here says anything about how safe a passcode is.** Whoever opened the room means to
 * let people in; a line explaining what a four-digit number does not protect against would only
 * make an author afraid of a control that is working exactly as intended.
 */
export function JoinByPasscode({ remoteOrigin, projects, repositories }: {
    remoteOrigin: string;
    /** The server's projects, which is what turns a room's project id into an address. */
    projects: readonly VcsServerProject[];
    /** What this machine already has, which decides whether joining begins with fetching. */
    repositories: readonly VcsLocalRepository[];
}) {
    const connection = useTeamConnection(remoteOrigin);
    const { t } = useTranslation();
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    if (!connection.capabilities.includes("live")) {
        return null;
    }

    const ready = code.length === PASSCODE_LENGTH && !busy;

    const enter = async (): Promise<void> => {
        if (!ready) {
            return;
        }
        setBusy(true);
        setFailure(null);
        // Which room, without joining it: what happens next depends on the project it is about,
        // and this is the one live call that works from a window with no project open.
        const found = await findLiveSessionByCode(remoteOrigin, code);
        if (!found.ok) {
            // One sentence for a wrong code and for a code nobody is using, because the server
            // answers both with one - telling them apart would turn ten thousand guesses into a
            // map of which rooms exist.
            setFailure(t("launcher.servers.live.noSuchCode"));
            setBusy(false);
            return;
        }
        const room = found.value;
        const listed = projects.find(entry => entry.id === room.project) ?? null;
        setFailure(await joinLiveSession({
            // The digits rather than the id: a room reached this way refuses its own id, which is
            // what keeps "knowing the id" from being enough to walk in.
            joinLive: { code },
            localPath: listed === null
                ? null
                : localCopyOf(listed, repositories)?.path ?? null,
            remote: listed?.remote ?? null,
            unreachable: t("launcher.servers.live.unreachable"),
        }));
        setBusy(false);
    };

    return (
        <div className="mb-3 shrink-0" data-servers-passcode>
            <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">
                    {t("launcher.servers.live.passcodePrompt")}
                </span>
                <Input
                    size="sm"
                    className="w-24 font-mono tracking-[0.3em]"
                    inputMode="numeric"
                    maxLength={PASSCODE_LENGTH}
                    value={code}
                    aria-label={t("launcher.servers.live.passcodePrompt")}
                    data-servers-passcode-field
                    // Digits only, and never longer than a passcode is. A field that accepted
                    // anything would send the server strings it can only answer "no" to, and the
                    // author would read that as their code being wrong.
                    onChange={event => setCode(
                        event.target.value.replace(/\D/g, "").slice(0, PASSCODE_LENGTH),
                    )}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            void enter();
                        }
                    }}
                />
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={!ready}
                    data-servers-action="join-by-code"
                    onClick={() => void enter()}
                >
                    {t("launcher.servers.live.join")}
                </Button>
            </div>
            {failure !== null && (
                <p className="mt-1 text-xs text-danger" data-passcode-problem>{failure}</p>
            )}
        </div>
    );
}
