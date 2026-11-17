import { useEffect, useState } from "react";

import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { createThread, useTeamCapability, useTeamConnection } from "@/lib/team";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import { storyCommentAnchor } from "@/lib/workspace/services/storyComments/storyCommentsTeamSync";
import type { WorkspacePlaytestFeedback } from "@shared/types/devMode";
import { teamAttachmentMarker, type TeamAnchor } from "@shared/types/team";

import { useTeamProjectSurface } from "./TeamProjectContext";

/** Where a note with no line playing is kept: beside the project rather than beside a row. */
const PLAYTEST_ANCHOR: TeamAnchor = { document: "playtest" };

/** The anchor a playtest note is put at - the line that was playing, or the project. */
export function playtestAnchor(row: WorkspacePlaytestFeedback["row"]): TeamAnchor {
    return row === null ? PLAYTEST_ANCHOR : storyCommentAnchor(row);
}

/** A note's body: what the author wrote, then the picture's marker on a line of its own. */
export function playtestBody(note: string, attachmentId: string): string {
    const text = note.trim();
    return text === "" ? teamAttachmentMarker(attachmentId) : `${text}\n\n${teamAttachmentMarker(attachmentId)}`;
}

/**
 * The note Dev Mode's "Send a playtest note" asks for.
 *
 * Dev Mode takes the picture and hands it here, because the workspace is the window that may speak
 * to the project's server. This shows the picture, asks what was wrong, puts the picture beside the
 * project's comments and opens a thread at the line that was playing, so the note reads in the story
 * editor next to the line it is about.
 *
 * Outside a team project - or on a server without pictures or comments - it says so rather than
 * dropping the picture without a word.
 */
export function TeamPlaytestFeedbackPrompt() {
    const { t } = useTranslation();
    const team = useTeamProjectSurface();
    const remoteOrigin = team.state.kind === "verified" ? team.remoteOrigin : null;
    const project = team.state.kind === "verified" ? team.state.project.id : null;
    const connection = useTeamConnection(remoteOrigin);
    const withPictures = useTeamCapability(connection, "attachments");
    const withComments = useTeamCapability(connection, "comments");
    const [feedback, setFeedback] = useState<WorkspacePlaytestFeedback | null>(null);
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    useEffect(() => {
        const token = getInterface().devMode.onPlaytestFeedback(arrived => {
            setFeedback(arrived);
            setNote("");
            setFailure(null);
        });
        return () => token.cancel();
    }, []);

    if (!feedback) return null;

    const close = () => {
        setFeedback(null);
        setNote("");
        setFailure(null);
    };
    const able = remoteOrigin !== null && project !== null && withPictures && withComments;

    const send = async () => {
        if (!able || !remoteOrigin || !project) return;
        setBusy(true);
        setFailure(null);
        try {
            const uploaded = await getInterface().team.uploadAttachment(remoteOrigin, project, feedback.dataUrl);
            if (!uploaded.success) {
                setFailure(uploaded.error ?? t("workspace.shell.team.playtest.failed"));
                return;
            }
            const thread = await createThread(remoteOrigin, {
                project,
                anchor: playtestAnchor(feedback.row),
                body: playtestBody(note, uploaded.data.attachment.id),
                clientId: uploaded.data.attachment.id,
            });
            if (!thread.ok) {
                setFailure(thread.problem.kind === "refused" ? thread.problem.detail : t("workspace.shell.team.playtest.failed"));
                return;
            }
            close();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            data-team-playtest-feedback
            className="pointer-events-auto fixed bottom-10 right-4 z-40 flex w-[360px] flex-col gap-2 rounded-lg border border-edge bg-surface-overlay p-3 text-xs text-fg shadow-lg"
        >
            <div className="font-medium">{t("workspace.shell.team.playtest.title")}</div>
            <img src={feedback.dataUrl} alt="" className="max-h-48 w-full rounded-md border border-edge object-contain" />
            <div className="text-fg-muted">
                {feedback.row === null ? t("workspace.shell.team.playtest.noRow") : t("workspace.shell.team.playtest.atRow")}
            </div>
            {able ? (
                <textarea
                    autoFocus
                    value={note}
                    disabled={busy}
                    rows={3}
                    placeholder={t("workspace.shell.team.playtest.placeholder")}
                    className="resize-none rounded-md border border-edge bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-primary"
                    onChange={event => setNote(event.target.value)}
                    onKeyDown={event => {
                        // A composing input method keeps Enter and Escape for its candidate window.
                        if (isImeKeyEvent(event)) return;
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            void send();
                        }
                        if (event.key === "Escape") close();
                    }}
                />
            ) : (
                <div className="text-fg-subtle">{t("workspace.shell.team.playtest.unavailable")}</div>
            )}
            {failure ? <div className="text-danger">{failure}</div> : null}
            <div className="flex justify-end gap-1">
                <button
                    type="button"
                    disabled={busy}
                    className="rounded-md px-2 py-0.5 text-fg-muted hover:bg-fill hover:text-fg"
                    onClick={close}
                >
                    {t("workspace.shell.team.playtest.cancel")}
                </button>
                {able ? (
                    <button
                        type="button"
                        disabled={busy}
                        className="rounded-md bg-primary px-2 py-0.5 text-on-primary hover:opacity-90 disabled:opacity-50"
                        onClick={() => void send()}
                    >
                        {busy ? t("workspace.shell.team.playtest.sending") : t("workspace.shell.team.playtest.send")}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
