import { ElementTypeDefinition } from "./types";
import { BuiltinElementTypes } from "./builtin";

export class ElementTypeRegistry {
    private readonly types = new Map<string, ElementTypeDefinition>();

    public constructor(definitions: ElementTypeDefinition[] = BuiltinElementTypes) {
        this.registerMany(definitions);
    }

    public register(definition: ElementTypeDefinition): void {
        this.types.set(definition.type, definition);
    }

    public registerMany(definitions: ElementTypeDefinition[]): void {
        for (const definition of definitions) {
            this.register(definition);
        }
    }

    public get(type: string): ElementTypeDefinition | undefined {
        return this.types.get(type);
    }

    public list(): ElementTypeDefinition[] {
        return Array.from(this.types.values());
    }
}
