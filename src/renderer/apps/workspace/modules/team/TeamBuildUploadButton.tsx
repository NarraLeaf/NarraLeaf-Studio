import { useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";

import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { useTeamCapability, useTeamConnection } from "@/lib/team";

import { useTeamProjectSurface } from "./TeamProjectContext";

type Upload =
    | { kind: "idle" }
    | { kind: "sending"; sent: number; total: number }
    | { kind: "done" }
    | { kind: "failed"; reason: string };

/**
 * "Put this on the server", beside one artifact of the project's last build.
 *
 * Shown only in a team project on a server that keeps builds, to an account that may upload them.
 * The window names the artifact; the main process holds it to what the last build recorded, does the
 * reading and reports how far it has got. A new upload is made the build to play - that is almost
 * always why somebody uploads one - and can be changed in the console afterwards.
 */
export function TeamBuildUploadButton({ path, name, platforms }: { path: string; name: string; platforms: readonly string[] }) {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const remoteOrigin = team.state.kind === "verified" ? team.remoteOrigin : null;
    const project = team.state.kind === "verified" ? team.state.project : null;
    const connection = useTeamConnection(remoteOrigin);
    const withBuilds = useTeamCapability(connection, "builds");
    const [upload, setUpload] = useState<Upload>({ kind: "idle" });

    useEffect(() => {
        if (upload.kind !== "sending") return;
        const token = getInterface().team.onUploadProgress(progress => {
            if (progress.artifact !== path) return;
            setUpload(previous => previous.kind === "sending" ? { kind: "sending", sent: progress.sent, total: progress.total } : previous);
        });
        return () => token.cancel();
    }, [upload.kind, path]);

    if (!remoteOrigin || !project || !withBuilds) return null;
    // A server older than roles answers none, and there everybody could upload.
    if (project.role !== undefined && project.role !== "owner" && project.role !== "editor") return null;

    const start = async () => {
        setUpload({ kind: "sending", sent: 0, total: 0 });
        const result = await getInterface().team.uploadBuild({
            remoteOrigin,
            projectId: project.id,
            artifact: path,
            name,
            ...(platforms.length === 1 ? { platform: platforms[0] } : {}),
            latest: true,
        });
        setUpload(result.success ? { kind: "done" } : { kind: "failed", reason: result.error ?? "" });
    };

    if (upload.kind === "sending") {
        const percent = upload.total > 0 ? Math.floor((upload.sent / upload.total) * 100) : 0;
        return (
            <span className="shrink-0 text-2xs tabular-nums text-fg-subtle" data-team-build-upload="sending">
                {t("workspace.shell.team.buildUpload.sending", { percent })}
            </span>
        );
    }
    if (upload.kind === "done") {
        return (
            <span className="shrink-0 text-2xs text-fg-subtle" data-team-build-upload="done">
                {t("workspace.shell.team.buildUpload.done")}
            </span>
        );
    }
    const button = (
        <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-md px-1 text-2xs text-fg-subtle hover:bg-fill hover:text-fg"
            data-tip={t("workspace.shell.team.buildUpload.tip")}
            data-team-build-upload={upload.kind}
            onClick={() => void start()}
        >
            <UploadCloud className="h-3 w-3" aria-hidden />
            {upload.kind === "failed" ? t("workspace.shell.team.buildUpload.retry") : t("workspace.shell.team.buildUpload.upload")}
        </button>
    );
    if (upload.kind !== "failed") return button;
    return (
        <span className="flex min-w-0 shrink items-baseline gap-1">
            <span className="min-w-0 truncate text-2xs text-danger" data-tip={upload.reason}>
                {t("workspace.shell.team.buildUpload.failed", { reason: upload.reason })}
            </span>
            {button}
        </span>
    );
}
