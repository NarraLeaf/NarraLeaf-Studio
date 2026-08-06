import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { useWorkspace } from "../../context";
import { createProjectIconPreview } from "../project/iconPreview";
import {
    outputsForTarget,
    resolveIconFile,
    resolveIconSource,
    type ProjectIconTarget,
} from "@shared/types/projectIcons";

/**
 * One target's app icon, as the packaged game will show it. Clicking hands the
 * user off to the project panel's asset settings — the icon is not the build's
 * to edit, but "the icon is wrong" is something you notice exactly here.
 */
export function BuildIconRow({
    target,
    onClick,
}: {
    target: ProjectIconTarget;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        const projectService = context.services.get<ProjectService>(Services.Project);
        let disposed = false;
        // Owned here: the object URL must outlive the await but die with the
        // component, or every dialog open leaks a decoded icon.
        let objectUrl: string | null = null;

        void (async () => {
            try {
                const set = projectService.getProjectIconSet();
                const file = resolveIconFile(set, outputsForTarget(target)[0].id);
                if (!file) {
                    return;
                }
                const bytes = await projectService.readProjectIconFile(file.path);
                if (!bytes || disposed) {
                    return;
                }
                const mediaType = file.baked ? "image/png" : resolveIconSource(set, target)?.mediaType ?? "image/png";
                const preview = await createProjectIconPreview(bytes, mediaType, file.path);
                if (disposed) {
                    URL.revokeObjectURL(preview.url);
                    return;
                }
                objectUrl = preview.url;
                setUrl(preview.url);
            } catch {
                // A preview that will not decode is exactly the "unusable icon"
                // preflight already reports; the empty tile says it too.
            }
        })();

        return () => {
            disposed = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [context, isInitialized, target]);

    return (
        <button
            type="button"
            onClick={onClick}
            title={t(`build.platform.${target}` as "build.platform.windows")}
            className="grid h-10 w-10 place-items-center overflow-hidden rounded-md border border-edge-subtle bg-fill-subtle transition-colors hover:border-edge-strong"
        >
            {url
                ? <img src={url} alt="" className="h-full w-full object-contain" />
                : <ImageOff className="h-3.5 w-3.5 text-fg-subtle" aria-label={t("build.identity.iconUnset")} />}
        </button>
    );
}
