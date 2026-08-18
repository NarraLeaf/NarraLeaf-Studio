import fs from "fs/promises";
import path from "path";

/**
 * Locating the vendored zsign binary that re-signs an IPA.
 *
 * zsign is not downloaded on the author's machine — it is staged into
 * resources/ while *Studio itself* is built (project/build/prepare-codesign-tools.js)
 * and copied into the installer by the per-platform extraResources blocks in
 * electron-builder.yml. So resolution here is a lookup, never a fetch: the
 * mobile build pipeline is offline by construction and iOS signing must not be
 * the step that breaks that.
 *
 * The lookup mirrors mobileShellTemplate.ts: a packaged Studio reads the copy
 * under its resources directory, development reads the repo tree (where
 * resolveResource points at <root>/resources). Development differs in one
 * respect — a checkout that has never run the staging script has no binary at
 * all, so a cache directory under .dev/ is searched as well. That is also where
 * someone on a host with no upstream asset can drop a self-built zsign without
 * touching a tracked path.
 */

/** Upstream release we vendor. Mirrors ZSIGN_VERSION in project/build/prepare-codesign-tools.js. */
export const ZSIGN_VERSION = "1.1.1";

/**
 * Escape hatch for hosts the vendoring cannot serve — Windows and Linux arm64
 * above all, which have no upstream asset at v1.1.1. Set it to an absolute path
 * and that binary is used verbatim, on any platform.
 */
export const ZSIGN_PATH_ENV = "NLS_ZSIGN_PATH";

/**
 * The subset of App this module needs. `App` satisfies it structurally, so main
 * passes itself; a duck-typed seam keeps this file free of electron imports,
 * which matters because the build worker runs outside the main process.
 */
export type ZsignResolverApp = {
  isPackaged(): boolean;
  resolveResource(p: string): string;
};

export type ZsignHostTarget = {
  /** Directory name under resources/codesign/, keyed by process.platform. */
  platformKey: string;
  /** File name the staging script writes the binary under. */
  binaryName: string;
};

/**
 * Which hosts the vendored tool covers, and under what name it lands.
 *
 * Kept in step with the ASSETS table in prepare-codesign-tools.js, and short for
 * the same reason: upstream publishes one asset per row and nothing else.
 * Windows and Linux arm64 are absent because there is no asset for them; those
 * hosts can only sign via ZSIGN_PATH_ENV pointing at a self-built binary.
 *
 * **macOS x64 is absent for a stronger reason than a missing asset: Studio is
 * not shipped for Intel Macs at all** (see .github/workflows/release.yml — the
 * missing zsign asset was one of the three subsystems behind that decision), so
 * this function is never called with that pair on a real host. The row stays
 * `null` rather than being asserted away, because the mapping is keyed on
 * arguments and a caller is free to ask.
 *
 * `arch` here is the *host's* — where zsign runs. The architecture of the game
 * being signed is a separate axis and never reaches this table.
 */
export function zsignHostTarget(
  platform: string = process.platform,
  arch: string = process.arch
): ZsignHostTarget | null {
  if (platform === "win32" && arch === "x64") {
    return { platformKey: "win32", binaryName: "zsign.exe" };
  }
  if (platform === "linux" && arch === "x64") {
    return { platformKey: "linux", binaryName: "zsign" };
  }
  if (platform === "darwin" && arch === "arm64") {
    return { platformKey: "darwin", binaryName: "zsign" };
  }
  return null;
}

export type ZsignUnavailableReason =
  /** No upstream asset for this platform/arch pair; nothing was ever staged. */
  | "host-unsupported"
  /** Supported host, but the binary is not on disk (staging step never ran). */
  | "not-staged";

export type ZsignTool =
  | { available: true; path: string }
  | {
      available: false;
      reason: ZsignUnavailableReason;
      /** One sentence for a build log. UI copy is the caller's business. */
      detail: string;
      /** Absolute paths that were looked at, in order. Empty when unsupported. */
      searched: string[];
    };

export type ZsignResolveOptions = {
  platform?: string;
  arch?: string;
  env?: Record<string, string | undefined>;
};

/**
 * Where the binary is looked for, in order. Packaged Studio has exactly one
 * candidate; development adds the .dev cache fallback.
 */
export function zsignSearchPaths(app: ZsignResolverApp, target: ZsignHostTarget): string[] {
  const staged = app.resolveResource(path.join("codesign", target.platformKey, target.binaryName));
  if (app.isPackaged()) {
    return [staged];
  }
  return [
    staged,
    app.resolveResource(
      path.join("..", ".dev", "cache", "codesign", target.platformKey, target.binaryName)
    )
  ];
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the zsign binary for this host.
 *
 * Never throws and never touches the network: a preflight check runs this while
 * the build dialog is open and needs a verdict, not an exception. An
 * `available: false` result is a normal outcome — signing an iOS build is
 * optional, and a Studio that cannot do it still builds everything else.
 */
export async function resolveZsignTool(
  app: ZsignResolverApp,
  options: ZsignResolveOptions = {}
): Promise<ZsignTool> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;

  const override = env[ZSIGN_PATH_ENV]?.trim();
  if (override) {
    if (await isFile(override)) {
      return { available: true, path: override };
    }
    return {
      available: false,
      reason: "not-staged",
      detail: `${ZSIGN_PATH_ENV} points at ${override}, which is not a file`,
      searched: [override]
    };
  }

  const target = zsignHostTarget(platform, arch);
  if (target === null) {
    return {
      available: false,
      reason: "host-unsupported",
      detail:
        `zsign ${ZSIGN_VERSION} publishes no build for ${platform}-${arch}, so no iOS signing tool ` +
        `was bundled; set ${ZSIGN_PATH_ENV} to a zsign binary built for this host to sign anyway`,
      searched: []
    };
  }

  const searched = zsignSearchPaths(app, target);
  for (const candidate of searched) {
    if (await isFile(candidate)) {
      return { available: true, path: candidate };
    }
  }
  return {
    available: false,
    reason: "not-staged",
    detail:
      `the bundled iOS signing tool is missing (looked in ${searched.join(", ")}); ` +
      "run project/build/prepare-codesign-tools.js to stage it",
    searched
  };
}
