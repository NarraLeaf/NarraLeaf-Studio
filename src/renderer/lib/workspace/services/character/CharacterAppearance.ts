import { Asset } from "../assets/types";
import { AssetType } from "../assets/assetTypes";
import { CharacterForm, CharacterVariant, CharacterVariantGroup, ICharacterAppearance, PortraitCrop, VariantData } from "./types";

type VariantResolver = {
    type: "add" | "remove";
    variant: string;
};

export type AssetChangeCallback = (oldAssetId: string | null, newAssetId: string | null) => void;

export class CharacterAppearance {
    private listeners: Set<() => void> = new Set();
    private assetChangeCallback: AssetChangeCallback | null = null;
    
    constructor(private appearance: ICharacterAppearance, private onChange: (() => void) | null = null) { }

    public setOnChange(handler: (() => void) | null): void {
        this.onChange = handler;
    }

    public setOnAssetChange(handler: AssetChangeCallback | null): void {
        this.assetChangeCallback = handler;
    }

    public subscribe(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    private notifyChange(): void {
        if (this.onChange) {
            this.onChange();
        }
        this.listeners.forEach(listener => listener());
    }

    private notifyAssetChange(oldAssetId: string | null, newAssetId: string | null): void {
        if (this.assetChangeCallback) {
            this.assetChangeCallback(oldAssetId, newAssetId);
        }
    }

    /**
     * Serialize appearance for persistence/export.
     */
    public toJSON(): ICharacterAppearance {
        const clonedForms = this.appearance.forms.map(form => ({
            name: form.name,
            groups: form.groups.map(group => ({
                name: group.name,
                defaultVariant: group.defaultVariant,
                variants: group.variants.map(v => ({ ...v })),
            })),
            variantAssets: { ...form.variantAssets },
            portrait: form.portrait,
        }));

        return {
            forms: clonedForms,
        };
    }

    /**
     * Get all character forms.
     */
    public getForms(): CharacterForm[] {
        return this.appearance.forms;
    }

    /**
     * Get a character form by name.
     */
    public getForm(name: string): CharacterForm | null {
        return this.appearance.forms.find(form => form.name === name) ?? null;
    }

    /**
     * Ensure a form exists, create if missing.
     */
    public ensureForm(name: string): CharacterForm {
        const found = this.getForm(name);
        if (found) return found;
        const created: CharacterForm = { name, groups: [], variantAssets: {} };
        this.appearance.forms.push(created);
        this.notifyChange();
        return created;
    }

    /**
     * Rename an existing form.
     */
    public renameForm(currentName: string, nextName: string): boolean {
        const form = this.getForm(currentName);
        if (!form) return false;
        const normalized = nextName.trim();
        if (!normalized) return false;
        const exists = this.appearance.forms.some(f => f.name.toLowerCase() === normalized.toLowerCase());
        if (exists && currentName.toLowerCase() !== normalized.toLowerCase()) return false;
        form.name = normalized;
        this.notifyChange();
        return true;
    }

    /**
     * Remove a form by name.
     */
    public removeForm(name: string): boolean {
        const index = this.appearance.forms.findIndex(form => form.name === name);
        if (index === -1) return false;
        
        // Notify asset changes for all assets in this form
        const form = this.appearance.forms[index];
        for (const [variantName, variantData] of Object.entries(form.variantAssets)) {
            const oldAssetId = variantData.data?.id ?? null;
            if (oldAssetId) {
                this.notifyAssetChange(oldAssetId, null);
            }
        }
        
        this.appearance.forms.splice(index, 1);
        this.notifyChange();
        return true;
    }

    /**
     * Query variant asset data by form and variant.
     */
    public query(formName: string, variantName: string): VariantData | null {
        const form = this.getForm(formName);
        if (!form) return null;
        return form.variantAssets[variantName] ?? null;
    }

    /**
     * List all variant names within a form.
     */
    public listVariants(formName: string): string[] {
        const form = this.getForm(formName);
        if (!form) return [];
        const names: string[] = [];
        form.groups.forEach(group => {
            group.variants.forEach(v => names.push(v.name));
        });
        return names;
    }

    /**
     * List all variant group names in a form.
     */
    public listGroups(formName: string): string[] {
        const form = this.getForm(formName);
        if (!form) return [];
        return form.groups.map(g => g.name);
    }

    /**
     * Check if a group exists in a form.
     */
    public isGroupExists(formName: string, groupName: string): boolean {
        const form = this.getForm(formName);
        if (!form) return false;
        return form.groups.some(g => g.name === groupName);
    }

    /**
     * Create or get a group within a form.
     */
    public createGroup(formName: string, groupName: string, variants: CharacterVariant[] = [], defaultVariant: string | null = null): CharacterVariantGroup {
        const form = this.ensureForm(formName);
        const existing = form.groups.find(g => g.name === groupName);
        if (existing) return existing;
        const group: CharacterVariantGroup = {
            name: groupName,
            defaultVariant,
            variants,
        };
        form.groups.push(group);
        this.notifyChange();
        return group;
    }

    /**
     * Rename a variant group inside a form.
     */
    public renameGroup(formName: string, currentName: string, nextName: string): boolean {
        const form = this.getForm(formName);
        if (!form) return false;
        const normalized = nextName.trim();
        if (!normalized) return false;
        const exists = form.groups.some(g => g.name.toLowerCase() === normalized.toLowerCase());
        if (exists && currentName.toLowerCase() !== normalized.toLowerCase()) return false;
        const group = form.groups.find(g => g.name === currentName);
        if (!group) return false;
        group.name = normalized;
        this.notifyChange();
        return true;
    }

    /**
     * Remove a group within a form.
     */
    public removeGroup(formName: string, groupName: string): boolean {
        const form = this.getForm(formName);
        if (!form) return false;
        const index = form.groups.findIndex(g => g.name === groupName);
        if (index === -1) return false;
        
        // Clean variant assets for variants under this group and notify asset changes
        form.groups[index].variants.forEach(v => {
            const oldAssetId = form.variantAssets[v.name]?.data?.id ?? null;
            if (oldAssetId) {
                this.notifyAssetChange(oldAssetId, null);
            }
            delete form.variantAssets[v.name];
        });
        
        form.groups.splice(index, 1);
        this.notifyChange();
        return true;
    }

    /**
     * Create a variant inside a group (group created if missing).
     */
    public createVariantInGroup(formName: string, groupName: string, variantName: string): CharacterVariant {
        const form = this.ensureForm(formName);

        // Prevent duplicate variant names across the whole form (not just within the target group)
        const duplicated = form.groups.some(g => g.variants.some(v => v.name.toLowerCase() === variantName.toLowerCase()));
        if (duplicated) {
            const existing = form.groups.flatMap(g => g.variants).find(v => v.name.toLowerCase() === variantName.toLowerCase());
            return existing ?? { name: variantName };
        }

        const group = this.createGroup(formName, groupName, [], null);
        const existing = group.variants.find(v => v.name === variantName);
        if (existing) return existing;
        const variant: CharacterVariant = { name: variantName };
        group.variants.push(variant);
        this.notifyChange();
        return variant;
    }

    /**
     * Remove a variant from a group.
     */
    public removeVariant(formName: string, groupName: string, variantName: string): boolean {
        const form = this.getForm(formName);
        if (!form) return false;
        const group = form.groups.find(g => g.name === groupName);
        if (!group) return false;
        const index = group.variants.findIndex(v => v.name === variantName);
        if (index === -1) return false;
        
        // Get old asset ID before removing
        const oldAssetId = form.variantAssets[variantName]?.data?.id ?? null;
        
        group.variants.splice(index, 1);
        delete form.variantAssets[variantName];
        
        // Notify asset change for lock management
        if (oldAssetId) {
            this.notifyAssetChange(oldAssetId, null);
        }
        
        // Reset default if removed variant was default.
        if (group.defaultVariant === variantName) {
            group.defaultVariant = group.variants[0]?.name ?? null;
        }
        this.notifyChange();
        return true;
    }

    /**
     * Rename a variant within a group.
     */
    public renameVariant(formName: string, groupName: string, currentName: string, nextName: string): boolean {
        const form = this.getForm(formName);
        if (!form) return false;
        const group = form.groups.find(g => g.name === groupName);
        if (!group) return false;
        const normalized = nextName.trim();
        if (!normalized) return false;
        const duplicate = form.groups.some(g => g.variants.some(v => v.name.toLowerCase() === normalized.toLowerCase()));
        if (duplicate && currentName.toLowerCase() !== normalized.toLowerCase()) return false;
        const variant = group.variants.find(v => v.name === currentName);
        if (!variant) return false;
        variant.name = normalized;
        if (form.variantAssets[currentName]) {
            form.variantAssets[normalized] = form.variantAssets[currentName];
            delete form.variantAssets[currentName];
        }
        if (group.defaultVariant === currentName) {
            group.defaultVariant = normalized;
        }
        this.notifyChange();
        return true;
    }

    /**
     * Attach or clear an asset for a specific variant within a form.
     */
    public setVariantAsset(formName: string, variantName: string, asset: Asset<AssetType.Image> | null): void {
        const form = this.getForm(formName);
        if (!form) return;

        const hasVariant = form.groups.some(group => group.variants.some(v => v.name === variantName));
        if (!hasVariant) return;

        // Get old asset ID before changing
        const oldAssetId = form.variantAssets[variantName]?.data?.id ?? null;
        const newAssetId = asset?.id ?? null;

        if (asset) {
            form.variantAssets[variantName] = { data: asset };
        } else {
            delete form.variantAssets[variantName];
        }

        // Notify asset change for lock management
        if (oldAssetId !== newAssetId) {
            this.notifyAssetChange(oldAssetId, newAssetId);
        }

        this.notifyChange();
    }

    /**
     * Set or clear a form's portrait framing override. Clearing (undefined) makes the form inherit the
     * profile-level rect (or the automatic head crop).
     */
    public setFormPortrait(formName: string, portrait: PortraitCrop | undefined): void {
        const form = this.getForm(formName);
        if (!form) return;
        if (portrait) {
            form.portrait = portrait;
        } else {
            delete form.portrait;
        }
        this.notifyChange();
    }

    /**
     * Update default variant for a group.
     */
    public setGroupDefaultVariant(formName: string, groupName: string, variantName: string | null): void {
        const form = this.getForm(formName);
        if (!form) return;
        const group = form.groups.find(g => g.name === groupName);
        if (!group) return;
        group.defaultVariant = variantName;
        this.notifyChange();
    }

    /**
     * Resolve mutually exclusive variants within a form.
     * Returns the final selected variants after applying defaults and resolvers.
     */
    public resolve(formName: string, variants: string[], resolvers: VariantResolver[] = []): string[] {
        const form = this.getForm(formName);
        if (!form) return [];

        const groupMap: Record<string, CharacterVariantGroup> = {};
        form.groups.forEach(g => {
            groupMap[g.name] = g;
        });

        const variantToGroup: Record<string, CharacterVariantGroup> = {};
        form.groups.forEach(group => {
            group.variants.forEach(v => {
                variantToGroup[v.name] = group;
            });
        });

        const resolved = new Set<string>();

        // seed with selected variants, respecting group exclusivity
        variants.forEach(name => {
            const group = variantToGroup[name];
            if (!group) return;
            group.variants.forEach(v => resolved.delete(v.name));
            resolved.add(name);
        });

        // fill defaults for missing groups
        form.groups.forEach(group => {
            const hasSelection = group.variants.some(v => resolved.has(v.name));
            if (!hasSelection && group.defaultVariant) {
                resolved.add(group.defaultVariant);
            }
        });

        // apply resolvers
        resolvers.forEach(resolver => {
            const group = variantToGroup[resolver.variant];
            if (!group) return;
            if (resolver.type === "add") {
                group.variants.forEach(v => resolved.delete(v.name));
                resolved.add(resolver.variant);
            } else {
                group.variants.forEach(v => resolved.delete(v.name));
                if (group.defaultVariant) {
                    resolved.add(group.defaultVariant);
                }
            }
        });

        return Array.from(resolved);
    }
}
