import path from "path";
import { describe, expect, it, vi } from "vitest";
import { resolveRuntimeUserDataDir, type PlayerDataEnvironment } from "./userDataDir";

/**
 * `path` here is the host's, so the Windows cases assert Windows separators only
 * when the suite runs on Windows. The assertions below therefore compare against
 * `path.join` output rather than literal strings.
 */
function environment(overrides: Partial<PlayerDataEnvironment> = {}): PlayerDataEnvironment {
  return {
    platform: "win32",
    appDataDir: path.join("C:", "Users", "p", "AppData", "Roaming"),
    shellUserDataDir: path.join("C:", "Users", "p", "AppData", "Roaming", "My Game"),
    homeDir: path.join("C:", "Users", "p"),
    // An empty filesystem by default; withFiles() supplies one with contents.
    exists: () => false,
    makeDirectory: () => undefined,
    move: () => undefined,
    warn: () => undefined,
    ...overrides
  };
}

/** An environment whose filesystem contains exactly `paths`. */
function withFiles(
  paths: string[],
  overrides: Partial<PlayerDataEnvironment> = {}
): PlayerDataEnvironment {
  const present = new Set(paths);
  return environment({ exists: (target) => present.has(target), ...overrides });
}

describe("resolveRuntimeUserDataDir", () => {
  it("keeps the shell's directory when the manifest names none", () => {
    const env = environment();
    expect(resolveRuntimeUserDataDir(null, env)).toBe(env.shellUserDataDir);
  });

  it("puts the directory under roaming app data on Windows", () => {
    const env = environment();
    expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
      path.join(env.appDataDir, "com.studio.game")
    );
  });

  it("puts the directory under Application Support on macOS", () => {
    const env = environment({
      platform: "darwin",
      appDataDir: "/Users/p/Library/Application Support",
      shellUserDataDir: "/Users/p/Library/Application Support/My Game",
      homeDir: "/Users/p"
    });
    expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
      path.join("/Users/p/Library/Application Support", "com.studio.game")
    );
  });

  // The whole reason Linux is special-cased: Electron's appData is
  // XDG_CONFIG_HOME, which is both the wrong XDG category for save data and a
  // location the forms that sync it cannot name.
  it("puts the directory under the XDG data home on Linux, not app data", () => {
    const env = environment({
      platform: "linux",
      appDataDir: "/home/p/.config",
      shellUserDataDir: "/home/p/.config/My Game",
      homeDir: "/home/p"
    });
    expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
      path.join("/home/p/.local/share", "com.studio.game")
    );
  });

  it("honours XDG_DATA_HOME when it is absolute", () => {
    const env = environment({
      platform: "linux",
      appDataDir: "/home/p/.config",
      shellUserDataDir: "/home/p/.config/My Game",
      homeDir: "/home/p",
      xdgDataHome: "/data/p"
    });
    expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
      path.join("/data/p", "com.studio.game")
    );
  });

  it("ignores a relative XDG_DATA_HOME, as the specification requires", () => {
    const env = environment({
      platform: "linux",
      appDataDir: "/home/p/.config",
      shellUserDataDir: "/home/p/.config/My Game",
      homeDir: "/home/p",
      xdgDataHome: "relative/share"
    });
    expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
      path.join("/home/p/.local/share", "com.studio.game")
    );
  });

  describe("carrying a previous install across", () => {
    it("moves a directory holding saves", () => {
      const move = vi.fn();
      const shellUserDataDir = path.join("C:", "Users", "p", "AppData", "Roaming", "My Game");
      const env = withFiles([shellUserDataDir, path.join(shellUserDataDir, "saves")], { move });
      const resolved = resolveRuntimeUserDataDir("com.studio.game", env);
      expect(move).toHaveBeenCalledWith(shellUserDataDir, resolved);
      expect(resolved).toBe(path.join(env.appDataDir, "com.studio.game"));
    });

    it("moves a directory holding only the persistence file", () => {
      const move = vi.fn();
      const shellUserDataDir = path.join("C:", "Users", "p", "AppData", "Roaming", "My Game");
      const env = withFiles([shellUserDataDir, path.join(shellUserDataDir, "persistence.json")], {
        move
      });
      resolveRuntimeUserDataDir("com.studio.game", env);
      expect(move).toHaveBeenCalledOnce();
    });

    // Electron creates userData before the game writes anything, so a bare
    // directory is not evidence that a player has ever played.
    it("leaves a directory the shell merely created", () => {
      const move = vi.fn();
      const shellUserDataDir = path.join("C:", "Users", "p", "AppData", "Roaming", "My Game");
      const env = withFiles([shellUserDataDir], { move });
      expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
        path.join(env.appDataDir, "com.studio.game")
      );
      expect(move).not.toHaveBeenCalled();
    });

    it("never writes over a directory that is already in use", () => {
      const move = vi.fn();
      const appDataDir = path.join("C:", "Users", "p", "AppData", "Roaming");
      const shellUserDataDir = path.join(appDataDir, "My Game");
      const env = withFiles(
        [
          shellUserDataDir,
          path.join(shellUserDataDir, "saves"),
          path.join(appDataDir, "com.studio.game")
        ],
        { move }
      );
      expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(
        path.join(appDataDir, "com.studio.game")
      );
      expect(move).not.toHaveBeenCalled();
    });

    // Losing sight of a player's saves is the one outcome worth degrading
    // for: the old location still has them, an empty new one does not.
    it("stays on the old directory when the move fails", () => {
      const warn = vi.fn();
      const shellUserDataDir = path.join("C:", "Users", "p", "AppData", "Roaming", "My Game");
      const env = withFiles([shellUserDataDir, path.join(shellUserDataDir, "saves")], {
        move: () => {
          throw new Error("EPERM");
        },
        warn
      });
      expect(resolveRuntimeUserDataDir("com.studio.game", env)).toBe(shellUserDataDir);
      expect(warn).toHaveBeenCalledOnce();
    });
  });
});
