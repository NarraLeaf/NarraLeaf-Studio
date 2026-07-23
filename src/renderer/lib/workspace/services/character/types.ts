import { AssetType } from "../assets/assetTypes";
import { Asset } from "../assets/types";
import type { NormalizedCrop } from "@/lib/utils/headCrop";

/** A portrait framing rect in normalized (0–1) image coordinates — the same shape as {@link NormalizedCrop}. */
export type PortraitCrop = NormalizedCrop;


export interface CharacterBaseProfile {
    name: string;
    readonly id: string;
}

export interface CharacterEditorProfile extends CharacterBaseProfile {
    /**
     * Character Description
     */
    description: string;
    /**
     * Character Tags
     */
    tags: string[];
    /**
     * Preferred default form name
     */
    defaultForm?: string | null;
    /**
     * User defined attributes
     */
    attributes: Record<string, string>;
    /**
     * Editor Asset UUID
     */
    thumbnail: string | null;
    /**
     * Character Nicknames
     */
    nicknames: string[];
    /**
     * Group that the character belongs to
     */
    groupId?: string;
    /**
     * Editor-only accent colour (hex, e.g. `#40a8c4`). Tints the speaker nametag in the story editor
     * (and the dialogue-group header). Optional and additive: older projects load without it and keep
     * the default nametag colour until one is set. Never consumed by the runtime.
     */
    color?: string;
    /**
     * Editor-only default portrait framing (normalized 0–1). Frames the character's story-editor avatar
     * on the face instead of guessing from the alpha silhouette. A form may override it. Additive: absent
     * on older projects, which then fall back to the automatic head crop. Never consumed by the runtime.
     */
    portrait?: PortraitCrop;
}

export interface ICharacterAppearance {
    forms: CharacterForm[];
}

export type VariantData = {
    data: Asset<AssetType.Image>;
};

export interface CharacterVariant {
    name: string;
}

export interface CharacterVariantGroup {
    name: string;
    defaultVariant: string | null;
    variants: CharacterVariant[];
}

export interface CharacterForm {
    name: string;
    groups: CharacterVariantGroup[];
    /**
     * Map variant name -> asset data for this form
     */
    variantAssets: Record<string, VariantData>;
    /**
     * Optional per-form override of the profile's portrait framing (normalized 0–1). Absent means the
     * form inherits the profile-level rect (or the automatic head crop when that is absent too).
     */
    portrait?: PortraitCrop;
}

export type CharacterRelationshipType = {
    relationshipName: string;
    relationships: CharacterRelationshipMap[];
};

export type CharacterRelationshipMap = {
    source: string;
    target: string;
    name: string;
};

export interface CharacterGroup {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}

export type CharacterGroupMap = Record<string, CharacterGroup>;
