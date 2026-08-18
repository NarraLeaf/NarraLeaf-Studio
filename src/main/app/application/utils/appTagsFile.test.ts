import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_TAG_SCHEMA_VERSION } from "@shared/types/appTag";
import { readProjectAppTagsFromDir } from "./appTagsFile";

/**
 * What the build pipeline reads a project's variants with. The three cases that decide whether a
 * build can ship the wrong identity: no file, a good file, and a file that is there and will not
 * parse.
 */

const roots: string[] = [];

async function projectWith(contents?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-app-tags-"));
  roots.push(root);
  if (contents !== undefined) {
    await fs.mkdir(path.join(root, "editor"), { recursive: true });
    await fs.writeFile(path.join(root, "editor", "app-tags.json"), contents, "utf-8");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("readProjectAppTagsFromDir", () => {
  it("answers no variants for a project that has never had one", async () => {
    expect(await readProjectAppTagsFromDir(await projectWith())).toEqual([]);
  });

  it("reads the author's variants and their overrides", async () => {
    const root = await projectWith(
      JSON.stringify({
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags: [{ id: "demo", name: "Demo", overrides: { displayName: "My Game Demo" } }]
      })
    );

    expect(await readProjectAppTagsFromDir(root)).toEqual([
      { id: "demo", name: "Demo", overrides: { displayName: "My Game Demo" } }
    ]);
  });

  it("leaves the release tag out, because it is synthesized rather than stored", async () => {
    const root = await projectWith(
      JSON.stringify({
        schemaVersion: APP_TAG_SCHEMA_VERSION,
        tags: [
          { id: "release", name: "Not the real one" },
          { id: "demo", name: "Demo" }
        ]
      })
    );

    expect((await readProjectAppTagsFromDir(root)).map((tag) => tag.id)).toEqual(["demo"]);
  });

  /**
   * The case this function exists for. Answering "no variants" here would build the project's own
   * name and identifier under the name of the variant the author picked, and every check
   * downstream would agree with it.
   */
  it("throws on a file that is there and will not parse, rather than reporting no variants", async () => {
    const root = await projectWith("{ not json");

    await expect(readProjectAppTagsFromDir(root)).rejects.toThrow(/Invalid JSON/);
  });
});
