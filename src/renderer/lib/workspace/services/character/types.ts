

export interface CharacterRuntimeProfile {
    name: string;
    id: string;
}

export interface CharacterEditorProfile {
    description: string;
    tags: string[];
    attributes: Record<string, string>;
}

export interface CharacterForm {
    name: string;
    variantGroups: CharacterVariantGroup[];
}

export interface CharacterVariantGroup {
    name: string;
    variants: CharacterVariant[];
}

export interface CharacterVariant {
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
