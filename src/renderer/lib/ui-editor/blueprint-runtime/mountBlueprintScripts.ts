import type { DevModeBundle } from "@shared/types/devMode";
import { anchorElementId } from "@shared/blueprint/ownerShape";
import {
    scriptEventExportNamesForOwner,
    scriptEventIdsForOwner,
    scriptOwnerUsesDefaultExport,
} from "./script/scriptEventDispatch";
import {
    isScriptMounted,
    listScriptExportedFunctionNames,
    mountCompiledScripts,
    resolveScriptHandler,
} from "./script/scriptRuntime";
import type { ScriptEventId } from "./script/scriptEvents";
import { parseScriptLayerKey } from "@shared/blueprint/blueprintLayers";

/**
 * Something wrong with one script layer, in words that name the author's file.
 *
 * Reported rather than thrown: one script that will not run is one dead handler, and the rest of
 * the game still has to start.
 */
export type BlueprintScriptIssue = {
    /** The author's file, which is the only id in here they can act on. */
    scriptRef: string;
    blueprintId: string;
    message: string;
};

/**
 * Mount the script blueprints a bundle carries, replacing whatever was mounted before, and report
 * every script that will not run.
 *
 * The bundle holds each script as a URL the host wrote esbuild's output to; this turns it into a
 * module and remembers it by script-layer key, so a dispatched event can find the export it calls.
 * See `script/scriptRuntime.ts` for how one is loaded and what that does and does not isolate.
 *
 * # Why the reporting is here
 *
 * A script that does not run fails in one of three ways, and until this function reported them all
 * three looked identical on screen - nothing happened:
 *
 *  1. **It did not compile.** The compiler already wrote a diagnostic naming the file and put it in
 *     the bundle. Nothing read that field, so the message existed and was never shown.
 *  2. **It threw while loading.** That went to `console.error` and nowhere an author looks.
 *  3. **It exports nothing this slot calls** - the handler is misspelled, or spelled for a
 *     different widget. Nothing noticed at all, and this is the common one: the export names come
 *     from the head a slot admits, which is not always what the runtime calls the event.
 *
 * All three now arrive at the host's issue channel, which is what draws the Dev Mode issues list.
 */
export async function mountBlueprintCompiledScripts(
    bundle: DevModeBundle,
    onIssue?: (issue: BlueprintScriptIssue) => void,
    // Injected so a test can mount with no host serving anything, the way `mountCompiledScripts`
    // takes it. The default is the real thing: a URL, imported.
    loadModule?: (url: string) => Promise<Record<string, unknown>>,
): Promise<void> {
    const scripts = bundle.ui.scripts;

    // Reported before the mount, not after: a script that failed to compile has no module, so the
    // check below would have nothing to say about it and the author would hear nothing.
    for (const [layerKey, entry] of Object.entries(scripts ?? {})) {
        for (const diagnostic of entry?.diagnostics ?? []) {
            onIssue?.({
                scriptRef: entry.scriptRef,
                blueprintId: parseScriptLayerKey(layerKey)?.blueprintId ?? layerKey,
                message: diagnostic.message,
            });
        }
    }

    await mountCompiledScripts(
        scripts,
        (layerKey, scriptRef, message) => {
            // The author's own code, failing while it is being evaluated. Their file, their message.
            console.error(`[blueprint script] ${scriptRef} failed to load: ${message}`);
            onIssue?.({
                scriptRef,
                blueprintId: parseScriptLayerKey(layerKey)?.blueprintId ?? layerKey,
                message: `${scriptRef} could not be loaded: ${message}`,
            });
        },
        loadModule,
    );

    if (onIssue) {
        reportScriptsWithNothingToCall(bundle, onIssue);
    }
}

/**
 * Report every mounted script layer whose module exports nothing its slot will ever call.
 *
 * The message carries both halves of what the author is missing: what they exported, and what this
 * slot accepts. Naming only one of the two is what makes a misspelling hard to see - `onMouseclick`
 * and `onSliderValueChanged` on a switch are both "an export that looks right".
 */
function reportScriptsWithNothingToCall(
    bundle: DevModeBundle,
    onIssue: (issue: BlueprintScriptIssue) => void,
): void {
    const blueprints = bundle.ui.localBlueprints?.blueprints ?? {};
    for (const [layerKey, entry] of Object.entries(bundle.ui.scripts ?? {})) {
        // Only a module that is actually mounted can be asked what it exports. One that did not
        // compile, or threw on the way in, has already been reported once above - saying "it
        // exports nothing" about it as well would be two messages for one failure, and the second
        // would point at the wrong cause.
        if (typeof entry?.url !== "string" || !isScriptMounted(layerKey)) {
            continue;
        }
        const blueprintId = parseScriptLayerKey(layerKey)?.blueprintId;
        const blueprint = blueprintId ? blueprints[blueprintId] : undefined;
        if (!blueprintId || !blueprint) {
            continue;
        }
        // A story row and a value binding are entered through the default export, and neither is
        // entered from here - a row goes through the story compiler, which reports its own failures
        // against the block, which is a place an author can open. Saying anything about them here
        // would be a second message with a worse location.
        if (scriptOwnerUsesDefaultExport(blueprint.owner)) {
            continue;
        }
        const elementId = anchorElementId(blueprint.owner);
        const widgetType = elementId ? bundle.ui.uidoc?.elements?.[elementId]?.type : undefined;
        const accepted = scriptEventIdsForOwner(blueprint.owner, widgetType);
        if (accepted.length === 0) {
            continue;
        }
        const called = accepted.filter((eventId: ScriptEventId) => resolveScriptHandler(layerKey, eventId));
        if (called.length > 0) {
            continue;
        }
        const exported = listScriptExportedFunctionNames(layerKey);
        const names = scriptEventExportNamesForOwner(blueprint.owner, widgetType).join(", ");
        onIssue({
            scriptRef: entry.scriptRef,
            blueprintId,
            message: exported.length > 0
                ? `${entry.scriptRef} exports ${exported.join(", ")}, none of which this slot calls. It calls: ${names}.`
                : `${entry.scriptRef} exports no handler this slot calls. It calls: ${names}.`,
        });
    }
}
