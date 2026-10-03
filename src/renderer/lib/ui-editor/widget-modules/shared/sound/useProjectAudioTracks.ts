import { useEffect, useMemo, useState } from "react";
import { BUILTIN_AUDIO_TRACKS, type ProjectAudioTrack } from "@shared/types/audioTrack";
import { useWorkspace } from "@/apps/workspace/context";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import { Services } from "@/lib/workspace/services/services";

/**
 * The project's audio tracks, in the order the project Audio surface lists them, kept current.
 *
 * A subscription rather than a read because the list is project data an author can add to: an
 * "Ambience" track created on the Audio surface has to appear in a picker that is already open,
 * without the inspector being rebuilt. Falls back to the built-in tracks where there is no service to
 * ask (a component canvas outside a workspace), so a picker is never empty and never dead.
 */
export function useProjectAudioTracks(): readonly ProjectAudioTrack[] {
    const { context } = useWorkspace();
    const [revision, setRevision] = useState(0);
    const trackService = useMemo(
        () => (context ? context.services.get<AudioTrackService>(Services.AudioTracks) : null),
        [context],
    );

    useEffect(() => trackService?.onTracksChanged(() => setRevision(value => value + 1)), [trackService]);

    return useMemo(
        () => trackService?.listTracks() ?? [...BUILTIN_AUDIO_TRACKS],
        // `revision` is the subscription's only job: the service mutates its list in place.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [trackService, revision],
    );
}
