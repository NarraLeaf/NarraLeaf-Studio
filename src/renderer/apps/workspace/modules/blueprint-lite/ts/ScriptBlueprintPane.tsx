import { useEffect, useState } from "react";
import { FileCode2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { ScriptOpenMenu } from "./ScriptOpenMenu";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";

type Props = {
    context: WorkspaceContext;
    /** Project-relative path of the author's file, under `scripts/`. */
    scriptRef: string;
};

/**
 * What a script blueprint shows: which file it runs, and a way into the author's own editor.
 *
 * There is no editor here, and that is the design rather than a gap. `<project>/scripts/` is the one
 * directory whose bytes the disk owns: Studio holds its documents as an in-memory copy and writes
 * the whole copy back when it saves, so an editor over a script would write that copy back over an
 * edit made in another tool the next time anything saved. A second writer is what the directory
 * exists to prevent, so Studio hands the file to the tools the author already has.
 *
 * This replaced a textarea that edited the source inside the document. Nothing that textarea wrote
 * ever ran - no module was ever mounted from one - so what removing it costs is the ability to type
 * into a blueprint that did nothing.
 *
 * Reading it is a different question from editing it, and the answer is the read-only preview the
 * asset browser's Blueprints section opens (`ScriptPreviewEditor`). The pane an author reaches from
 * inside the blueprint editor stays the file name and a way out to their own tools.
 */
export function ScriptBlueprintPane({ context, scriptRef }: Props) {
    const { t } = useTranslation();
    const [missing, setMissing] = useState(false);

    const projectPath = context.project.getConfig().projectPath;

    useEffect(() => {
        let cancelled = false;
        const fs = context.services.get<FileSystemService>(Services.FileSystem);
        void fs.isFileExists(context.project.resolve(scriptRef.split("/"))).then(result => {
            // A read that failed is not the same fact as a file that is not there, and only the
            // second one is the author's to act on. An unreadable path says nothing here.
            if (!cancelled && result.ok) {
                setMissing(!result.data);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [context, scriptRef]);

    return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 border border-edge bg-surface-sunken p-6">
            <FileCode2 className="h-6 w-6 text-fg-muted" aria-hidden />
            <div className="flex min-w-0 flex-col items-center gap-1">
                <span className="text-2xs text-fg-muted">{t("blueprint.script.fileLabel")}</span>
                <span className="max-w-full truncate font-mono text-xs text-fg">{scriptRef}</span>
            </div>
            {missing ? <span className="text-2xs text-danger">{t("blueprint.script.missing")}</span> : null}
            <ScriptOpenMenu projectPath={projectPath} scriptRef={scriptRef} />
        </div>
    );
}
