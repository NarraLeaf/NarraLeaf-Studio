import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_TAG_SCHEMA_VERSION } from "@shared/types/appTag";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { resolveRunVariant, RUN_VARIANT_SETTINGS_KEY } from "./runVariant";

/**
 * Which edition a run of a project is meant to be, read from the machine's own settings.
 *
 * The cases that matter are the ways this can be absent: the whole game has to be the answer to
 * every one of them, because the other direction is a run that silently withholds content from an
 * author who never asked it to.
 */

const DEMO_ID = "tag-demo";
let projectPath: string;

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "nls-run-variant-"));
  await fs.mkdir(path.join(projectPath, "editor"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectPath, { recursive: true, force: true });
});

async function writeTags(tags: { id: string; name: string }[]): Promise<void> {
  await fs.writeFile(
    path.join(projectPath, "editor", "app-tags.json"),
    JSON.stringify({
      schemaVersion: APP_TAG_SCHEMA_VERSION,
      tags: tags.map((tag) => ({ ...tag, overrides: {} }))
    }),
    "utf-8"
  );
}

function settings(value: unknown) {
  return { get: (key: string) => (key === RUN_VARIANT_SETTINGS_KEY ? value : undefined) };
}

describe("resolveRunVariant", () => {
  it("answers the variant this machine picked for this project", async () => {
    await writeTags([{ id: DEMO_ID, name: "Demo" }]);

    const tag = await resolveRunVariant(
      settings({ [normalizeProjectPath(projectPath)]: DEMO_ID }),
      projectPath
    );

    expect(tag?.name).toBe("Demo");
  });

  it("does not split one project across two spellings of its path", async () => {
    // A native folder picker answers with backslashes, a scripted path usually carries slashes.
    // Both sides key through `normalizeProjectPath`, so what one spelling stored is what the
    // other reads - without that, the choice made yesterday would quietly stop applying the
    // first time the project was opened the other way.
    await writeTags([{ id: DEMO_ID, name: "Demo" }]);
    const otherSpelling = projectPath.split(String.fromCharCode(92)).join("/");
    const stored = { [normalizeProjectPath(otherSpelling)]: DEMO_ID };

    const tag = await resolveRunVariant(settings(stored), projectPath);

    expect(normalizeProjectPath(otherSpelling)).toBe(normalizeProjectPath(projectPath));
    expect(tag?.id).toBe(DEMO_ID);
  });

  it("runs the whole game when nothing was picked", async () => {
    await writeTags([{ id: DEMO_ID, name: "Demo" }]);

    await expect(resolveRunVariant(settings({}), projectPath)).resolves.toBeNull();
    await expect(resolveRunVariant(settings(undefined), projectPath)).resolves.toBeNull();
  });

  it("runs the whole game when the picked variant has since been deleted", async () => {
    // Not an error: deleting a variant must not leave every run of the project refusing to start.
    await writeTags([]);

    await expect(
      resolveRunVariant(settings({ [normalizeProjectPath(projectPath)]: DEMO_ID }), projectPath)
    ).resolves.toBeNull();
  });

  it("runs the whole game when the variants document cannot be read", async () => {
    await fs.writeFile(path.join(projectPath, "editor", "app-tags.json"), "{ not json", "utf-8");

    await expect(
      resolveRunVariant(settings({ [normalizeProjectPath(projectPath)]: DEMO_ID }), projectPath)
    ).resolves.toBeNull();
  });
});
