import { AssetType } from "../assets/assetTypes";
import { Asset } from "../assets/types";


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
}

export interface ICharacterAppearance {
    variants: (CharacterVariant | CharacterVariantGroup)[];
    forms: CharacterForm[];
}

export type VariantData = {
    data: Asset<AssetType.Image>;
};

export interface CharacterForm {
    name: string;
    variants: Record<string, VariantData>;
}

export enum CharacterVariantElementType {
    Variant = "variant",
    VariantGroup = "variantGroup",
}

interface CharacterVariantElement<T> {
    type: T;
}

export interface CharacterVariant extends CharacterVariantElement<CharacterVariantElementType.Variant> {
    name: string;
}

export interface CharacterVariantGroup extends CharacterVariantElement<CharacterVariantElementType.VariantGroup> {
    name: string;
    defaultVariant: string | null;
    variants: CharacterVariant[];
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
