/**
 * What the launcher's two lists of team projects share: the Team tab's own list, and the home
 * list that takes them over under `team.projectsPlacement = "projects"`.
 *
 * Moved out of `ServersTab.tsx` rather than copied, so that making a project on a server, the
 * dialog for one the server would not take, and the one control that opens or fetches a project
 * read the same from either tab.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { getInterface } from "@/lib/app/bridge";
import { Button, ConfirmModal, Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { listProjects } from "@/lib/team";
import { revisionAuthorLabel } from "@/lib/vcs/identifierDisplay";
import { serverDisplayName } from "@/lib/vcs/servers";
import type { TranslationKey } from "@shared/i18n";
import { serverProblemFromTeam } from "@shared/types/vcs";
import type {
    VcsLocalRepository,
    VcsServerProject,
    VcsServerProjectsProblem,
    VcsServerSession,
} from "@shared/types/vcs";

import { SERVER_PROBLEM_KEYS } from "./serverProblemKeys";

/**
 * A project the server has read and found nothing inside.
 *
 * **Zero is a fact and absent is not**, which is the whole of the test. A server that has
 * not read a repository leaves the count out - the ordinary state for a project registered
 * a moment ago - and reading that as "empty" would refuse to fetch a project that is
 * perfectly full. Only a count that is there and is zero says nobody has sent anything.
 *
 * What it decides is whether there is anything to fetch. A clone of a repository with no
 * revisions succeeds, writes a `.lore` directory and nothing else, and leaves the folder
 * the author picked holding something that is not a project and cannot be cloned into
 * again - so the answer is to say what is there rather than to offer the copy.
 */
export function isEmptyOnServer(project: VcsServerProject): boolean {
    return project.history?.revisions === 0;
}

/** Open a project on this disk in a workspace, retiring the launcher. */
export function openProjectPath(projectPath: string): void {
    void getInterface().workspace.launch({ projectPath }, true);
}

/** What this machine already holds, by repository id: the remembered projects, read once. */
export function useLocalRepositories(): {
    repositories: VcsLocalRepository[];
    readLocal: () => Promise<void>;
} {
    const [repositories, setRepositories] = useState<VcsLocalRepository[]>([]);
    const readLocal = useCallback(async () => {
        const result = await getInterface().vcs.listLocalRepositories().catch(() => null);
        setRepositories(result?.success ? result.data.repositories : []);
    }, []);
    useEffect(() => {
        void readLocal();
    }, [readLocal]);
    return { repositories, readLocal };
}

/**
 * The projects on one server, read when the server (or its sign-in) changes. Null session reads
 * nothing. `drop` takes one off the list once the server has forgotten it.
 */
export function useServerProjectList(session: VcsServerSession | null): {
    projects: VcsServerProject[] | null;
    problem: TranslationKey | null;
    reading: boolean;
    drop: (projectId: string) => void;
} {
    const [projects, setProjects] = useState<VcsServerProject[] | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [reading, setReading] = useState(false);
    const remoteOrigin = session?.remoteOrigin ?? null;
    const signedInAt = session?.signedInAt;

    useEffect(() => {
        setProjects(null);
        setProblem(null);
        if (remoteOrigin === null) {
            setReading(false);
            return;
        }
        let alive = true;
        setReading(true);
        void listProjects(remoteOrigin).then(result => {
            if (!alive) return;
            setReading(false);
            if (!result.ok) {
                setProblem(SERVER_PROBLEM_KEYS[serverProblemFromTeam(result.problem).kind]);
                return;
            }
            setProjects(result.value.projects);
        });
        return () => {
            alive = false;
        };
    }, [remoteOrigin, signedInAt]);

    const drop = useCallback((projectId: string) => {
        setProjects(current => current?.filter(entry => entry.id !== projectId) ?? current);
    }, []);

    return { projects, problem, reading, drop };
}

/**
 * Make a project for a server: write it on this disk, then send it there.
 *
 * **In that order, and the order is the fix.** This used to ask the server for a
 * project first and then run the clone flow over what came back - which is a repository
 * with no revisions in it, so the copy that landed was a `.lore` directory and nothing
 * else, reported to the author as "this is not a NarraLeaf project" over a folder they
 * could not clone into a second time. It also left the project it had registered on the
 * server, empty, for somebody to clear up by hand.
 *
 * So the project is made here, by the wizard that makes every other project, and the
 * server is what happens to it afterwards. Nothing is registered until there is
 * something to register, and a wizard closed without finishing leaves the server exactly
 * as it was.
 *
 * **A project that was written and not sent is still the author's project**, so a
 * refusal here does not throw it away and does not pretend it did not happen: it is
 * named, it is on disk, and it opens from the dialog that says so (`dialog`, which the
 * caller draws). Connecting it to a server is then the version rail's "Change server",
 * which is the same act with the project in front of them.
 */
export function useNewTeamProject(): {
    creating: boolean;
    newProject: (session: VcsServerSession) => Promise<void>;
    dialog: ReactNode;
} {
    const [creating, setCreating] = useState(false);
    const [unsent, setUnsent] = useState<{ project: UnsentProject; server: string } | null>(null);

    const newProject = useCallback(async (session: VcsServerSession) => {
        setCreating(true);
        setUnsent(null);
        const server = serverDisplayName(session);
        try {
            const made = await getInterface().app.launchProjectWizard({
                publishTo: { remoteOrigin: session.remoteOrigin, server },
            }).catch(() => null);
            // Cancelled, or a wizard that never opened. Neither is an error to report: the
            // author is looking at the list they started from.
            if (!made?.success || !made.data?.created) return;

            const { projectPath, projectName, appId } = made.data;
            const name = (projectName ?? "").trim();
            // **The app id, not the name.** A repository is addressed as
            // `lore://host:port/<name>`, which has no room for a space, and a server refuses
            // one that carries anything but letters, digits and separators - so a project
            // called "My Game" would be refused and one called in Chinese would be refused
            // twice over. The app id is lowercase letters, digits and hyphens, with dots only
            // between the parts of a reverse-domain id, by construction - all of which a
            // repository name may carry. The review page names it, so it is not a
            // substitution made behind the author.
            const repository = (appId ?? "").trim();
            const sent = repository === "" ? null : await getInterface().vcs
                .publishProject(projectPath, session.remoteOrigin, repository)
                .catch(() => null);
            if (sent !== null && sent.success && sent.data.ok) {
                openProjectPath(projectPath);
                return;
            }
            setUnsent({
                server,
                project: {
                    name,
                    path: projectPath,
                    // The server's coded refusal where there is one, and the backend's own
                    // sentence where the call threw - connecting and sending refuse that way,
                    // and what they say names the remedy.
                    problem: sent !== null && sent.success && !sent.data.ok ? sent.data.problem.kind : null,
                    detail: sent === null || sent.success ? "" : sent.error ?? "",
                },
            });
        } finally {
            setCreating(false);
        }
    }, []);

    const dialog = unsent === null ? null : (
        <UnsentProjectDialog
            project={unsent.project}
            server={unsent.server}
            onOpen={() => openProjectPath(unsent.project.path)}
            onClose={() => setUnsent(null)}
        />
    );

    return { creating, newProject, dialog };
}

/**
 * Open the copy that is here, or fetch one.
 *
 * **One control, two words.** Either this machine already has the project, in which case
 * there is a folder to open, or it does not, in which case there is a copy to fetch; it is
 * the same act at the same level either way. It is one button with one appearance, and the
 * only thing that changes is what it says.
 */
export function ProjectAction({
    project,
    local,
    onOpen,
    onGet,
}: {
    project: VcsServerProject;
    local: VcsLocalRepository | null;
    onOpen: (projectPath: string) => void;
    onGet: (remote: string) => void;
}) {
    const { t } = useTranslation();

    // Nothing has been sent to this project, so there is nothing to fetch. Drawn as no
    // control rather than as a refused one: the page below says what is there. A copy
    // already on this machine still opens.
    if (local === null && isEmptyOnServer(project)) {
        return null;
    }

    return (
        <Button
            size="sm"
            variant="primary"
            className="shrink-0"
            onClick={() => (local !== null ? onOpen(local.path) : onGet(project.remote))}
            data-project-action={local !== null ? "open" : "get"}
            data-tip={local?.path}
        >
            {t(local !== null ? "launcher.servers.open" : "launcher.servers.get")}
        </Button>
    );
}

/**
 * When the last version was recorded and by whom, or nothing at all.
 *
 * **A server that has not read the repository sends `history: {}`** - an object with no
 * facts in it - and one older than the claim sends nothing; both mean the same thing, and
 * neither means a project with no versions. So the line is written from what is there:
 * absent means silence, never "0 versions", never "never", and never a date in 1970.
 */
export function lastVersionLine(
    project: VcsServerProject,
    account: VcsServerSession["account"],
    t: ReturnType<typeof useTranslation>["t"],
    formatDate: ReturnType<typeof useTranslation>["formatDate"],
): string | null {
    const at = project.history?.lastAt;
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
    const date = formatDate(at, { year: "numeric", month: "short", day: "numeric" });
    // The rule the project's own page draws its author by: a version a sync merged before the
    // author's name was put on such merges records an account id, which is this installation's own
    // name when it is this account and nobody's otherwise.
    const by = revisionAuthorLabel(project.history?.lastBy, account);
    return by
        ? t("launcher.servers.lastVersionBy", { date, name: by })
        : t("launcher.servers.lastVersion", { date });
}

/**
 * A project that was written on this disk and that its server would not take.
 *
 * Held rather than dropped, because the two halves of the act came apart and only one of
 * them failed: the project exists, it is complete, and it is under version control. What
 * is missing is the connection to the server, which is a thing the workspace can do with
 * the project in front of the author.
 */
interface UnsentProject {
    /** What the project is called, as it was named in the wizard. */
    name: string;
    /** Where it was written. */
    path: string;
    /** The server's coded refusal, when the server gave one. */
    problem: VcsServerProjectsProblem["kind"] | null;
    /** The backend's own sentence, when connecting or sending threw one. */
    detail: string;
}

/**
 * Say that a project was made and not sent, and offer the one thing left to do about it:
 * open it, since the version rail is where a project is pointed at a server.
 */
function UnsentProjectDialog({
    project,
    server,
    onOpen,
    onClose,
}: {
    project: UnsentProject;
    server: string;
    onOpen: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const reason = project.problem === null ? "" : t(SERVER_PROBLEM_KEYS[project.problem]);

    return (
        <Modal
            isOpen
            onClose={onClose}
            title={t("launcher.servers.unsent.title")}
            size="sm"
            footer={(
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className={dialogFooterButtonClass({ variant: "secondary" })}
                    >
                        {t("launcher.servers.unsent.close")}
                    </button>
                    <button
                        type="button"
                        onClick={onOpen}
                        data-servers-action="open-unsent"
                        className={dialogFooterButtonClass({ variant: "primary" })}
                    >
                        {t("launcher.servers.unsent.open")}
                    </button>
                </div>
            )}
        >
            <div className="space-y-2">
                <p className="text-sm text-fg">
                    {t("launcher.servers.unsent.message", { name: project.name, server })}
                </p>
                {reason !== "" && <p className="text-xs text-fg-muted">{reason}</p>}
                {project.detail !== "" && (
                    <p className="break-words text-xs text-fg-muted">{project.detail}</p>
                )}
                <p className="break-all text-2xs text-fg-subtle">{project.path}</p>
            </div>
        </Modal>
    );
}

/**
 * Asked when a team project with no copy on this disk is picked from a list: whether to fetch one.
 *
 * A question rather than the wizard straight away, because the row looks like every other row on
 * the home list and the author may have meant to open something already here. Confirming runs the
 * same clone flow the project's own page does, which asks where the copy goes.
 */
export function CloneProjectDialog({
    project,
    server,
    onClone,
    onClose,
}: {
    project: VcsServerProject;
    server: string;
    onClone: (remote: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    return (
        <ConfirmModal
            isOpen
            onClose={onClose}
            onConfirm={() => {
                onClose();
                onClone(project.remote);
            }}
            title={t("launcher.projects.team.clone.title")}
            message={t("launcher.projects.team.clone.message", { name: project.name, server })}
            confirmText={t("launcher.projects.team.clone.confirm")}
            // Cloning only adds a folder; nothing here is lost by saying yes.
            variant="primary"
        />
    );
}
