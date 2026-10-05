/**
 * A game made from the starter template goes back to its title page when the story ends.
 *
 * The template's story finishes on an ending row, and an ending row shows the page the build names
 * for the end of the story. The template used to name none, so a player who finished it was left on
 * the last frame of the story with nothing left to click. The page is the project's own choice - the
 * build variant `main` stores nothing and reads it - and it has to be the Title page, the project's
 * main page, in each of the three languages the template is written in.
 *
 * Read through the resolver a build reads it through, so a template file the resolver would not
 * accept fails here rather than in a player's hands.
 *
 * Comments in English per project convention.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { migrateProjectAppTagDocument, RELEASE_APP_TAG, resolveAppTagEndingSurface } from "@shared/types/appTag";

const TEMPLATE = path.join(process.cwd(), "resources/templates/skeleton");

/** Each language the template ships: the English content, with a variant's files laid over it. */
const LANGUAGES = [
    { name: "English", variant: null },
    { name: "Chinese", variant: "content.zh" },
    { name: "Japanese", variant: "content.ja" },
] as const;

/** The file a project made in this language ends up with: the variant's copy when it has one. */
function landed(variant: string | null, relative: string): string {
    const override = variant ? path.join(TEMPLATE, variant, relative) : null;
    return override && fs.existsSync(override) ? override : path.join(TEMPLATE, "content", relative);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

describe.each(LANGUAGES)("the starter template in $name", ({ variant }) => {
    it("shows the title page when its story ends", () => {
        const appTags = migrateProjectAppTagDocument(readJson<unknown>(landed(variant, "editor/app-tags.json")));
        const ending = resolveAppTagEndingSurface(RELEASE_APP_TAG, appTags.endingSurfaceId);
        expect(ending).toEqual({ value: MAIN_APP_SURFACE_ID, overridden: false });

        const ui = readJson<UIDocument>(landed(variant, "editor/ui/uidoc.json"));
        const page = ui.surfaces.find(surface => surface.id === ending.value);
        expect(page?.kind).toBe("appSurface");
    });
});
