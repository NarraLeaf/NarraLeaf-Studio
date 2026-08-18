/**
 * Installing an author-supplied 2D model runtime into a project.
 *
 * Two routes, because the two runtimes Studio names cannot be obtained the same way:
 *
 * - **From an SDK archive.** The author hands over the vendor's SDK and Studio compiles the adapter on
 *   this machine. Live2D's only legal route — the Cubism Framework ships as TypeScript source and only
 *   the Core is redistributable, so no prebuilt Live2D adapter may be published by anyone. Needs a
 *   bundler, so the work happens in the host; this is the call.
 * - **From a prebuilt adapter.** The author points at a module they built themselves. The route for
 *   Spine (Studio carries no Spine glue, because integrating a Spine runtime requires the integrator to
 *   hold a Spine Editor licence and NarraLeaf holds none) and for any runtime an author wrote.
 *
 * Studio never downloads either. Both routes end with `<project>/runtimes/puppet/<backend>/index.js`,
 * which is what the editor lists, the pack step copies, and Dev Mode loads.
 */

import { Game } from "narraleaf-react";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { getInterface } from "@/lib/app/bridge";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { loadPuppetBackends } from "@/lib/ui-editor/runtime/game/puppetBackendHost";
import type { RequestStatus } from "@shared/types/ipcEvents";
import type { FsRequestResult } from "@shared/types/os";
import type { PuppetRuntimeInstallResult } from "@shared/types/puppetRuntime";
import { PUPPET_RUNTIME_ENTRY_FILE, type KnownPuppetRuntimeId } from "@shared/utils/puppetRuntimes";
import type { Porject } from "@/lib/workspace/project/project";
import { createPuppetBackendSource } from "./projectPuppetRuntimes";

/** Extensions offered when picking an SDK archive. */
export const SDK_ARCHIVE_EXTENSIONS = ["zip"];

/** Where a prebuilt adapter is coming from. A zip is deliberately not offered — see {@link installPrebuiltPuppetRuntime}. */
export type PrebuiltPuppetRuntimeSource =
  /** A directory to copy whole, for an adapter whose module has siblings (a wasm core, a texture). */
  | { kind: "directory"; path: string }
  /** A single self-contained `index.js`, which is what a bundled adapter usually is. */
  | { kind: "file"; path: string };

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Unwrap the two-layer result the privileged facade returns, or throw with whichever layer failed.
 *
 * The layers mean different things and both have to be checked: the outer one is whether the call
 * reached the host, the inner one is whether the filesystem allowed it. A write under a frozen workspace
 * comes back as an inner refusal, so this is also what stops a freeze looking like a successful install.
 */
async function required<T>(
  operation: Promise<RequestStatus<FsRequestResult<T>>>,
  what: string
): Promise<T> {
  const result = await operation;
  if (!result.success) {
    fail(result.error ?? `Could not ${what}`);
  }
  if (!result.data.ok) {
    fail(result.data.error?.message ?? `Could not ${what}`);
  }
  return result.data.data;
}

function runtimeDir(project: Porject, backend: string): string {
  return project.resolve(ProjectNameConvention.PuppetRuntimes, backend);
}

/** Ask the author for the vendor's SDK archive. Returns null when they cancelled. */
export async function pickSdkArchive(): Promise<string | null> {
  const picked = await getInterface().fs.selectFile(SDK_ARCHIVE_EXTENSIONS, false);
  if (!picked.success || !picked.data.ok) {
    return null;
  }
  return picked.data.data[0] ?? null;
}

export async function pickPrebuiltRuntimeDirectory(): Promise<string | null> {
  const picked = await getInterface().fs.selectDirectory(false);
  if (!picked.success || !picked.data.ok) {
    return null;
  }
  return picked.data.data[0] ?? null;
}

export async function pickPrebuiltRuntimeFile(): Promise<string | null> {
  const picked = await getInterface().fs.selectFile(["js", "mjs"], false);
  if (!picked.success || !picked.data.ok) {
    return null;
  }
  return picked.data.data[0] ?? null;
}

/**
 * Compile a runtime from the vendor SDK the author supplied.
 *
 * Thin on purpose: the destination is derived in the host from the project path and authorized there,
 * so this cannot aim the write, and the host's error text is passed straight through because it is
 * written to be the author's next step ("this archive has no Core/…", "its top-level entries are: …").
 */
export async function installPuppetRuntimeFromSdk(
  project: Porject,
  runtimeId: KnownPuppetRuntimeId,
  archivePath: string
): Promise<PuppetRuntimeInstallResult> {
  const result = await getInterface().puppetRuntimes.installSdk(
    runtimeId,
    project.getConfig().projectPath,
    archivePath
  );
  if (!result.success || !result.data) {
    fail(result.error ?? "The runtime could not be built");
  }
  return result.data;
}

/**
 * Load a backend directory the way the game and the editor will, and report what it registers.
 *
 * The whole point of doing this at install time is that a directory which does not yield a backend is
 * *worse* than no install: it appears in the editor's runtime list, is selected by a character, packs
 * into the game, and only fails at the moment a puppet mounts — as an empty box with a console warning.
 * `loadPuppetBackends` is the tested reader of every module export shape a backend may use, so this is
 * the same reading rather than a second, quietly-different one.
 */
async function registeredBackendNames(project: Porject, backend: string): Promise<string[]> {
  const source = await createPuppetBackendSource(project, backend);
  // A registration sink only. Nothing mounts a `Player` against it; see `puppetModelSession` for why
  // that is sound.
  const game = new Game({ app: { debug: false } });
  const messages: string[] = [];
  const [loaded] = await loadPuppetBackends(game, [source], {
    log: (level, message) => {
      if (level !== "info") {
        messages.push(message);
      }
    }
  });
  if (!loaded.ok) {
    fail(loaded.error);
  }
  if (loaded.backends.length === 0) {
    fail(
      messages[0] ??
        `${PUPPET_RUNTIME_ENTRY_FILE} loaded but registered no puppet backend. It has to export a ` +
          "backend object, or a factory returning one, with a name and a mount(container, ctx) method."
    );
  }
  return loaded.backends;
}

export type PrebuiltInstallResult = {
  /** The directory the runtime ended up in — which is the name a character must refer to. */
  backend: string;
  /** Everything the module registered. The first is {@link backend}; the rest are extras it also offers. */
  registered: string[];
  /** Set when the folder had to be renamed to match what the module actually registers. */
  renamedFrom?: string;
};

/**
 * File a prebuilt adapter into the project, and refuse to leave a broken one behind.
 *
 * A zip is not accepted. Unpacking one would have to happen in the host, and the realistic source of a
 * prebuilt adapter is the author's own build output — a `dist` directory or a single bundled file —
 * because there is nowhere legitimate to download one from for either runtime Studio names.
 *
 * Copy first, then load, because loading needs a URL the workspace window may read and the tested
 * loader takes one built from a path inside the project. A failed load rolls the copy back.
 *
 * **The folder is then renamed to the backend the module actually registers.** That is not tidiness:
 * the editor lists *directories* while the engine resolves *registered names*, so a mismatch produces a
 * character pointing at a backend nothing answers to — an empty box on stage, with the runtime looking
 * correctly installed everywhere the author can see.
 */
export async function installPrebuiltPuppetRuntime(
  project: Porject,
  requestedBackend: string,
  source: PrebuiltPuppetRuntimeSource
): Promise<PrebuiltInstallResult> {
  const backend = requestedBackend.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(backend)) {
    fail(
      `"${requestedBackend}" cannot be a runtime folder name. Use letters, digits, dots, dashes or underscores.`
    );
  }

  const target = runtimeDir(project, backend);
  const existed = await required(
    appPrivilegedFacade.fs.isDirExists(target),
    "check the runtime directory"
  );
  if (existed) {
    fail(
      `A runtime called "${backend}" is already installed. Remove it first, or install under another name.`
    );
  }

  if (source.kind === "directory") {
    const entries = await required(appPrivilegedFacade.fs.list(source.path), "read that folder");
    if (
      !entries.some(
        (entry) => entry.type !== "directory" && entry.fileName === PUPPET_RUNTIME_ENTRY_FILE
      )
    ) {
      fail(
        `That folder has no ${PUPPET_RUNTIME_ENTRY_FILE}. A puppet runtime is a folder whose ` +
          `${PUPPET_RUNTIME_ENTRY_FILE} exports the backend; pick the folder that contains it.`
      );
    }
    await required(
      appPrivilegedFacade.fs.copyDir(source.path, target),
      "copy that folder into the project"
    );
  } else {
    await required(appPrivilegedFacade.fs.createDir(target), "create the runtime directory");
    await required(
      appPrivilegedFacade.fs.copyFile(source.path, `${target}/${PUPPET_RUNTIME_ENTRY_FILE}`),
      "copy that file into the project"
    );
  }

  let registered: string[];
  try {
    registered = await registeredBackendNames(project, backend);
  } catch (error) {
    // Rolled back so the author is left where they started rather than with a directory that looks
    // installed and cannot draw.
    await appPrivilegedFacade.fs.deleteDir(target).catch(() => undefined);
    throw error;
  }

  if (registered.includes(backend)) {
    return { backend, registered };
  }
  const actual = registered[0];
  const renamed = runtimeDir(project, actual);
  if (await required(appPrivilegedFacade.fs.isDirExists(renamed), "check the runtime directory")) {
    fail(
      `That module registers its backend as "${actual}", and a runtime by that name is already ` +
        "installed. Remove that one first."
    );
  }
  await required(
    appPrivilegedFacade.fs.rename(target, actual, true),
    `name the runtime "${actual}"`
  );
  return { backend: actual, registered, renamedFrom: backend };
}

/** Remove an installed runtime. Characters referring to it keep their backend name, which is the honest outcome. */
export async function removePuppetRuntime(project: Porject, backend: string): Promise<void> {
  await required(
    appPrivilegedFacade.fs.deleteDir(runtimeDir(project, backend)),
    `remove the "${backend}" runtime`
  );
}
