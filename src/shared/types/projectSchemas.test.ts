/**
 * The schema versions of the documents the Team web console reads, as one file Team takes a copy of.
 *
 * The console reads stories and blueprints out of a revision with Team's `@narraleaf/project-view`
 * package, which refuses any document newer than it was written for. `projectSchemas.json` beside
 * this file is what it was written against: Team keeps a copy (`project-view/studio-schemas.json`)
 * and its own suite fails while the readers' ceilings disagree with it.
 *
 * So raising one of these constants fails here until the JSON is raised too, and the new JSON,
 * taken across to Team, fails there until somebody has looked at what the console reads of the new
 * shape. Neither side reaches the other repository; the copy is the handshake, as with the Team
 * contract going the other way.
 */
import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "./blueprint/schema";
import { STORY_DOCUMENT_SCHEMA_VERSION, STORY_LIBRARY_INDEX_SCHEMA_VERSION } from "./story/document";
import { UI_GRAPH_DOCUMENT_SCHEMA_VERSION } from "./ui-editor/graph";

const schemas = JSON.parse(fs.readFileSync(path.join(__dirname, "projectSchemas.json"), "utf8")) as Record<string, number>;

describe("the schema versions the Team console is told about", () => {
    it("are the ones this build writes", () => {
        expect(schemas).toEqual({
            storyLibrary: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
            storyDocument: STORY_DOCUMENT_SCHEMA_VERSION,
            uiGraphs: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
            blueprintDocument: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
        });
    });
});
