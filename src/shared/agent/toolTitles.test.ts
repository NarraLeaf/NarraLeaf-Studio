import { describe, expect, it } from "vitest";
import { flattenCatalog } from "../i18n/flatten";
import { CATALOGS } from "../i18n/catalog";
import { AGENT_TOOLS } from "./tools";

/**
 * The Agent log names each call by its tool's title in the interface language
 * (`workspace.agent.tool.<name>`). A tool added to the table without one would show its raw English
 * title in every language, so every tool is held to a key in every built-in catalog.
 */
describe("agent tool titles", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
        it(`names every tool in ${locale}`, () => {
            const keys = flattenCatalog(catalog);
            const missing = AGENT_TOOLS.map(tool => `workspace.agent.tool.${tool.name}`).filter(key => !keys.has(key));
            expect(missing).toEqual([]);
        });
    }

    it("has no title for a tool that is not in the table", () => {
        const names = new Set(AGENT_TOOLS.map(tool => tool.name));
        const stray = [...flattenCatalog(CATALOGS.en).keys()]
            .filter(key => key.startsWith("workspace.agent.tool."))
            .map(key => key.slice("workspace.agent.tool.".length))
            .filter(name => !names.has(name));
        expect(stray).toEqual([]);
    });
});
