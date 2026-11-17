import { useCallback, useMemo, useState } from "react";
import { Radio } from "lucide-react";

import { Button, FieldLabel } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import {
    listLiveSessions,
    useTeamConnection,
    useTeamTopics,
    type TeamOutcome,
} from "@/lib/team";
import { teamProjectLiveTopic, type TeamLiveSession } from "@shared/types/team";
import type { VcsServerProject } from "@shared/types/vcs";
import { joinLiveSession } from "../projectActions";

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
 * A room is listed under the project it is about, for the rooms a server lists at all. The
 * launcher used to carry a second way in - four digits typed above the project list - and no
 * longer draws one.
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
