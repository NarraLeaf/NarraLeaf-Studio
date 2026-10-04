import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The editor's modifier shortcuts are registered twice, once on Ctrl and once on Cmd, from two lists
 * in the hook. A command present in one list and missing from the other cannot be pressed on that
 * platform at all - Ungroup was once Cmd-only, so on Windows Ctrl+Shift+G did nothing. Read from
 * source because the lists only exist inside the hook's `useMemo`.
 */
describe("UI editor modifier shortcuts", () => {
    const source = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "useUIEditorKeybindings.ts"),
        "utf8",
    );

    function chordsFor(mod: "ctrl" | "meta"): string[] {
        const start = source.indexOf(`bindMod("${mod}", [`);
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf("])", start);
        const block = source.slice(start, end);
        return [...block.matchAll(/suffix:\s*"([^"]+)",\s*key:\s*"([^"]+)"/g)].map(match => `${match[1]}=${match[2]}`).sort();
    }

    it("binds the same commands on Ctrl as on Cmd", () => {
        expect(chordsFor("ctrl")).toEqual(chordsFor("meta"));
        expect(chordsFor("ctrl")).toContain("ungroup=shift+g");
    });
});
