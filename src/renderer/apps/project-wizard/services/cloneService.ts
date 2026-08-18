import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { parseVcsRemoteUrl } from "@shared/types/vcs";
import { isStudioProject } from "./projectVerification";

/**
 * What a clone ended as.
 *
 * `notAProject` is deliberately NOT folded into `failed`: the transfer worked, the files are on
 * disk, and the author's next move is different in each case. One is "try again"; the other is
 * "this address is not the project you were looking for, and there is now a folder of somebody
 * else's repository where you pointed it".
 */
export type CloneOutcome =
  | { status: "cloned"; root: string; fileCount: number }
  | { status: "notAProject"; root: string }
  | { status: "failed"; error: string };

/**
 * Getting a project off a version-control server.
 *
 * The whole thing is one call to the main process and one check on what came back. There is no
 * progress to report while it runs: the backend collects its per-fragment events and delivers
 * them when the call finishes, so anything drawn from them would be a bar that sits at zero and
 * then vanishes - which reads as broken in exactly the case (a big project, a slow link) where
 * the author most needs to believe it is working.
 */
export class CloneService {
  /**
   * Copy the repository at `url` into `destination`, then decide whether Studio can open it.
   *
   * **The verification is the point of this method** - see {@link isStudioProject} for what a
   * server can hand over that is not a project and why that has to be caught here rather than
   * by whatever opens the folder next.
   *
   * **Nothing is deleted on a bad verdict.** Those bytes came off someone's server and Studio
   * is the wrong judge of whether they matter; the destination is reported instead, so the
   * author can look at what arrived and decide themselves.
   */
  static async cloneProject(url: string, destination: string): Promise<CloneOutcome> {
    const address = url.trim();
    if (!parseVcsRemoteUrl(address)) {
      return { status: "failed", error: translate("wizard.source.addressInvalid") };
    }

    try {
      const cloned = await getInterface().vcs.clone(address, destination);
      if (!cloned.success) {
        return { status: "failed", error: cloned.error || translate("wizard.clone.error.generic") };
      }

      const root = cloned.data.root;
      return (await isStudioProject(root))
        ? { status: "cloned", root, fileCount: cloned.data.fileCount }
        : { status: "notAProject", root };
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }
}
