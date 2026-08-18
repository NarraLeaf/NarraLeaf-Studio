import type { AppTagReachableScenes } from "@shared/types/appTag";
import type { LocaleCode } from "@shared/i18n";
import type { DevModeBundle } from "@shared/types/devMode";
import type { PluginRuntimeCapability } from "@shared/types/pluginPermissions";

/**
 * Abstraction for where Dev Mode loads UI assets from.
 * Current implementation: disk (`assembleDevModeBundleFromProjectPath`).
 * Future: live snapshot from Workspace via IPC.
 */
export interface DevModeBundleSource {
  readonly kind: string;
  load(context: DevModeBundleLoadContext): Promise<DevModeBundle>;
}

export type DevModeBundleLoadContext = {
  projectPath: string;
  bundleId: string;
  revision: number;
  /**
   * The build variant these bytes are being produced as.
   *
   * Absent is the release variant, which is what Dev Mode and Preview pass: there is no variant to
   * pick when nothing is being packaged. Both halves decide bytes: the *name* is what `AppTag`
   * folds to (`@shared/story/appTagFold`), so it must be the variant list's own spelling, and the
   * *id* is what a `/cut` row names, so it decides where this edition's story ends.
   */
  appTag?: { id: string; name: string };
  /**
   * These bytes are going into a package a player will get.
   *
   * The split this draws is between *folding* a variant and *planning what a package leaves out*.
   * Folding decides what the graphs and the story say, and every host wants it: an author who runs
   * Dev Mode as the demo is asking to see the demo's cut points and the demo's branches. Planning
   * a scene drop decides which scenes never reach a player, and only a build has a player to keep
   * anything from - Dev Mode ships nothing, so the plan would decide nothing while its refusals,
   * which are phrased for a build and stop an assembly dead, would decide everything.
   *
   * So this gates the drop and the refusal, not the fold. Absent is "nothing is being packaged",
   * which is what Dev Mode, the preview and a test run mean.
   */
  packaging?: boolean;
  /**
   * The third-party runtime code this pack ships, and what each piece of it declared it may do.
   *
   * Only the declarations are read, and only to ask whether a plugin can start a story. This was
   * "does the pack carry any plugin at all", which decided nothing: the built-in Gallery ships in
   * every package, so every project had a plugin and no project could ever drop a scene. See
   * `STORY_STARTING_RUNTIME_CAPABILITIES`, which also states the gap this leaves open and why
   * refusing every plugin would not close it. Absent is "no plugins", which is what Dev Mode and
   * Preview mean.
   */
  runtimePlugins?: readonly {
    id: string;
    name: string;
    runtimeCapabilities: readonly PluginRuntimeCapability[];
  }[];
  /**
   * What the author says each mechanism the build cannot read can start, already resolved for
   * {@link appTag} - the project's own declarations with this variant's own replacing them.
   *
   * This is what turns a refusal into an answer. Without it a wired `Start Story` node, a
   * TypeScript blueprint or a story-starting plugin means the whole story ships, and the author has
   * no way to say otherwise. Absent is "nothing declared".
   */
  declaredScenes?: AppTagReachableScenes;
  /**
   * The language a failure this assembly reports is written in.
   *
   * Only the blueprint variant refusal uses it, and only a build ever supplies it: Dev Mode and the
   * preview never refuse, because neither of them packages anything. Absent falls back to English.
   */
  locale?: LocaleCode;
  /**
   * Reports a decision the author has to be told about - today, a story shipped whole because the
   * project can reach a scene by a name no static read resolves. Plain English, like every other
   * line the main process puts in the build console. Absent drops the line, which is what Dev Mode
   * and Preview want: neither drops a scene, so neither has anything to report.
   */
  onNotice?: (message: string) => void;
  compiled?: Record<string, unknown>;
  blueprintCompiledScripts?: Record<string, string>;
  blueprintScriptsCompileOk?: boolean;
  blueprintScriptsCompileErrors?: string[];
};
