import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./Checkbox";

/**
 * The box, and the promise that there is only one of it.
 *
 * Studio drew its own `<input type="checkbox">` in twelve files, each with its own size, its own
 * border classes and — five times — `cursor-pointer`, which is the one cursor this app never shows.
 * The scan below is what keeps the thirteenth from being written: a checkbox may exist in exactly
 * one place, and everything else asks for it by name.
 */

const RENDERER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OWNER = join("lib", "components", "elements", "Checkbox.tsx");

function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "dist" || name === "node_modules") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) sources(full, out);
        // Tests are out: this file has to be able to say the words it is banning.
        else if (/\.tsx?$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name)) out.push(full);
    }
    return out;
}

describe("the checkbox", () => {
    it("is the only checkbox in the renderer", () => {
        const offenders = sources(RENDERER_ROOT)
            .filter(file => readFileSync(file, "utf8").includes('type="checkbox"'))
            .map(file => relative(RENDERER_ROOT, file));
        expect(offenders).toEqual([OWNER]);
    });

    it("pairs the box with its label and keeps Studio's arrow cursor", () => {
        const markup = renderToStaticMarkup(
            <Checkbox checked onCheckedChange={() => undefined}>Warnings</Checkbox>,
        );
        expect(markup).toContain("<label");
        expect(markup).toContain('type="checkbox"');
        expect(markup).toContain("Warnings");
        expect(markup).toContain("cursor-default");
        expect(markup).not.toContain("cursor-pointer");
    });

    it("is a bare box when nothing labels it in place", () => {
        // A row that carries its own text — a component in the library list — labels the box through
        // `aria-label` instead, and must not get a second `<label>` wrapper around the row.
        const markup = renderToStaticMarkup(
            <Checkbox checked={false} aria-label="Select Dialogue" onCheckedChange={() => undefined} />,
        );
        expect(markup).not.toContain("<label");
        expect(markup).toContain('aria-label="Select Dialogue"');
    });
});
