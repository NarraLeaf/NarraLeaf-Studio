import { Services } from "../../services";
import { CharacterService } from "../../core/CharacterService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

/** The slice of a character the index needs; matches the character profile structurally. */
export interface SearchableCharacter {
  id: string;
  name: string;
  /** Group the character was filed under, shown as its context line. */
  groupName?: string;
  /** Cast/voice-actor note and any alias, searchable but not shown. */
  aux?: string;
}

/** Character slice: the cast, by name. Jumping reveals them selected in the characters panel. */
export function extractCharacterEntries(
  characters: readonly SearchableCharacter[]
): SearchIndexEntry[] {
  return characters
    .filter((character) => character.name)
    .map((character) => ({
      id: `character:${character.id}`,
      group: "character" as const,
      text: character.name,
      detail: character.groupName || undefined,
      aux: character.aux || undefined,
      target: { kind: "character" as const, characterId: character.id }
    }));
}

/**
 * The cast, in one slice.
 *
 * An *entity* source rather than a content one, and indexed here rather than left to quick open
 * because this index backs the one search box the author actually types into.
 *
 * No `dedupKey`: two characters that share a name are two people the author has to be able to pick
 * between, and the panel selection is per character.
 */
export const characterSource: SearchSource = {
  id: "character",
  groups: ["character"],
  dependsOn: [Services.Character],
  extract: (ctx) => {
    const characterService = ctx.services.get<CharacterService>(Services.Character);
    const groupNameById = new Map(
      characterService.listGroups().map((group) => [group.id, group.name])
    );
    return extractCharacterEntries(
      characterService.listCharacter().map((character) => {
        const profile = character.profile.getProfile();
        const groupId = character.profile.getGroupId();
        return {
          id: profile.id,
          name: profile.name,
          groupName: groupId ? groupNameById.get(groupId) : undefined,
          aux: profile.description || undefined
        };
      })
    );
  },
  // Fires per edit (a rename is a keystroke at a time), hence the debounce every source goes through.
  watch: (ctx, signal) =>
    ctx.services.get<CharacterService>(Services.Character).subscribe(() => signal.invalidate())
};
