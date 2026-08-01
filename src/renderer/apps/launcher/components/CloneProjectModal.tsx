import { useState } from "react";
import { CloudDownload, FolderOpen, Loader2 } from "lucide-react";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/lib/components/elements/Button";
import { Input } from "@/lib/components/elements/Input";
import { Modal } from "@/lib/components/elements/Modal";
import { cloneProjectFromServer } from "../projectActions";

interface CloneProjectModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Getting a project off a version-control server for the first time.
 *
 * **This is the only way a second person joins a project**, which is why it is in the launcher:
 * at the moment it is needed there is no project open to reach a workspace panel from. Everything
 * else about servers lives in the version rail, because everything else is about a project that
 * already exists here.
 *
 * Two fields and no more. The address is the one string the project's owner hands out - the same
 * one their own rail shows them - and it carries the repository name at the end, which is what the
 * server knows it by. The folder is picked, never typed: it has to be empty, and a typed path that
 * turns out not to be is a refusal after the author has already committed to the idea.
 *
 * **No progress bar, deliberately.** The backend's clone events are collected and delivered when
 * the call finishes rather than as it runs, so anything drawn here would be a bar that sits at zero
 * and then vanishes - which reads as broken in exactly the situation (a big project, a slow link)
 * where the author most needs to believe it is working. A spinner that is honest about knowing
 * nothing beats a progress bar that lies. Turning the backend's per-fragment events into live
 * progress is a contained change to `invoke`, and it is the right time to add this.
 */
export function CloneProjectModal({ isOpen, onClose }: CloneProjectModalProps) {
    const { t } = useTranslation();
    const [url, setUrl] = useState("");
    const [destination, setDestination] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const ready = url.trim() !== "" && destination !== "" && !busy;

    const pickFolder = async () => {
        const picked = await getInterface().selectFolder();
        if (picked.success && picked.data.path) {
            setDestination(picked.data.path);
        }
    };

    const submit = async () => {
        if (!ready) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const failure = await cloneProjectFromServer(url, destination);
            // Success closes the launcher window from underneath us, so there is deliberately
            // nothing here for the success path to do.
            if (failure !== null) {
                setError(failure);
            }
        } catch (thrown) {
            setError(thrown instanceof Error ? thrown.message : String(thrown));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={busy ? () => undefined : onClose}
            title={t("launcher.projects.clone.title")}
            size="sm"
            // A clone writes a whole project to disk; dismissing the window it reports into
            // while it runs would leave that happening with nothing watching.
            closeOnOverlayClick={!busy}
            closeOnEscape={!busy}
            footer={
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={busy}>
                        {t("launcher.projects.clone.cancel")}
                    </Button>
                    <Button onClick={submit} disabled={!ready}>
                        {busy
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <CloudDownload className="h-4 w-4" />}
                        {t("launcher.projects.clone.confirm")}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <div>
                    <label className="mb-1 block text-xs text-fg-muted">
                        {t("launcher.projects.clone.addressLabel")}
                    </label>
                    <Input
                        fullWidth
                        autoFocus
                        value={url}
                        onChange={event => setUrl(event.target.value)}
                        disabled={busy}
                        placeholder="lore://studio.example.lan:41337/my-game"
                    />
                    <p className="mt-1 text-2xs text-fg-subtle">
                        {t("launcher.projects.clone.addressHint")}
                    </p>
                </div>

                <div>
                    <label className="mb-1 block text-xs text-fg-muted">
                        {t("launcher.projects.clone.folderLabel")}
                    </label>
                    <div className="flex items-center gap-2">
                        <Input
                            fullWidth
                            readOnly
                            value={destination}
                            disabled={busy}
                            placeholder={t("launcher.projects.clone.folderPlaceholder")}
                        />
                        <Button variant="ghost" onClick={pickFolder} disabled={busy}>
                            <FolderOpen className="h-4 w-4" />
                        </Button>
                    </div>
                    <p className="mt-1 text-2xs text-fg-subtle">
                        {t("launcher.projects.clone.folderHint")}
                    </p>
                </div>

                {busy && (
                    <p className="text-2xs text-fg-muted">{t("launcher.projects.clone.working")}</p>
                )}
                {error && <p className="text-2xs text-danger">{error}</p>}
            </div>
        </Modal>
    );
}
