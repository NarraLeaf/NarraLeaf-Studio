import { describe, expect, it } from "vitest";
import {
  MODEL_SCAN_MAX_FILES,
  isBlockingModelProblem,
  scanFolderForModels,
  type ModelScanFs,
  type ScannedModel
} from "./modelImportScanner";

const ROOT = "D:/models";

/**
 * An in-memory tree keyed by scan-root-relative path. Values are file contents; the byte size a
 * scan sees is the string's length, which is enough for the totals under test.
 */
function fakeFs(
  tree: Record<string, string>,
  options: { unreadable?: string[]; rootUnreadable?: boolean } = {}
): ModelScanFs {
  const unreadable = new Set(options.unreadable ?? []);
  return {
    async listTree(root) {
      if (options.rootUnreadable || root !== ROOT) {
        return null;
      }
      return Object.fromEntries(Object.entries(tree).map(([path, text]) => [path, text.length]));
    },
    async readText(path) {
      const relative = path.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (unreadable.has(relative)) {
        return null;
      }
      return tree[relative] ?? null;
    }
  };
}

function live2dManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: "Hiyori.moc3",
      Textures: ["Hiyori.2048/texture_00.png"],
      Physics: "Hiyori.physics3.json",
      ...overrides
    }
  });
}

const HIYORI: Record<string, string> = {
  "Hiyori/Hiyori.model3.json": live2dManifest(),
  "Hiyori/Hiyori.moc3": "moc-bytes",
  "Hiyori/Hiyori.2048/texture_00.png": "png-bytes",
  "Hiyori/Hiyori.physics3.json": "{}"
};

const SPINE_ATLAS = "raptor.png\nsize: 2048,1024\nback_arm\n  xy: 1, 1\n";

const RAPTOR: Record<string, string> = {
  "raptor/raptor.skel": "skel-bytes",
  "raptor/raptor.atlas": SPINE_ATLAS,
  "raptor/raptor.png": "png-bytes"
};

async function scan(
  family: "live2d" | "spine",
  tree: Record<string, string>,
  options?: Parameters<typeof fakeFs>[1]
) {
  const outcome = await scanFolderForModels(family, ROOT, fakeFs(tree, options));
  if (!outcome.ok) {
    throw new Error(`scan failed: ${outcome.reason}`);
  }
  return outcome.models;
}

function problemKinds(model: ScannedModel): string[] {
  return model.problems.map((problem) => problem.kind);
}

describe("scanFolderForModels — Live2D", () => {
  it("imports the manifest's own folder, not the folder that was picked", async () => {
    const models = await scan("live2d", HIYORI);
    expect(models).toHaveLength(1);
    expect(models[0].rootPath).toBe("D:/models/Hiyori");
    expect(models[0].relativePath).toBe("Hiyori");
    expect(models[0].name).toBe("Hiyori");
    expect(models[0].entry).toBe("Hiyori.model3.json");
    expect(models[0].format).toBe("live2d-cubism4");
    expect(models[0].problems).toEqual([]);
  });

  it("treats the picked folder itself as the model when the manifest sits at its root", async () => {
    const models = await scan("live2d", {
      "Hiyori.model3.json": live2dManifest(),
      "Hiyori.moc3": "moc",
      "Hiyori.2048/texture_00.png": "png",
      "Hiyori.physics3.json": "{}"
    });
    expect(models).toHaveLength(1);
    expect(models[0].rootPath).toBe(ROOT);
    expect(models[0].relativePath).toBe("");
    expect(models[0].name).toBe("models");
    expect(models[0].problems).toEqual([]);
  });

  it("finds every character under a library folder", async () => {
    const models = await scan("live2d", {
      ...HIYORI,
      "Mark/Mark.model3.json": JSON.stringify({
        FileReferences: { Moc: "Mark.moc3", Textures: ["Mark.2048/texture_00.png"] }
      }),
      "Mark/Mark.moc3": "moc",
      "Mark/Mark.2048/texture_00.png": "png",
      "readme.txt": "hello"
    });
    expect(models.map((model) => model.name)).toEqual(["Hiyori", "Mark"]);
    expect(models.every((model) => model.problems.length === 0)).toBe(true);
  });

  it("reports a missing texture as a blocking problem, named relative to the model", async () => {
    const tree = { ...HIYORI };
    delete tree["Hiyori/Hiyori.2048/texture_00.png"];
    const [model] = await scan("live2d", tree);
    expect(model.problems).toEqual([
      { kind: "missing", role: "texture", path: "Hiyori.2048/texture_00.png" }
    ]);
    expect(model.problems.every(isBlockingModelProblem)).toBe(true);
  });

  it("reports a missing sidecar without blocking the import", async () => {
    const tree = { ...HIYORI };
    delete tree["Hiyori/Hiyori.physics3.json"];
    const [model] = await scan("live2d", tree);
    expect(model.problems).toEqual([
      { kind: "missing", role: "physics", path: "Hiyori.physics3.json" }
    ]);
    expect(model.problems.some(isBlockingModelProblem)).toBe(false);
  });

  it("puts blocking problems first", async () => {
    const tree = { ...HIYORI };
    delete tree["Hiyori/Hiyori.physics3.json"];
    delete tree["Hiyori/Hiyori.moc3"];
    const [model] = await scan("live2d", tree);
    expect(model.problems[0]).toEqual({ kind: "missing", role: "moc", path: "Hiyori.moc3" });
  });

  it("reports an unreadable or malformed manifest rather than treating it as complete", async () => {
    const [unreadable] = await scan("live2d", HIYORI, {
      unreadable: ["Hiyori/Hiyori.model3.json"]
    });
    expect(unreadable.problems).toEqual([
      { kind: "manifestUnreadable", path: "Hiyori.model3.json" }
    ]);

    const [malformed] = await scan("live2d", {
      ...HIYORI,
      "Hiyori/Hiyori.model3.json": "{ not json"
    });
    expect(malformed.problems).toEqual([
      { kind: "manifestUnreadable", path: "Hiyori.model3.json" }
    ]);
  });

  it("reports a reference that points outside the folder", async () => {
    const [model] = await scan("live2d", {
      ...HIYORI,
      "Hiyori/Hiyori.model3.json": live2dManifest({ Textures: ["https://cdn.example.com/t.png"] })
    });
    expect(model.problems).toEqual([
      { kind: "unusableReference", role: "texture", raw: "https://cdn.example.com/t.png" }
    ]);
  });

  it("merges two models sharing one folder into one asset with a choice of entry", async () => {
    const [model] = await scan("live2d", {
      "pair/a.model3.json": JSON.stringify({
        FileReferences: { Moc: "a.moc3", Textures: ["a.png"] }
      }),
      "pair/b.model3.json": JSON.stringify({
        FileReferences: { Moc: "b.moc3", Textures: ["b.png"] }
      }),
      "pair/a.moc3": "moc",
      "pair/a.png": "png",
      "pair/b.moc3": "moc",
      "pair/b.png": "png"
    });
    expect(model.entryChoices).toEqual(["a.model3.json", "b.model3.json"]);
    expect(model.entry).toBe("a.model3.json");
    expect(model.problems).toEqual([]);
  });

  it("prefers a Cubism 4 manifest over a Cubism 2 one in the same folder", async () => {
    const [model] = await scan("live2d", {
      "mixed/model.json": JSON.stringify({ model: "m.moc", textures: ["t.png"] }),
      "mixed/new.model3.json": JSON.stringify({
        FileReferences: { Moc: "m.moc3", Textures: ["t.png"] }
      }),
      "mixed/m.moc": "moc",
      "mixed/m.moc3": "moc3",
      "mixed/t.png": "png"
    });
    expect(model.entry).toBe("new.model3.json");
    expect(model.format).toBe("live2d-cubism4");
  });

  it("warns when one model's folder contains another", async () => {
    const models = await scan("live2d", {
      "Hiyori.model3.json": live2dManifest({ Textures: ["t.png"] }),
      "Hiyori.moc3": "moc",
      "t.png": "png",
      "Hiyori.physics3.json": "{}",
      ...HIYORI
    });
    const outer = models.find((model) => model.relativePath === "")!;
    expect(problemKinds(outer)).toEqual(["nestedModel"]);
    expect(outer.problems[0]).toEqual({ kind: "nestedModel", path: "Hiyori" });
    expect(outer.problems.some(isBlockingModelProblem)).toBe(false);
    expect(models.find((model) => model.relativePath === "Hiyori")!.problems).toEqual([]);
  });

  it("counts only the files under the model's own folder", async () => {
    const models = await scan("live2d", { ...HIYORI, "unrelated/note.txt": "hello" });
    expect(models[0].fileCount).toBe(4);
    expect(models[0].totalBytes).toBe(
      HIYORI["Hiyori/Hiyori.model3.json"].length + "moc-bytes".length + "png-bytes".length + 2
    );
  });

  it("finds nothing in a folder with no Live2D manifest", async () => {
    expect(await scan("live2d", RAPTOR)).toEqual([]);
  });

  it("does not claim a model.json that names no moc", async () => {
    expect(
      await scan("live2d", {
        "config/model.json": JSON.stringify({ name: "something else", textures: ["a.png"] }),
        "config/a.png": "png"
      })
    ).toEqual([]);
    expect(await scan("live2d", { "config/model.json": "not json at all" })).toEqual([]);
  });

  it("still reports a Cubism 4 manifest that names no moc, because that one is broken", async () => {
    const [model] = await scan("live2d", {
      "broken/broken.model3.json": JSON.stringify({ FileReferences: { Textures: ["t.png"] } }),
      "broken/t.png": "png"
    });
    expect(model.relativePath).toBe("broken");
    expect(model.problems).toEqual([]);
  });

  it("keeps a Cubism 2 model whose moc is named but missing", async () => {
    const [model] = await scan("live2d", {
      "haru/model.json": JSON.stringify({ model: "haru.moc", textures: ["t.png"] }),
      "haru/t.png": "png"
    });
    expect(model.entry).toBe("model.json");
    expect(model.problems).toEqual([{ kind: "missing", role: "moc", path: "haru.moc" }]);
  });

  it("does not warn about containing a folder whose manifest was not one", async () => {
    const models = await scan("live2d", {
      "Hiyori.model3.json": live2dManifest({ Textures: ["t.png"] }),
      "Hiyori.moc3": "moc",
      "t.png": "png",
      "Hiyori.physics3.json": "{}",
      "config/model.json": JSON.stringify({ unrelated: true })
    });
    expect(models).toHaveLength(1);
    expect(models[0].problems).toEqual([]);
  });
});

describe("scanFolderForModels — Spine", () => {
  it("pairs a binary skeleton with its atlas and checks the page images", async () => {
    const [model] = await scan("spine", RAPTOR);
    expect(model.relativePath).toBe("raptor");
    expect(model.entry).toBe("raptor.skel");
    expect(model.format).toBe("spine-binary");
    expect(model.problems).toEqual([]);
  });

  it("reports a page image the atlas names but the folder does not have", async () => {
    const tree = { ...RAPTOR };
    delete tree["raptor/raptor.png"];
    const [model] = await scan("spine", tree);
    expect(model.problems).toEqual([{ kind: "missing", role: "page", path: "raptor.png" }]);
    expect(model.problems.every(isBlockingModelProblem)).toBe(true);
  });

  it("names the atlas it expected when there is none", async () => {
    const [model] = await scan("spine", {
      "raptor/raptor.skel": "skel",
      "raptor/raptor.png": "png"
    });
    expect(model.problems).toEqual([{ kind: "atlasMissing", path: "raptor.atlas" }]);
  });

  it("reports an atlas that names no page image", async () => {
    const [model] = await scan("spine", { ...RAPTOR, "raptor/raptor.atlas": "\n\n" });
    expect(model.problems).toEqual([{ kind: "atlasEmpty", path: "raptor.atlas" }]);
  });

  it("recognises a JSON skeleton", async () => {
    const [model] = await scan("spine", {
      "boy/spineboy.json": JSON.stringify({ skeleton: { spine: "4.1.24" }, bones: [], slots: [] }),
      "boy/spineboy.atlas": "spineboy.png\nsize: 1,1\n",
      "boy/spineboy.png": "png"
    });
    expect(model.entry).toBe("spineboy.json");
    expect(model.format).toBe("spine-json");
    expect(model.problems).toEqual([]);
  });

  it("treats a skeleton exported in both encodings as one model, entered through the binary", async () => {
    const [model] = await scan("spine", {
      ...RAPTOR,
      "raptor/raptor.json": JSON.stringify({ skeleton: { spine: "4.1.24" }, bones: [], slots: [] })
    });
    expect(model.entryChoices).toEqual(["raptor.skel"]);
  });

  it("pairs with the only atlas in the folder when the stems differ", async () => {
    const [model] = await scan("spine", {
      "raptor/character.skel": "skel",
      "raptor/packed.atlas": SPINE_ATLAS,
      "raptor/raptor.png": "png"
    });
    expect(model.problems).toEqual([]);
  });

  it("does not read a Live2D folder's sidecars looking for skeletons", async () => {
    const reads: string[] = [];
    const fs = fakeFs({ ...HIYORI, "Hiyori/motions/idle.motion3.json": "{}" });
    const spy: ModelScanFs = {
      listTree: fs.listTree,
      readText: async (path) => {
        reads.push(path);
        return fs.readText(path);
      }
    };
    const outcome = await scanFolderForModels("spine", ROOT, spy);
    expect(outcome).toEqual({ ok: true, models: [] });
    expect(reads).toEqual([]);
  });

  it("finds nothing when a JSON file is not a skeleton", async () => {
    expect(await scan("spine", { "data/config.json": JSON.stringify({ a: 1 }) })).toEqual([]);
  });
});

describe("scanFolderForModels — refusals", () => {
  it("refuses a folder it cannot read rather than reporting no models", async () => {
    const outcome = await scanFolderForModels("live2d", ROOT, fakeFs({}, { rootUnreadable: true }));
    expect(outcome).toEqual({ ok: false, reason: "unreadable" });
  });

  it("refuses a folder past the file cap rather than validating against a short listing", async () => {
    const tree: Record<string, string> = {};
    for (let index = 0; index <= MODEL_SCAN_MAX_FILES; index += 1) {
      tree[`bulk/file-${index}.bin`] = "x";
    }
    const outcome = await scanFolderForModels("live2d", ROOT, fakeFs(tree));
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ reason: "tooManyFiles", fileCount: MODEL_SCAN_MAX_FILES + 1 });
  });
});
