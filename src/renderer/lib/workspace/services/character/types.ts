import { AssetType } from "../assets/assetTypes";
import { Asset } from "../assets/types";


export interface CharacterBaseProfile {
    name: string;
    id: string;
}

export interface CharacterEditorProfile extends CharacterBaseProfile {
    description: string;
    tags: string[];
    attributes: Record<string, string>;
}

export interface ICharacterAppearance {
    variants: (CharacterVariant | CharacterVariantGroup)[];
    forms: CharacterForm[];
}

export interface CharacterForm {
    name: string;
    defaultVariant: string;
    variants: Record<string, Asset<AssetType.Image>>;
}

export enum CharacterVariantElementType {
    Variant = "variant",
    VariantGroup = "variantGroup",
}

interface CharacterVariantElement<T> {
    type: T;
}

export interface CharacterVariantGroup extends CharacterVariantElement<CharacterVariantElementType.VariantGroup> {
    name: string;
    variants: CharacterVariant[];
}

export interface CharacterVariant extends CharacterVariantElement<CharacterVariantElementType.Variant> {
    name: string;
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
