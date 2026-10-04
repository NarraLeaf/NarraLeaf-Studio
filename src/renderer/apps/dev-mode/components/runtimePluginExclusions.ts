/**
 * Which of the plugins a Dev Mode session leaves out are worth a word to the author.
 *
 * The session runs the plugins the project's dependency table names - the same set a build carries
 * (`selectProjectRuntimePlugins`) - so every other enabled plugin is left out, and the main process
 * says so for each of them. Most of those are simply plugins this project has nothing to do with: a
 * new project made from a template does not use Quick Save, and Quick Save ships switched on. Telling
 * the author about one of those is a warning about a fix they cannot make - there is nothing to add
 * to the table, a rescan finds nothing, and the banner stays.
 *
 * What the report exists for is the case where the author does lose something: they placed one of
 * the plugin's nodes or widgets, or wrote one of its story rows, and the table does not carry it yet,
 * so the node draws as an unknown-node stub and the row does nothing. That is read off the bundle the
 * session is running, with the same reading the dependency scan makes of the editor's documents, so
 * "the project uses it" means the same thing on both sides.
 *
 * A plugin the table does name and that still cannot run (`unusable`) is always reported: the table
 * only names a plugin something in the project refers to.
 */

import {
    collectBlueprintDocumentUsage,
    collectInterfaceDocumentUsage,
    collectStoryDocumentUsage,
    type TypeOwnership,
} from "@/lib/plugins/projectPluginUsage";
import type { DevModeBundle } from "@shared/types/devMode";
import type { RuntimePluginExclusion } from "@shared/types/plugins";

/** The documents of a bundle a plugin can be referred to from. */
export type PluginReferenceSources = {
    ui: Pick<DevModeBundle["ui"], "uidoc" | "localBlueprints">;
    story?: DevModeBundle["story"];
    storyLibrary?: Pick<NonNullable<DevModeBundle["storyLibrary"]>, "documents">;
};

/**
 * The ids, among `candidatePluginIds`, of the plugins something in the bundle refers to.
 *
 * Node and widget types are attributed by their names alone, longest id first (see
 * `attributeByNamespace`): a session has no registry entry for a plugin it left out, and every type a
 * plugin contributes is namespaced under its id, so the name is the whole answer. The candidates
 * should include the plugins the session does run as well as the ones it left out, so that a type of
 * `acme.fx.pro` is not credited to an excluded `acme.fx`.
 */
export function pluginsReferencedByBundle(
    bundle: PluginReferenceSources,
    candidatePluginIds: Iterable<string>,
): Set<string> {
    const candidates = [...candidatePluginIds];
    const byName: TypeOwnership = {
        ownerOf: () => undefined,
        isRegistered: () => false,
        candidatePluginIds: candidates,
    };
    const stories = new Set(Object.values(bundle.storyLibrary?.documents ?? {}));
    if (bundle.story) {
        stories.add(bundle.story);
    }
    const usage = [
        ...collectBlueprintDocumentUsage(bundle.ui.localBlueprints, byName),
        ...collectInterfaceDocumentUsage(bundle.ui.uidoc, byName),
        ...[...stories].flatMap(document => collectStoryDocumentUsage(document)),
    ];
    return new Set(usage.map(record => record.pluginId));
}

/**
 * The exclusions to report: every `unusable` one, and a `notDeclared` one only when the bundle refers
 * to the plugin.
 */
export function reportableRuntimePluginExclusions(input: {
    excluded: readonly RuntimePluginExclusion[];
    /** The plugins this session runs, for attributing a type to the right one of two nested ids. */
    runningPluginIds: readonly string[];
    bundle: PluginReferenceSources;
}): RuntimePluginExclusion[] {
    const { excluded, runningPluginIds, bundle } = input;
    if (!excluded.some(entry => entry.reason === "notDeclared")) {
        return [...excluded];
    }
    const referenced = pluginsReferencedByBundle(bundle, [
        ...excluded.map(entry => entry.pluginId),
        ...runningPluginIds,
    ]);
    return excluded.filter(entry => entry.reason === "unusable" || referenced.has(entry.pluginId));
}
