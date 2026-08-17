import { useCallback, useEffect, useState } from "react";

import { getInterface } from "@/lib/app/bridge";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { TranslationKey } from "@shared/i18n";
import type {
    VcsServerProject,
    VcsServerProjectsProblem,
    VcsServerSession,
} from "@shared/types/vcs";

/** The sentence for each way a server can fail to say what it holds. */
const PROBLEM_KEYS: Record<VcsServerProjectsProblem["kind"], TranslationKey> = {
    "no-token": "wizard.source.onServerNoToken",
    refused: "wizard.source.onServerRefused",
    unreachable: "wizard.source.onServerUnreachable",
    rejected: "wizard.source.onServerUnknown",
    unknown: "wizard.source.onServerUnknown",
};

/** The host and port, which is what identifies a server to whoever was given it. */
function serverAddress(session: VcsServerSession): string {
    return session.remoteOrigin.replace(/^lore:\/\//i, "");
}

export interface ServerProjectPickerProps {
    /** The address as it stands, so the chosen row can be drawn as chosen. */
    value: string;
    /** Called with the project's own remote. The author never sees or types it. */
    onPick: (remote: string) => void;
}

/**
 * The projects on the servers this installation has been added to.
 *
 * **Choosing rather than typing is the whole point.** Every project on a server
 * already has an address, and until now the only way to reach one was for
 * somebody to send that address over and for the author to paste it exactly —
 * which is a step that exists only because Studio had no way to ask. It has one
 * now, so the address goes back to being what it is: a detail of the storage
 * that nobody should have to hold in their head.
 *
 * The list is asked for every time this opens rather than kept. A list that was
 * right when it was stored is wrong the moment a colleague pushes something new,
 * and this is one small request over a connection that is already trusted.
 *
 * Nothing here is a dead end. A server that has not been added, or one that
 * cannot be asked, leaves the address field below exactly as it was.
 */
export function ServerProjectPicker({ value, onPick }: ServerProjectPickerProps) {
    const { t } = useTranslation();
    const [servers, setServers] = useState<VcsServerSession[]>([]);
    const [chosen, setChosen] = useState<string | null>(null);
    const [projects, setProjects] = useState<VcsServerProject[] | null>(null);
    const [problem, setProblem] = useState<TranslationKey | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let alive = true;
        void getInterface().vcs.listServers().catch(() => null).then(result => {
            if (!alive) return;
            const found = result?.success ? result.data.servers : [];
            setServers(found);
            // One server is not a choice, so it is not presented as one.
            setChosen(found.length === 1 ? (found[0]?.remoteOrigin ?? null) : null);
        });
        return () => { alive = false; };
    }, []);

    const load = useCallback(async (remoteOrigin: string) => {
        setLoading(true);
        setProblem(null);
        setProjects(null);
        const result = await getInterface().vcs.listServerProjects(remoteOrigin).catch(() => null);
        setLoading(false);
        if (!result?.success) {
            setProblem("wizard.source.onServerUnknown");
            return;
        }
        if (!result.data.ok) {
            setProblem(PROBLEM_KEYS[result.data.problem.kind]);
            return;
        }
        setProjects(result.data.projects);
    }, []);

    useEffect(() => {
        if (chosen === null) return;
        void load(chosen);
    }, [chosen, load]);

    // Nothing to offer and nothing to say about it: the address field below is
    // the whole of the step, exactly as it was before this existed.
    if (servers.length === 0) return null;

    return (
        <div className="space-y-2" data-wizard-seam="server-projects">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-fg">{t("wizard.source.onServerLabel")}</span>
                <span className="text-xs text-fg-subtle">{t("wizard.source.onServerHint")}</span>
            </div>

            {servers.length > 1 && (
                <div className="flex flex-wrap gap-1">
                    {servers.map(session => (
                        <Button
                            key={session.remoteOrigin}
                            size="sm"
                            variant={chosen === session.remoteOrigin ? "secondary" : "ghost"}
                            className="h-7"
                            data-server-choice={session.remoteOrigin}
                            onClick={() => setChosen(session.remoteOrigin)}
                        >
                            {serverAddress(session)}
                        </Button>
                    ))}
                </div>
            )}

            <div className="overflow-hidden rounded-md border border-edge">
                {loading && (
                    <p className="px-3 py-2 text-xs text-fg-subtle">
                        {t("wizard.source.onServerLoading")}
                    </p>
                )}
                {!loading && problem !== null && (
                    <p className="px-3 py-2 text-xs text-danger">{t(problem)}</p>
                )}
                {!loading && problem === null && projects?.length === 0 && (
                    <p className="px-3 py-2 text-xs text-fg-subtle">
                        {t("wizard.source.onServerEmpty")}
                    </p>
                )}
                {!loading && problem === null && projects !== null && projects.map(project => (
                    <button
                        key={project.id}
                        type="button"
                        data-server-project={project.name}
                        onClick={() => onPick(project.remote)}
                        className={cn(
                            "flex w-full items-baseline justify-between gap-3 border-t border-edge px-3 py-2 text-left first:border-t-0 hover:bg-fill-subtle",
                            value === project.remote && "bg-fill-subtle",
                        )}
                    >
                        <span className="min-w-0">
                            <span className="block truncate text-sm text-fg">{project.name}</span>
                            {project.description !== "" && (
                                <span className="block truncate text-xs text-fg-subtle">
                                    {project.description}
                                </span>
                            )}
                        </span>
                        {project.createdBy !== undefined && (
                            <span className="shrink-0 text-xs text-fg-subtle">
                                {t("wizard.source.onServerMadeBy", { name: project.createdBy })}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
