import { useTranslation } from "@/lib/i18n";
import type { StoryBlock } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { useCharacterFace } from "./storyCharacterFace";
import type { CharacterAppearanceRef, VisibleStoryRow } from "./storySceneEditorTypes";
import { getBlockBadgeInfo, readableAccentColor } from "./storySceneBlockUtils";
import { paragraphActionCharacterId } from "./storyCharacterActions";
import {
  StoryCommandGlyphMark,
  StoryContinuationRule,
  StoryGutterCell,
  StoryNarratorRingMark,
  StorySpeakerDiscMark,
  StorySpeakerPortraitMark
} from "./StoryRowGutterMark";
import {
  characterSpeakerIdentity,
  narratorSpeakerIdentity,
  unknownSpeakerIdentity,
  type StorySpeakerIdentity
} from "./storySpeakerIdentity";

/**
 * The row → mark decision: everything the gutter needs to know about one row, in one place.
 *
 * Kept apart from the row component because the rule it encodes is the whole point of the column
 * (gutter 规范 §0) and is very easy to erode one special case at a time. Every question the gutter
 * answers is answered here, once:
 *
 *  1. Is this row still inside the paragraph above it? → the continuation rule, and nothing else.
 *  2. Does a specific person speak it? → their face, or a disc of their colour bearing their initial.
 *  3. Is it speech with nobody behind it? → the narrator's hollow ring.
 *  4. Otherwise it is machinery → a bare stroke glyph.
 *
 * They are asked in that order and the first hit wins, which is what stops a row from ever drawing
 * two marks or arguing with the paragraph it belongs to.
 */

/**
 * Who speaks a row, or `null` when nobody does (it is machinery).
 *
 * A dialogue row whose speaker is not set yet still resolves to a solid mark — a neutral one, since
 * there is no name to take a hue from. That is §3.1 held to even in the incomplete state: an
 * unassigned line is a line somebody will say, and letting it fall back to the hollow ring would file
 * it, at a glance, as narration.
 */
export function rowSpeakerIdentity(
  block: StoryBlock,
  characters: Character[],
  narratorLabel: string,
  unassignedLabel: string
): StorySpeakerIdentity | null {
  if (block.kind !== "nodeAction") {
    return null;
  }
  if (block.payload.action === "narration") {
    return narratorSpeakerIdentity(narratorLabel);
  }
  if (block.payload.action !== "dialogue") {
    return null;
  }
  if (block.payload.characterId) {
    return characterIdentity(block.payload.characterId, characters);
  }
  if (block.payload.speakerName) {
    // A bare name with no Studio character behind it is a perfectly ordinary speaker (the dialogue
    // box binds to a name, not to a `Character`), so it takes a hue from that name like anyone
    // else. Two projects that both write `Guard` get the same Guard.
    return characterSpeakerIdentity(block.payload.speakerName, { hasPortrait: false });
  }
  return unknownSpeakerIdentity(unassignedLabel);
}

/**
 * One character's identity, by id — exported because the nametag needs the very same answer the mark
 * does. §3.3 is a promise about a character being ONE colour everywhere they appear, and the only way
 * to keep it is for every surface to ask the same function rather than each deriving its own.
 */
export function characterIdentity(
  characterId: string,
  characters: Character[]
): StorySpeakerIdentity {
  const character = characters.find((candidate) => candidate.profile.getId() === characterId);
  if (!character) {
    return unknownSpeakerIdentity("?");
  }
  return characterSpeakerIdentity(character.profile.getName(), {
    // Whether artwork EXISTS is not knowable here (it needs the asset library and the compositor),
    // so this is the optimistic answer and `StoryRowGutter` downgrades to the disc when nothing
    // actually loads. The two shapes are the same size and the same colour family, so the
    // correction is invisible even on a cold asset cache.
    hasPortrait: true,
    // The project's own colour for this character, used exactly as chosen — the editor follows
    // the author here rather than deriving its own idea of the hue. A stored colour may be a
    // link at the project palette, so `readableAccentColor` resolves it before judging it.
    //
    // The one filter is the readability band, and it is a both-themes guard rather than a
    // matter of taste: this colour is painted on the dark surface and the light one, so a
    // near-black or near-white pick is invisible on whichever it matches. Those fall back to the
    // name hash, which is at least legible on both. Everything else is honoured verbatim.
    color: readableAccentColor(character.profile.getColor())
  });
}

/**
 * The gutter cell for one row: the mark, and the state backdrop under it.
 *
 * `useCharacterFace` is called unconditionally (hooks must be), and it is cheap on the rows that have
 * no face: it resolves to `null` immediately and the id-keyed image cache means a sprite shared by
 * twenty rows is read, and its head located, once.
 */
export function StoryRowGutter(props: {
  row: VisibleStoryRow;
  characters: Character[];
  appearance?: CharacterAppearanceRef;
  /** The pointer is on this row, or it is the active one — the only thing the cell's container ever says (§8). */
  active: boolean;
}) {
  const { t } = useTranslation();
  const block = props.row.block;
  const { url, frame, showingSprite } = useCharacterFace(
    block,
    props.appearance,
    props.characters,
    "plate"
  );
  const identity = rowSpeakerIdentity(
    block,
    props.characters,
    t("story.badge.narration"),
    t("story.characterName.unassigned")
  );

  if (props.row.groupRole === "member") {
    /*
     * A continuation draws the paragraph's rule and nothing else — including the rows that are
     * not speech at all: a line done to the run's own speaker (`/face`, `/motion`, `/move`, …) is
     * folded into it by `annotateDialogueGroups`, so it takes the run's colour rather than the
     * bare glyph it would wear standing alone. That is the ONE place a directive borrows a voice,
     * and it is why the lookup is here rather than in `rowSpeakerIdentity` — asked of every row,
     * it painted a disc on every `/show` and `/face` in the scene, which is exactly the
     * "有图标的是机器" line the gutter exists to hold.
     */
    const actingOn = paragraphActionCharacterId(block, props.characters);
    const voice = identity ?? (actingOn ? characterIdentity(actingOn, props.characters) : null);
    if (voice) {
      return (
        <StoryGutterCell active={props.active} decorative stretch>
          <StoryContinuationRule identity={voice} />
        </StoryGutterCell>
      );
    }
  }
  if (identity) {
    return (
      <StoryGutterCell active={props.active} decorative>
        {identity.kind === "ring" ? (
          <StoryNarratorRingMark label={identity.name} />
        ) : identity.kind === "portrait" && url ? (
          <StorySpeakerPortraitMark
            identity={identity}
            url={url}
            frame={frame}
            showingSprite={showingSprite}
          />
        ) : (
          <StorySpeakerDiscMark identity={identity} />
        )}
      </StoryGutterCell>
    );
  }
  // Both halves come from the one badge lookup, which is what keeps this mark and the manual entry
  // that could have written the row identical: `icon` is the command's own glyph, `iconColor` the
  // hue of the category it is filed under (and the danger tone for a line that does not resolve).
  const badge = getBlockBadgeInfo(block);
  return (
    <StoryGutterCell active={props.active}>
      <StoryCommandGlyphMark icon={badge.icon} label={badge.label} color={badge.iconColor} />
    </StoryGutterCell>
  );
}
