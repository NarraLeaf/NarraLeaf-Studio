import { CharacterForm, CharacterVariant, CharacterVariantElementType, CharacterVariantGroup, ICharacterAppearance, VariantData } from "./types";

type VariantMap = Record<string, {
    group: CharacterVariantGroup | null;
    variant: CharacterVariant;
}>;

type VariantResolver = {
    type: "add" | "remove";
    variant: string;
};

export class CharacterAppearance {
    constructor(private appearance: ICharacterAppearance) {}

    /**
     * Get all character forms.
     * @returns An array of all character forms.
     */
    public getForms(): CharacterForm[] {
        return this.appearance.forms;
    }

    /**
     * Get a character form by name.
     * @param name The name of the form to find.
     * @returns The character form if found, null otherwise.
     */
    public getForm(name: string): CharacterForm | null {
        return this.appearance.forms.find(form => form.name === name) ?? null;
    }

    /**
     * Query variant data by form name and variant name.
     * @param formName The name of the form.
     * @param variantName The name of the variant.
     * @returns The variant data if found, null otherwise.
     */
    public query(formName: string, variantName: string): VariantData | null {
        const form = this.getForm(formName);
        if (!form) {
            return null;
        }
        return form.variants[variantName] ?? null;
    }

    /**
     * Get a character variant by name.
     * @param variantName The name of the variant to find.
     * @returns The character variant if found, null otherwise.
     */
    public getVariant(variantName: string): CharacterVariant | null {
        return this.findVariant(variantName);
    }

    /**
     * Check if a variant exists by name.
     * @param variantName The name of the variant to check.
     * @returns True if the variant exists, false otherwise.
     */
    public isVariantExists(variantName: string): boolean {
        return this.findVariant(variantName) !== null;
    }

    /**
     * Get a character variant group by name.
     * @param name The name of the group to find.
     * @returns The character variant group if found, null otherwise.
     */
    public getGroup(name: string): CharacterVariantGroup | null {
        return this.findGroup(name);
    }

    /**
     * List all variant names, including those in groups.
     * @returns An array of all variant names.
     */
    public listVariants(): string[] {
        return this.appearance.variants.flatMap(variant => {
            return variant.type === CharacterVariantElementType.Variant ? [variant.name] : variant.variants.map(v => v.name);
        });
    }

    /**
     * List all variant names in a specific group.
     * @param groupName The name of the group.
     * @returns An array of variant names in the group, empty array if group not found.
     */
    public listGroupVariants(groupName: string): string[] {
        const group = this.getGroup(groupName);
        if (!group) {
            return [];
        }
        return group.variants.map(v => v.name);
    }

    /**
     * List all variant group names.
     * @returns An array of all variant group names.
     */
    public listGroups(): string[] {
        return this.appearance.variants.filter(variant => variant.type === CharacterVariantElementType.VariantGroup).map(variant => variant.name);
    }

    /**
     * Check if a variant group exists by name.
     * @param name The name of the group to check.
     * @returns True if the group exists, false otherwise.
     */
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

    public resolve(variants: string[], ): string[] {
        const map = this.mapVariants();
        const resolved
    }

    private mapVariants(): VariantMap {
        const map: VariantMap = {};
        for (const variant of this.appearance.variants) {
            if (variant.type === CharacterVariantElementType.Variant) {
                map[variant.name] = {
                    group: null,
                    variant: variant,
                };
            }
            if (variant.type === CharacterVariantElementType.VariantGroup) {
                for (const child of variant.variants) {
                    map[child.name] = {
                        group: variant,
                        variant: child,
                    };
                }
            }
        }
        return map;
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
