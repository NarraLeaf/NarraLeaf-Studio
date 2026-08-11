import { useEffect, useMemo, useState } from "react";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";

/**
 * The project's build variants, live.
 *
 * One hook rather than a subscribe/unsubscribe pair per surface, for the reason
 * {@link useProjectAudioTracks} gives: every surface that names a variant has to follow an edit made
 * over in Project → App without a reload, and copies of the wiring drift on which of them re-reads.
 *
 * Falls back to the release variant before services are up, so a caller never has to render an empty
 * list: that is the variant an unset reference resolves to anyway, so the fallback names the same one
 * the build would use.
 *
 * Comments in English per project convention.
 */
export function useProjectAppTags(): ProjectAppTag[] {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<AppTagService>(Services.AppTags) : null),
        [context, isInitialized],
    );
    const [tags, setTags] = useState<ProjectAppTag[]>(() => [RELEASE_APP_TAG]);

    useEffect(() => {
        if (!service) {
            setTags([RELEASE_APP_TAG]);
            return;
        }
        setTags(service.listTags());
        return service.onTagsChanged(setTags);
    }, [service]);

    return tags;
}
