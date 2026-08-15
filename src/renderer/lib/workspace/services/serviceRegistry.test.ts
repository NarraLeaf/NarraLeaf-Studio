import { describe, expect, it } from "vitest";
import { ServiceRegistry } from "./serviceRegistry";
import { Services } from "./services";

/**
 * Who comes up when a project opens.
 *
 * `Service.initializeAll` walks exactly what this registry holds, so a service missing from it never
 * runs its `init` and never loads its document - silently, because nothing asks for it by name until
 * some panel does, and a panel that finds an empty service usually just renders empty.
 *
 * That is not hypothetical. `DictionaryService.init` is the only thing that publishes the project's
 * words and its language to the spellchecker, and the whole feature - every underline in the story
 * editor - is downstream of that one call. Dropped from here, nothing errors and nothing is marked.
 */
describe("ServiceRegistry", () => {
    it("holds every declared service, so the boot pass reaches all of them", () => {
        const registry = new ServiceRegistry();
        const registered = new Set(registry.getAll());

        for (const id of Object.values(Services)) {
            const service = registry.get(id);
            expect(service, `Services.${id} is declared but not registered`).toBeDefined();
            expect(registered.has(service)).toBe(true);
        }
    });

    it("registers the project dictionary, which the spellchecker is entirely downstream of", () => {
        expect(new ServiceRegistry().get(Services.Dictionary)).toBeDefined();
    });
});
