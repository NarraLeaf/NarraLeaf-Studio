import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAME_PROGRESS_SCHEMA_VERSION } from "../types/gameProgress";
import {
  readGameProgressFile,
  resolveGameProgressDirectory,
  resolveGameProgressFilePath,
  writeGameProgressFile,
  type GameProgressEnvironment
} from "./gameProgressFile";

const KEY = "com.example.sablehours";

let root: string;
let env: GameProgressEnvironment;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-progress-"));
  env = {
    platform: "win32",
    appDataDir: path.join(root, "AppData"),
    homeDir: path.join(root, "home")
  };
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("resolveGameProgressDirectory", () => {
  it("sits under the roaming app data root on Windows", () => {
    expect(
      resolveGameProgressDirectory({ platform: "win32", appDataDir: "C:\\AD", homeDir: "C:\\home" })
    ).toBe(path.join("C:\\AD", "NarraLeaf", "progress"));
  });

  it("sits under Application Support on macOS", () => {
    const dir = resolveGameProgressDirectory({
      platform: "darwin",
      appDataDir: "/Users/p/Library/Application Support",
      homeDir: "/Users/p"
    });
    expect(dir).toBe(path.join("/Users/p/Library/Application Support", "NarraLeaf", "progress"));
  });

  it("honours an absolute XDG_DATA_HOME on Linux and ignores a relative one", () => {
    const base = { platform: "linux" as const, appDataDir: "/home/p/.config", homeDir: "/home/p" };
    expect(resolveGameProgressDirectory({ ...base, xdgDataHome: "/data" })).toBe(
      path.join("/data", "NarraLeaf", "progress")
    );
    // Per the XDG specification a relative value is to be ignored, not resolved against cwd.
    expect(resolveGameProgressDirectory({ ...base, xdgDataHome: "share" })).toBe(
      path.join("/home/p", ".local", "share", "NarraLeaf", "progress")
    );
    expect(resolveGameProgressDirectory(base)).toBe(
      path.join("/home/p", ".local", "share", "NarraLeaf", "progress")
    );
  });
});

describe("the progress file", () => {
  it("round-trips a playthrough, saved and persistent values included", async () => {
    const written = await writeGameProgressFile(
      env,
      KEY,
      {
        storyId: "story-1",
        savedVariables: { gold: 12, route: "north", flags: [1, 2] },
        persistentVariables: { seenIntro: true, deaths: 3 },
        anchor: { sceneId: "scene-3", sceneRuntimeName: "chapter-two" },
        visitedSceneIds: ["scene-1", "scene-3"]
      },
      "2026-08-12T00:00:00.000Z"
    );
    expect(written).toEqual({ outcome: "written", error: null });

    const read = await readGameProgressFile(env, KEY);
    expect(read.outcome).toBe("found");
    expect(read.document).toEqual({
      schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
      progressKey: KEY,
      writtenAt: "2026-08-12T00:00:00.000Z",
      storyId: "story-1",
      savedVariables: { gold: 12, route: "north", flags: [1, 2] },
      persistentVariables: { seenIntro: true, deaths: 3 },
      anchor: { sceneId: "scene-3", sceneRuntimeName: "chapter-two" },
      visitedSceneIds: ["scene-1", "scene-3"]
    });
  });

  it("is one document per title, reached by two builds with different app ids", async () => {
    // What the demo writes under the release key is exactly what the release build reads.
    await writeGameProgressFile(env, KEY, {
      storyId: "story-1",
      savedVariables: { gold: 40 },
      persistentVariables: {},
      anchor: null,
      visitedSceneIds: []
    });
    expect(await fs.readdir(resolveGameProgressDirectory(env))).toEqual([`${KEY}.json`]);
    expect((await readGameProgressFile(env, KEY)).document?.savedVariables).toEqual({ gold: 40 });
  });

  it("replaces rather than merges, so a cleared variable does not linger", async () => {
    await writeGameProgressFile(env, KEY, {
      storyId: "story-1",
      savedVariables: { gold: 40, curse: true },
      persistentVariables: {},
      anchor: null,
      visitedSceneIds: []
    });
    await writeGameProgressFile(env, KEY, {
      storyId: "story-1",
      savedVariables: { gold: 41 },
      persistentVariables: {},
      anchor: null,
      visitedSceneIds: []
    });
    expect((await readGameProgressFile(env, KEY)).document?.savedVariables).toEqual({ gold: 41 });
  });

  it("reads a file that is not there as missing, not as a failure", async () => {
    expect(await readGameProgressFile(env, KEY)).toEqual({
      outcome: "missing",
      document: null,
      error: null
    });
  });

  it("reads a malformed file as failed, and never throws", async () => {
    const filePath = resolveGameProgressFilePath(env, KEY);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{ this is not json", "utf-8");

    const read = await readGameProgressFile(env, KEY);
    expect(read.outcome).toBe("failed");
    expect(read.document).toBeNull();
    expect(read.error).toBeTruthy();
  });

  it("reads a document from a newer build as failed rather than guessing at it", async () => {
    const filePath = resolveGameProgressFilePath(env, KEY);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ schemaVersion: GAME_PROGRESS_SCHEMA_VERSION + 1, progressKey: KEY }),
      "utf-8"
    );
    expect((await readGameProgressFile(env, KEY)).outcome).toBe("failed");
  });

  it("refuses a document that names another title", async () => {
    const filePath = resolveGameProgressFilePath(env, KEY);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
        progressKey: "com.example.somethingelse",
        savedVariables: { gold: 999 }
      }),
      "utf-8"
    );
    const read = await readGameProgressFile(env, KEY);
    expect(read.outcome).toBe("failed");
    expect(read.document).toBeNull();
  });

  it("refuses to act at all for a build that carries no key", async () => {
    expect(
      (
        await writeGameProgressFile(env, "  ", {
          storyId: "",
          savedVariables: {},
          persistentVariables: {},
          anchor: null,
          visitedSceneIds: []
        })
      ).outcome
    ).toBe("failed");
    expect((await readGameProgressFile(env, "")).outcome).toBe("failed");
  });
});
