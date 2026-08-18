import { Character } from "@/lib/workspace/services/character/Character";
import { SelectOption, createPropertyEditorSchema } from "../framework";
import type { Translator } from "@shared/i18n";
import { CharacterAvatarField } from "../fields/CharacterAvatarField";
import { CharacterColorField } from "../fields/CharacterColorField";
import { CharacterVoiceTrackField } from "../fields/CharacterVoiceTrackField";

/** Translator function, threaded into schema builders since they run outside React. */
type TranslateFn = Translator["t"];

/**
 * Context for character property editor
 */
export interface CharacterEditorContext {
  character: Character;
  thumbnailUrl: string | null;
  /** A preset character's poses; empty for a layered one, whose default is per axis. */
  poses: Array<{ id: string; name: string }>;
}

/**
 * Character property editor schema
 */
export const characterPropertySchema = (t: TranslateFn) =>
  createPropertyEditorSchema<CharacterEditorContext>({
    id: "character",
    title: t("characters.properties.editorTitle"),
    fields: [
      {
        id: "thumbnail",
        type: "thumbnail",
        label: t("characters.properties.thumbnail"),
        getThumbnailUrl: (ctx) => ctx.thumbnailUrl,
        getThumbnailId: (ctx) => ctx.character.profile.getProfile().thumbnail,
        setThumbnail: async (ctx, id) => {
          ctx.character.profile.setThumbnail(id);
        },
        aspectRatio: 1,
        order: 10
      },
      {
        id: "name",
        type: "text",
        label: t("common.name"),
        placeholder: t("characters.properties.namePlaceholder"),
        getValue: (ctx) => ctx.character.profile.getProfile().name,
        setValue: async (ctx, value) => {
          ctx.character.profile.setName(value);
        },
        order: 20
      },
      {
        // Beside the name, not down with the appearance: the accent tints the *nametag*, so it
        // belongs to how the character is identified rather than to how it is drawn.
        id: "color",
        type: "custom",
        label: t("characters.properties.color"),
        component: CharacterColorField,
        order: 25
      },
      {
        id: "description",
        type: "textarea",
        label: t("common.description"),
        placeholder: t("characters.properties.descriptionPlaceholder"),
        rows: 4,
        getValue: (ctx) => ctx.character.profile.getProfile().description,
        setValue: async (ctx, value) => {
          ctx.character.profile.setDescription(value);
        },
        order: 30
      },
      {
        id: "tags",
        type: "tags",
        label: t("characters.properties.tags"),
        addPlaceholder: t("characters.properties.addTagPlaceholder"),
        getValue: (ctx) => ctx.character.profile.getProfile().tags || [],
        addTag: async (ctx, tag) => {
          ctx.character.profile.addTag(tag);
        },
        removeTag: async (ctx, tag) => {
          ctx.character.profile.removeTag(tag);
        },
        order: 40
      },
      {
        id: "defaultPose",
        type: "select",
        label: t("characters.properties.defaultPose"),
        placeholder: t("characters.properties.selectDefaultPose"),
        // A layered character has no poses at all - what it starts in is one default tag per
        // axis, set beside the axes in the editor - so the row is absent rather than empty.
        hidden: (ctx) => ctx.character.profile.appearance.getKind() !== "preset",
        options: (ctx): SelectOption[] => [
          { value: "", label: t("characters.properties.followFirstPose") },
          ...ctx.poses.map((pose) => ({ value: pose.id, label: pose.name }))
        ],
        getValue: (ctx) => ctx.character.profile.appearance.getDefaultPoseId() ?? "",
        setValue: async (ctx, value) => {
          const next = value === "" ? null : String(value);
          ctx.character.profile.appearance.setDefaultPoseId(next);
        },
        order: 50
      },
      {
        id: "defaultAvatar",
        type: "custom",
        label: t("characters.properties.defaultAvatar"),
        component: CharacterAvatarField,
        order: 60
      },
      {
        // With identity (name, accent, avatar) rather than with the appearance: which bus the
        // player turns down to quieten this character is a fact about the character, not about
        // how it is drawn, and it survives a kind switch exactly as the accent does.
        id: "voiceTrack",
        type: "custom",
        label: t("characters.properties.voiceTrack"),
        component: CharacterVoiceTrackField,
        order: 70
      }
    ],
    showSavingIndicator: false
  });
