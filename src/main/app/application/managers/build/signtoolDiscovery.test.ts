import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { findSigntool } from "./signtoolDiscovery";

/**
 * The probe is judged against a synthetic Windows Kits tree rather than the
 * host's own SDK: a machine without one would otherwise "pass" by finding
 * nothing, and a machine with one would prove only that this machine has it.
 * Nothing here executes signtool.
 */

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** Relative path of a signtool inside the 10.x kit of the x86 Program Files. */
function kit(version: string, arch: string): string {
  return `PF86/Windows Kits/10/bin/${version}/${arch}/signtool.exe`;
}

async function tempTree(files: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-signtool-"));
  dirs.push(root);
  for (const file of files) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "");
  }
  return root;
}

function env(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    "ProgramFiles(x86)": path.join(root, "PF86"),
    ProgramFiles: path.join(root, "PF"),
    ...extra
  };
}

function at(root: string, relative: string): string {
  return path.join(root, ...relative.split("/"));
}

describe("findSigntool", () => {
  it("takes the newest kit version and the host's tool arch", async () => {
    const root = await tempTree([
      kit("10.0.17134.0", "x64"),
      kit("10.0.26100.0", "x86"),
      kit("10.0.26100.0", "x64"),
      kit("10.0.9999.0", "arm64")
    ]);
    expect(await findSigntool({ env: env(root), platform: "win32", arch: "x64" })).toBe(
      at(root, kit("10.0.26100.0", "x64"))
    );
  });

  it("falls back to an x64 tool when the host arch has none", async () => {
    const root = await tempTree([kit("10.0.26100.0", "x64")]);
    expect(await findSigntool({ env: env(root), platform: "win32", arch: "arm64" })).toBe(
      at(root, kit("10.0.26100.0", "x64"))
    );
  });

  it("maps a 32-bit host onto the x86 tools", async () => {
    const root = await tempTree([kit("10.0.26100.0", "x86"), kit("10.0.26100.0", "x64")]);
    expect(await findSigntool({ env: env(root), platform: "win32", arch: "ia32" })).toBe(
      at(root, kit("10.0.26100.0", "x86"))
    );
  });

  it("reads the pre-10.0.15063 layout, where the tools sit straight under bin", async () => {
    const root = await tempTree(["PF86/Windows Kits/8.1/bin/x64/signtool.exe"]);
    expect(await findSigntool({ env: env(root), platform: "win32", arch: "x64" })).toBe(
      at(root, "PF86/Windows Kits/8.1/bin/x64/signtool.exe")
    );
  });

  it("honours SIGNTOOL_PATH, as the file or as its directory", async () => {
    const root = await tempTree(["custom/signtool.exe", kit("10.0.26100.0", "x64")]);
    const custom = at(root, "custom/signtool.exe");
    expect(
      await findSigntool({
        env: env(root, { SIGNTOOL_PATH: custom }),
        platform: "win32",
        arch: "x64"
      })
    ).toBe(custom);
    expect(
      await findSigntool({
        env: env(root, { SIGNTOOL_PATH: path.join(root, "custom") }),
        platform: "win32",
        arch: "x64"
      })
    ).toBe(custom);
  });

  it("ignores a SIGNTOOL_PATH that points at nothing and keeps probing", async () => {
    const root = await tempTree([kit("10.0.26100.0", "x64")]);
    expect(
      await findSigntool({
        env: env(root, { SIGNTOOL_PATH: at(root, "gone/signtool.exe") }),
        platform: "win32",
        arch: "x64"
      })
    ).toBe(at(root, kit("10.0.26100.0", "x64")));
  });

  it("finds nothing on a host without an SDK, and never looks off Windows", async () => {
    const empty = await tempTree(["PF86/Windows Kits/10/bin/notes.txt"]);
    expect(await findSigntool({ env: env(empty), platform: "win32", arch: "x64" })).toBeNull();

    const withKit = await tempTree([kit("10.0.26100.0", "x64")]);
    expect(await findSigntool({ env: env(withKit), platform: "linux", arch: "x64" })).toBeNull();
  });
});
