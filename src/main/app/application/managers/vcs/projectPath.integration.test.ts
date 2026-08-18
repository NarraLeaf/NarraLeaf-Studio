import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import { VcsManager, VcsProjectPathError } from "./VcsManager";

/**
 * How a project path is spelled, and what this layer does with a spelling it cannot use.
 *
 * Two separate claims, one about each half of {@link VcsManager}'s path boundary.
 *
 * **A native Windows path works.** Every real project path in Studio arrives with backslashes -
 * native dialogs return them, `path.join` produces them, the project wizard passes one straight
 * to `initRepository` - so if the backend were separator-sensitive, creating a project with
 * version control enabled would be broken on the platform most authors are on. It is not, and
 * the reason this is asserted rather than assumed is that it has been reported as broken twice:
 * both times the backslashes had been eaten UPSTREAM of Studio, by a driver that let a path
 * literal through one round of escape processing (`D:\Temp\nls\back` unescapes to
 * `D:Temp` + newline + `ls` + backspace + `ack`, which Windows answers with os error 123 from
 * the first call that touches the disk). This test is what settles that question next time.
 *
 * **A path that is not already absolute is refused.** That is the other half of the same
 * incident: `path.resolve` would have turned the mangled path above into one rooted at the main
 * process's working directory and reported success, so the failure mode a valid-looking mangled
 * path buys is a repository created somewhere the author never named.
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);
const onWindows = process.platform === "win32";

let root: string;
let manager: VcsManager;

function fakeApp(): BaseApp {
  const noop = () => undefined;
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    getGlobalState: () => ({ get: () => undefined })
  } as unknown as BaseApp;
}

beforeAll(() => {
  manager = new VcsManager(fakeApp());
});

afterAll(async () => {
  await manager?.dispose().catch(() => undefined);
  for (let attempt = 0; attempt < 20 && root; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}, 120_000);

describe.skipIf(!supported)("a project path spelled the way the platform spells it", () => {
  it("puts a project under version control, and answers to either separator afterwards", async () => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-path-")));
    fs.writeFileSync(path.join(root, "project.json"), JSON.stringify({ name: "path" }));

    // Native spelling: on Windows this is the backslash form, and it is what the wizard,
    // the version rail and every window-close path actually hand over.
    if (onWindows) expect(root).toContain("\\");

    const created = await manager.initRepository(root, { message: "Enable version control" });
    expect(created.repositoryId).toBeTruthy();
    expect(created.headNumber).toBe(1);
    // Reported back in the platform's own spelling, which is what callers store and compare.
    expect(created.root).toBe(path.resolve(root));

    // The same directory named the other way is the SAME project, not a second one. Getting
    // this wrong does not duplicate a cache - it opens a second store on one repository, and
    // Lore's repository lock is exclusive and blocking, so the second open never returns.
    const other = onWindows ? root.replace(/\\/g, "/") : root;
    expect(await manager.isRepository(other)).toBe(true);
    const info = await manager.getInfo(other);
    expect(info.repositoryId).toBe(created.repositoryId);
    expect(info.root).toBe(path.resolve(root));

    await manager.closeProject(root);
  }, 180_000);
});

describe("a project path this layer cannot use", () => {
  /** Every verb goes through the same guard, so a sample of them is the whole surface. */
  const relative = path.join("projects", "prologue");

  it("is refused rather than resolved against the process working directory", async () => {
    await expect(manager.initRepository(relative)).rejects.toBeInstanceOf(VcsProjectPathError);
    await expect(manager.getInfo(relative)).rejects.toBeInstanceOf(VcsProjectPathError);
    await expect(manager.commit(relative)).rejects.toBeInstanceOf(VcsProjectPathError);
    await expect(
      manager.cloneRepository("lore://example.invalid/x", relative)
    ).rejects.toBeInstanceOf(VcsProjectPathError);
  });

  it("says so in a sentence naming the likely cause", async () => {
    const error = await manager.initRepository(relative).catch((cause: unknown) => cause);
    expect(String(error)).toContain("absolute project path");
    // The path is quoted, so a control character in it is visible rather than swallowed.
    expect(String(error)).toContain(JSON.stringify(relative));
  });

  it("carries no NUL, which would mean something different on the far side of the FFI", async () => {
    const withNul = path.join(os.tmpdir(), "prologue\u0000extra");
    await expect(manager.initRepository(withNul)).rejects.toBeInstanceOf(VcsProjectPathError);
  });

  it.skipIf(!onWindows)("catches the shape an unescaped Windows path takes", async () => {
    // `D:\Temp\nls-close\back` after one round of escape processing: \T drops its backslash,
    // \n becomes a newline, \b a backspace. Drive-relative AND unnameable, and the guard
    // answers before anything touches the disk.
    const unescaped = "D:Temp\nls-close\back";
    await expect(manager.initRepository(unescaped)).rejects.toBeInstanceOf(VcsProjectPathError);

    // Absolute but still unnameable on Windows, which reaches the disk as os error 123.
    const controlCharacter = path.join(os.tmpdir(), "prologue\nnext");
    await expect(manager.initRepository(controlCharacter)).rejects.toBeInstanceOf(
      VcsProjectPathError
    );
  });

  it("reports a bad path as 'not a repository' rather than throwing, like any other failure", async () => {
    // `isRepository` is a plain feature check three surfaces call on open; it swallows
    // everything, and that has to stay true of the guard too.
    expect(await manager.isRepository(relative)).toBe(false);
  });
});
