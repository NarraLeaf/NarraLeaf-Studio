

import { CharacterRelationshipMap, CharacterRelationshipType } from "./types";

/**
 * Manage character relationship graphs with simple helpers.
 */
export class CharacterRelationshipManager {
    private readonly relationships: Map<string, CharacterRelationshipMap[]> = new Map();

    constructor(initial: CharacterRelationshipType[] = []) {
        for (const group of initial) {
            this.relationships.set(group.relationshipName, [...group.relationships]);
        }
    }

    /**
     * List all relationship categories.
     */
    public listRelationshipNames(): string[] {
        return Array.from(this.relationships.keys());
    }

    /**
     * Get all relationships under a category.
     */
    public getRelationships(name: string): CharacterRelationshipMap[] {
        return [...(this.relationships.get(name) ?? [])];
    }

    /**
     * Replace all relationships under a category.
     */
    public setRelationships(name: string, relationships: CharacterRelationshipMap[]): void {
        this.relationships.set(name, [...relationships]);
    }

    /**
     * Add a relationship link under a category.
     */
    public addRelationship(name: string, link: CharacterRelationshipMap): void {
        const list = this.relationships.get(name) ?? [];
        list.push(link);
        this.relationships.set(name, list);
    }

    /**
     * Remove relationships matching predicate under a category.
     */
    public removeRelationships(
        name: string,
        predicate: (link: CharacterRelationshipMap) => boolean,
    ): void {
        const list = this.relationships.get(name);
        if (!list) return;
        this.relationships.set(name, list.filter(link => !predicate(link)));
    }

    /**
     * Get relationships where the character participates.
     */
    public getCharacterRelations(characterId: string): CharacterRelationshipMap[] {
        const results: CharacterRelationshipMap[] = [];
        for (const list of this.relationships.values()) {
            for (const link of list) {
                if (link.source === characterId || link.target === characterId) {
                    results.push(link);
                }
            }
        }
        return results;
    }

    /**
     * Validate relationships for duplicate edges and self links.
     */
    public validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        for (const [name, list] of this.relationships) {
            const seen = new Set<string>();
            for (const link of list) {
                if (link.source === link.target) {
                    errors.push(`Relationship "${name}" has self link "${link.source}".`);
                }
                const key = `${link.source}->${link.target}:${link.name}`;
                if (seen.has(key)) {
                    errors.push(`Relationship "${name}" has duplicate link "${key}".`);
                }
                seen.add(key);
            }
        }
        return { valid: errors.length === 0, errors };
    }

    /**
     * Export relationships to persist.
     */
    public toJSON(): CharacterRelationshipType[] {
        return Array.from(this.relationships.entries()).map(([relationshipName, relationships]) => ({
            relationshipName,
            relationships: [...relationships],
        }));
    }
}
