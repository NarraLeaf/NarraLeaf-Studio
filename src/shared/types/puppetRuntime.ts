/**
 * What crosses the process boundary when a puppet runtime is installed.
 *
 * The install itself lives in the main process because it needs a bundler: the Live2D adapter has to be
 * compiled on the author's machine from the SDK they supplied, since nobody may publish a prebuilt one
 * (see `managers/puppet/live2dRuntimeBuild.ts`). This is the report that comes back.
 */

/** What the author gets told after a successful install. Everything here is shown, not acted on. */
export type PuppetRuntimeInstallResult = {
  /** The backend name now installed — also the directory under the project's `runtimes/puppet/`. */
  backend: string;
  /**
   * The SDK version the archive stated, when it stated one. Worth surfacing because the produced
   * module is opaque afterwards: nothing in the project records which SDK it came from except the
   * README written beside it.
   */
  sdkVersion: string | null;
  /** Absolute path of the written entry file, so the author can find what was added to their project. */
  entryPath: string;
  bytes: number;
};
