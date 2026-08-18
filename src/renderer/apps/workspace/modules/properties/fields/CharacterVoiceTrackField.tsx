import { useMemo, useState } from "react";
import {
  AUDIO_TRACK_ID_VOICE,
  audioTrackDescendantIds,
  resolveAudioTrack
} from "@shared/types/audioTrack";
import { Select } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useProjectAudioTracks } from "@/lib/story/useProjectAudioTracks";
import type { CustomFieldProps, SelectOption } from "../framework/types";
import type { CharacterEditorContext } from "../schemas/characterSchema";

/**
 * Which audio bus this character's voice lines play on.
 *
 * The motivating case of the whole bus tree: a bus of their own is what gives the *player* a slider
 * for one member of the cast, so they can turn a character down or off without touching the rest.
 *
 * A `custom` field rather than the framework's `select` for the same reason `CharacterColorField` is
 * one: the options come from a live project service (Project → Audio, which the author may be
 * editing in another tab) rather than from the character, and the property schema's context carries
 * only the character. It renders the framework's own `Select` at `fullWidth`, so the row is
 * indistinguishable from the plain `select` field two rows above it.
 *
 * **Only `voice` and its descendants are offered**, and that is a correctness rule rather than
 * tidiness: the engine refuses a voice clip that is not on the voice subtree, and it refuses it
 * while constructing the `Scene`, i.e. it would fail the compile rather than misplay one line.
 *
 * Creating the bus is the other half of the job and it deliberately stays in Project → Audio - a
 * mixer is a project-wide structure and building one from inside a character editor would hide it
 * from every other character. What this field does instead is say so, exactly when the author cannot
 * act: with nothing under `voice` yet, the select has one entry and no amount of clicking will
 * produce a second, so that is the one moment a pointer earns its line.
 */
export function CharacterVoiceTrackField({ data }: CustomFieldProps<CharacterEditorContext>) {
  const { t } = useTranslation();
  const profile = data.character.profile;
  const tracks = useProjectAudioTracks();
  // Local so the select answers the click immediately, but tagged with whose value it is: the
  // panel reuses one mounted field across characters, so plain `useState` would show the previous
  // character's bus until something else re-rendered.
  const characterId = profile.getId();
  const [draft, setDraft] = useState(() => ({
    characterId,
    trackId: profile.getVoiceTrackId() ?? ""
  }));
  const trackId =
    draft.characterId === characterId ? draft.trackId : (profile.getVoiceTrackId() ?? "");

  const buses = useMemo(() => {
    const descendants = audioTrackDescendantIds(tracks, AUDIO_TRACK_ID_VOICE);
    return tracks.filter((track) => descendants.has(track.id));
  }, [tracks]);

  const options = useMemo<SelectOption[]>(() => {
    // The seeded voice bus is the empty value, not an id: "unset" and "pointed at `voice`" are
    // the same playback, and storing the id would make a character that was never touched look
    // different in the document from one that was set back to the default.
    const voiceBus = resolveAudioTrack(tracks, undefined, AUDIO_TRACK_ID_VOICE);
    const entries: SelectOption[] = [
      { value: "", label: voiceBus.name },
      ...buses.map((track) => ({ value: track.id, label: track.name }))
    ];
    // A stored id that is neither `voice` nor beneath it - the bus was deleted, or re-parented
    // out of the voice subtree. Shown as itself rather than dropped: a select that silently
    // displayed "Voice" would tell the author their character is on the default bus, which is
    // where it PLAYS but not what the document says, so they would never think to fix it.
    if (trackId && !entries.some((entry) => entry.value === trackId)) {
      entries.push({ value: trackId, label: t("characters.properties.voiceTrackMissing") });
    }
    return entries;
  }, [buses, t, trackId, tracks]);

  const commit = (next: string): void => {
    setDraft({ characterId, trackId: next });
    profile.setVoiceTrackId(next || null);
  };

  return (
    <div className="min-w-0">
      <Select
        fullWidth
        options={options}
        value={trackId}
        onChange={(value) => commit(String(value))}
      />
      {buses.length === 0 && (
        <p className="mt-1 text-xs text-fg-subtle">{t("characters.properties.voiceTrackEmpty")}</p>
      )}
    </div>
  );
}
