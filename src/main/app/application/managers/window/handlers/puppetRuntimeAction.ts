import path from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { PuppetRuntimeInstallResult } from "@shared/types/puppetRuntime";
import {
  PUPPET_RUNTIMES_PROJECT_DIR,
  isKnownPuppetRuntimeId,
  knownPuppetRuntime
} from "@shared/utils/puppetRuntimes";
import { buildLive2DRuntime } from "../../puppet/live2dRuntimeBuild";
import { authorizeActorFileSystemRequest } from "../actorAuthorization";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/** Where Studio's own adapter sources live, in development and in a packaged build alike. */
const GLUE_RESOURCE_DIR = "puppet-glue";

/**
 * Install a named puppet runtime into a project from an SDK archive.
 *
 * The renderer cannot do this: it takes a bundler, because the Live2D adapter is compiled on the
 * author's machine out of the SDK they supplied — see `managers/puppet/live2dRuntimeBuild.ts` for why
 * no prebuilt one may be published by anyone.
 *
 * Everything the renderer says is treated as a request, not an instruction. The runtime name is looked
 * up in the registry rather than used as a path segment, the destination is derived here from the
 * project path, and that path is authorized against the window's own file-system grant — so the worst a
 * compromised renderer can do with this verb is rebuild a runtime in a project it could already write
 * to.
 */
export class PuppetRuntimeInstallSdkHandler extends IPCHandler<IPCEventType.puppetRuntimeInstallSdk> {
  readonly name = IPCEventType.puppetRuntimeInstallSdk;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { runtimeId, projectPath, archivePath }: IPCEvents[IPCEventType.puppetRuntimeInstallSdk]["data"]
  ): Promise<RequestStatus<PuppetRuntimeInstallResult>> {
    if (!isKnownPuppetRuntimeId(runtimeId)) {
      return this.failed(`Unknown puppet runtime: ${runtimeId}`);
    }
    const runtime = knownPuppetRuntime(runtimeId);
    if (!runtime.methods.includes("sdk-zip")) {
      // Not defensiveness about a typo — this is the gate that keeps Studio from building an
      // adapter for a runtime it is not licensed to integrate with. Spine is `prebuilt` only.
      return this.failed(`${runtime.productName} is not installed from an SDK archive`);
    }
    if (!projectPath?.trim() || !archivePath?.trim()) {
      return this.failed("A project and an SDK archive are both required");
    }

    const targetDir = path.join(projectPath, ...PUPPET_RUNTIMES_PROJECT_DIR, runtime.backend);
    for (const [candidate, mode] of [
      [targetDir, "write"],
      [archivePath, "read"]
    ] as const) {
      const authorization = await authorizeActorFileSystemRequest(
        window,
        { kind: "facade", id: "default" },
        candidate,
        mode
      );
      if (!authorization.allowed) {
        return this.failed(authorization.reason ?? `Not allowed to ${mode} ${candidate}`);
      }
    }

    const app = window.getApp();
    try {
      const built = await buildLive2DRuntime({
        archivePath,
        targetDir,
        userDataDir: app.getUserDataDir(),
        // The same path in development and in a packaged build: `resolveResource` already
        // resolves to `<root>/resources` or `Resources/`, and electron-builder's
        // `extraResources` copies the whole tree.
        glueDir: app.resolveResource(path.join(GLUE_RESOURCE_DIR, runtime.id)),
        log: (level, message) => console.log(`[puppetRuntime:${runtime.id}] ${level}: ${message}`)
      });
      return this.success({
        backend: built.backend,
        sdkVersion: built.sdkVersion,
        entryPath: built.entryPath,
        bytes: built.bytes
      });
    } catch (error) {
      // Reported verbatim. Every failure here is either "you picked the wrong file" — which the
      // archive reader phrases as a recovery step — or a build error, and paraphrasing either into
      // "install failed" is what leaves an author with nothing to do next.
      return this.failed(error instanceof Error ? error.message : String(error));
    }
  }
}
