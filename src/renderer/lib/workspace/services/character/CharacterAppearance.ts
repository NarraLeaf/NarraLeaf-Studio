import { CharacterForm, CharacterVariant, CharacterVariantElementType, CharacterVariantGroup, ICharacterAppearance } from "./types";

export class CharacterAppearance {
    constructor(private appearance: ICharacterAppearance) {}

    public getForms(): CharacterForm[] {
        return this.appearance.forms;
    }

    public getForm(name: string): CharacterForm | null {
        return this.appearance.forms.find(form => form.name === name) ?? null;
    }

    public getVariant(variantName: string): CharacterVariant | null {
        return this.findVariant(variantName);
    }

    public isVariantExists(variantName: string): boolean {
        return this.findVariant(variantName) !== null;
    }

    public isGroupExists(name: string): boolean {
        for (const variant of this.appearance.variants) {
            if (variant.type === CharacterVariantElementType.VariantGroup && variant.name === name) {
                return true;
            }
        }
        return false;
    }

    /**
     * If the variant already exists, this method will return the existing variant.
     */
    public createVariant(name: string): CharacterVariant {
        const existingVariant = this.findVariant(name);
        if (existingVariant) {
            return existingVariant;
        }
        const newVariant: CharacterVariant = {
            type: CharacterVariantElementType.Variant,
            name,
        };
        this.appearance.variants.push(newVariant);
        return newVariant;
    }

    /**
     * If the group does not exist, this method will create the group and then create the variant in the group.
     */
    public createVariantInGroup(groupName: string, variantName: string): CharacterVariant {
        const group = this.createGroup(groupName);
        const variant: CharacterVariant = {
            type: CharacterVariantElementType.Variant,
            name: variantName,
        };
        group.variants.push(variant);
        return variant;
    }

    /**
     * If the group already exists, this method will return the existing group.
     */
    public createGroup(name: string): CharacterVariantGroup {
        for (const variant of this.appearance.variants) {
            if (variant.type === CharacterVariantElementType.VariantGroup && variant.name === name) {
                return variant;
            }
        }
        const group: CharacterVariantGroup = {
            type: CharacterVariantElementType.VariantGroup,
            name,
            variants: [],
        };
        this.appearance.variants.push(group);
        return group;
    }

    private findVariant(variantName: string): CharacterVariant | null {
        for (const variant of this.appearance.variants) {
            if (variant.type === CharacterVariantElementType.Variant && variant.name === variantName) {
                return variant;
            }
            if (variant.type === CharacterVariantElementType.VariantGroup) {
                for (const child of variant.variants) {
                    if (child.name === variantName) {
                        return child;
                    }
                }
            }
        }
        return null;
    }

    private findGroup(name: string): CharacterVariantGroup | null {
        for (const variant of this.appearance.variants) {
            if (variant.type === CharacterVariantElementType.VariantGroup && variant.name === name) {
                return variant;
            }
        }
        return null;
    }
}
