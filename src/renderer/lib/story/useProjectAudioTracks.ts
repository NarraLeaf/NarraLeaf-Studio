import { useEffect, useMemo, useState } from "react";
import { BUILTIN_AUDIO_TRACKS, type ProjectAudioTrack } from "@shared/types/audioTrack";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";

/**
 * The project's audio tracks, live.
 *
 * Three story surfaces need the same list - the action inspector's Track select, the scene rail's
 * music control, and the command line's candidate source - and each of them needs it to follow an
 * edit made over in Project → Audio without a reload. One hook rather than three copies of the
 * subscribe/unsubscribe pair, because the copies would drift on which of them re-reads.
 *
 * Falls back to {@link BUILTIN_AUDIO_TRACKS} before services are up, so a caller never has to render
 * an empty select: those three are what an unset reference resolves to anyway, so the fallback names
 * the same tracks the compiler would use.
 *
 * Comments in English per project convention.
 */
export function useProjectAudioTracks(): ProjectAudioTrack[] {
  const { context, isInitialized } = useWorkspace();
  const service = useMemo(
    () =>
      context && isInitialized
        ? context.services.get<AudioTrackService>(Services.AudioTracks)
        : null,
    [context, isInitialized]
  );
  const [tracks, setTracks] = useState<ProjectAudioTrack[]>(() => [...BUILTIN_AUDIO_TRACKS]);

  useEffect(() => {
    if (!service) {
      setTracks([...BUILTIN_AUDIO_TRACKS]);
      return;
    }
    setTracks(service.listTracks());
    return service.onTracksChanged(setTracks);
  }, [service]);

  return tracks;
}
