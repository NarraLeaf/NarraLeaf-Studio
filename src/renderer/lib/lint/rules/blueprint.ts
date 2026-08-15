import type { TranslationKey } from "@shared/i18n/catalog";
import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    isBlueprintEventDispatchHeadType,
    isStoryActionCallHeadType,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeEditorCatalogEntry } from "../../ui-editor/blueprint-nodes/types";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { collectExecReachableNodeIds } from "../../workspace/services/ui-editor/blueprint/fnCatalog";
import { getActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import { saveSchemaPinId } from "../../ui-editor/blueprint-nodes/effectivePins";
import { blueprintNodeJumpTarget, listBlueprintGraphSites, type BlueprintGraphSite } from "../blueprintSites";
import type { LintContext } from "../context";
import type { LintFinding, LintLocation, LintRule } from "../types";

/**
 * `blueprint` - graphs that cannot do what they say.
 *
 * The graph editor already validates the blueprint it has open, thoroughly
 * (`graphValidation.ts`, some twenty checks). What it cannot do is answer a question about the
 * *project*: an author who deletes a page never opens the four graphs that navigate to it, so a
 * dead `Go Page` is invisible in the editor, absent from the lint report, waved through by the
 * build, and finally found by a player pressing the button.
 *
 * These rules are that sweep. They are deliberately **not** a project-wide re-run of the editor's
 * validator: that validator renders its messages with `translate()` at the point it finds a
 * problem, and a lint rule may not build prose (see `LintFinding.messageKey` - the locale belongs
 * to whoever renders the report, not to a rule running inside a build). The two therefore overlap
 * in spirit and not in code, and this file stays narrow on purpose: only defects that (a) the
 * editor cannot see because they are about something outside the blueprint, or (b) are worth
 * finding without opening every graph one at a time.
 *
 * Three facts every rule here obeys:
 *
 *  - **The corpus is `listBlueprintGraphSites`**, shared with `network/fetch-disallowed` and
 *    through it with the build's network gate. A blueprint no owner record points at is dead data
 *    and is not swept; see that module for why.
 *  - **A param is only read when nothing is wired to the pin of the same name.** Half of these
 *    dropdowns sit on nodes that also expose the value as a data input (`Get Text` has both a `key`
 *    param and a `key` pin), and when the pin is connected the param is not what runs. Reporting it
 *    would be a false positive on a graph that is entirely correct.
 *  - **A rule reports the head of a broken chain, not every node in it.** An abandoned twelve-node
 *    draft is one problem; twelve warnings for it is how a lint report stops being read.
 */

// ---------------------------------------------------------------------------
// blueprint/reference-missing
// ---------------------------------------------------------------------------

/** What kind of thing a dangling id was supposed to name; picks the sentence. */
type BlueprintReferenceKind = "surface" | "story" | "scene" | "choice" | "character" | "textKey";

/**
 * Select params whose options are project entities, keyed by the `dynamicOptionsSource` the node
 * card fills them from. The source id is the node's own declaration of "these options come from the
 * project", so reading it is how this rule covers a node nobody thought about when writing it.
 */
export const REFERENCE_KIND_BY_OPTIONS_SOURCE: Readonly<Record<string, BlueprintReferenceKind>> = {
    surfaces: "surface",
    // Page targets for a Frame: the same surface ids, filtered by what the frame may show. Lint
    // only asks whether the surface still exists - "exists but is not a legal frame target" is a
    // different fault and the graph editor already reports it.
    frameTargetSurfaces: "surface",
    stories: "story",
    storyScenes: "scene",
    storyChoiceOptions: "choice",
    characters: "character",
    localizationKeys: "textKey",
};

/**
 * Option sources this rule knowingly does not check, each for a reason.
 *
 * Exported and asserted against the built-in node catalogue by `blueprint.test.ts`: a node added
 * later with a source that is in neither table fails that test rather than being silently skipped.
 * A reference check that quietly covers less than it looks like it covers is the worst outcome
 * available here - it reports zero findings and reads as a clean project.
 */
export const UNCHECKED_OPTIONS_SOURCES: ReadonlySet<string> = new Set([
    // Resolved against fn visibility rules that depend on the calling blueprint's owner; the graph
    // editor reports an unresolvable call as `fn.call_target_not_found` with that context in hand.
    "callableFns",
    // Scoped to the component that owns the blueprint, not to the project.
    "componentParams",
    // Scoped to one surface's element tree, not to the project.
    "elements",
    // `AudioTrackService.resolveTrack` falls back to a channel, so a stale track id moves a sound
    // onto another bus rather than breaking it. That is a quieter problem than this rule's other
    // members and does not belong at their severity.
    "audioTracks",
]);

const REFERENCE_MESSAGE_KEY: Readonly<Record<BlueprintReferenceKind, TranslationKey>> = {
    surface: "lint.rule.blueprintReferenceMissing.messageSurface" as TranslationKey,
    story: "lint.rule.blueprintReferenceMissing.messageStory" as TranslationKey,
    scene: "lint.rule.blueprintReferenceMissing.messageScene" as TranslationKey,
    choice: "lint.rule.blueprintReferenceMissing.messageChoice" as TranslationKey,
    character: "lint.rule.blueprintReferenceMissing.messageCharacter" as TranslationKey,
    textKey: "lint.rule.blueprintReferenceMissing.messageTextKey" as TranslationKey,
};

/**
 * The ids a reference of each kind may resolve against.
 *
 * A kind is **absent** rather than empty when the project could not be read for it: an empty set
 * would make every reference of that kind dangling, which is how a rule turns one unreadable
 * document into a hundred findings against graphs that are fine. `storiesComplete` carries the same
 * distinction for stories that `assetIndex.complete` carries for assets, and for the same reason.
 */
type BlueprintReferenceUniverse = Partial<Record<BlueprintReferenceKind, ReadonlySet<string>>>;

function buildReferenceUniverse(ctx: LintContext): BlueprintReferenceUniverse {
    const universe: BlueprintReferenceUniverse = {
        character: new Set(ctx.characters.map(character => character.id)),
    };
    if (ctx.uiDocument) {
        universe.surface = new Set(
            ctx.uiDocument.surfaces.filter(surface => surface.kind === "appSurface").map(surface => surface.id),
        );
    }
    if (ctx.storiesComplete) {
        const stories = new Set<string>();
        const scenes = new Set<string>();
        const choices = new Set<string>();
        for (const entry of ctx.stories) {
            stories.add(entry.id);
            for (const scene of Object.values(entry.document.scenes)) {
                if (!scene) {
                    continue;
                }
                scenes.add(scene.id);
                for (const block of Object.values(scene.blocks)) {
                    // The same identity the Story -> Scene -> Option picker writes: an option's row
                    // id, so rewriting the option's text does not unpoint a graph.
                    if (block?.kind === "nodeAction" && block.payload.action === "choiceOption") {
                        choices.add(block.id);
                    }
                }
            }
        }
        universe.story = stories;
        universe.scene = scenes;
        universe.choice = choices;
    }
    if (ctx.localizationKeyNames) {
        universe.textKey = ctx.localizationKeyNames;
    }
    return universe;
}

/** Ports on each node that an edge terminates at - a wired pin overrides the param beside it. */
function collectWiredInputPorts(ir: BlueprintGraphIr): ReadonlyMap<string, ReadonlySet<string>> {
    const wired = new Map<string, Set<string>>();
    for (const edge of ir.edges ?? []) {
        const ports = wired.get(edge.to.nodeId) ?? new Set<string>();
        ports.add(edge.to.port);
        wired.set(edge.to.nodeId, ports);
    }
    return wired;
}

function catalogEntry(node: BlueprintGraphNode): BlueprintNodeEditorCatalogEntry {
    return blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params);
}

function blueprintLocation(site: BlueprintGraphSite, nodeId: string): LintLocation {
    return {
        kind: "blueprint",
        blueprintId: site.blueprintId,
        blueprintName: site.blueprintName,
        graphId: site.graphId,
        nodeId,
    };
}

function runReferenceMissing(ctx: LintContext): LintFinding[] {
    registerCoreBlueprintNodes();
    const universe = buildReferenceUniverse(ctx);
    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        const wired = collectWiredInputPorts(site.ir);
        for (const node of Object.values(site.ir.nodes ?? {})) {
            for (const param of catalogEntry(node).inspectorParams ?? []) {
                const source = param.dynamicOptionsSource;
                const kind = source ? REFERENCE_KIND_BY_OPTIONS_SOURCE[source] : undefined;
                const known = kind ? universe[kind] : undefined;
                if (!kind || !known || wired.get(node.id)?.has(param.key)) {
                    continue;
                }
                // An unset dropdown is an unfinished node, not a broken reference: it is visible in
                // the editor as an empty select, and the node reports it at run time in its own
                // words. Only a value that names something is judged against what exists.
                const value = String(node.params?.[param.key] ?? "").trim();
                if (!value || known.has(value)) {
                    continue;
                }
                findings.push({
                    ruleId: "blueprint/reference-missing",
                    messageKey: REFERENCE_MESSAGE_KEY[kind],
                    location: blueprintLocation(site, node.id),
                    target: blueprintNodeJumpTarget(site, node.id),
                });
            }
        }
    }
    return findings;
}

// ---------------------------------------------------------------------------
// blueprint/unreachable-node and blueprint/empty-event
// ---------------------------------------------------------------------------

/**
 * A node execution can start at: an event head, a Story Action "On Call" head, an Fn head, or a
 * function graph's entry.
 *
 * The same set the graph editor uses to decide whether a graph has a head at all, deliberately: two
 * answers to "where does this graph start" would put a warning on graphs the editor calls complete.
 */
function isGraphEntryNode(node: BlueprintGraphNode): boolean {
    return (
        isBlueprintEventDispatchHeadType(node.type) ||
        isStoryActionCallHeadType(node.type) ||
        node.type === BLUEPRINT_NODE_TYPE_FN_HEAD ||
        node.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY
    );
}

function execPortIds(entry: BlueprintNodeEditorCatalogEntry, kind: "input" | "output"): ReadonlySet<string> {
    return new Set(entry.pins.filter(pin => pin.kind === kind && pin.semantic === "exec").map(pin => pin.id));
}

function hasOutgoingExecEdge(ir: BlueprintGraphIr, node: BlueprintGraphNode): boolean {
    const outputs = execPortIds(catalogEntry(node), "output");
    return (ir.edges ?? []).some(edge => edge.from.nodeId === node.id && outputs.has(edge.from.port));
}

/**
 * Nodes that never run: no entry point in their own graph reaches them along exec edges.
 *
 * Only nodes with an exec input are candidates. A pure data node is not supposed to be exec-reachable
 * - it is pulled by whoever reads its output - so treating one as unreachable would report every
 * literal and every getter in the project.
 *
 * Only the head of an unreachable chain is reported: a node with an incoming exec edge from another
 * unreachable node is a consequence of that one, not a separate problem. A closed cycle of
 * unreachable nodes therefore reports nothing, which is a deliberate trade - it takes a loop wired
 * back into itself with no way in, and the alternative is a rule that reports the same abandoned
 * draft a dozen times.
 */
function runUnreachableNode(ctx: LintContext): LintFinding[] {
    registerCoreBlueprintNodes();
    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        // Macros have no defined entry point (nothing populates the record yet, and whoever makes
        // them real decides what starts one), so "unreachable" has no meaning in one.
        if (site.graphKind === "macro") {
            continue;
        }
        const nodes = site.ir.nodes ?? {};
        const entries = Object.values(nodes).filter(isGraphEntryNode);
        // A graph with no entry point at all does not run *anything*; calling each of its nodes
        // unreachable would say the one problem once per node. The graph editor reports the graph.
        if (entries.length === 0) {
            continue;
        }
        const reachable = new Set<string>();
        for (const entry of entries) {
            for (const nodeId of collectExecReachableNodeIds(site.ir, entry.id)) {
                reachable.add(nodeId);
            }
        }
        for (const node of Object.values(nodes)) {
            if (reachable.has(node.id)) {
                continue;
            }
            const entry = catalogEntry(node);
            if (entry.role === "comment") {
                continue;
            }
            const execInputs = execPortIds(entry, "input");
            if (execInputs.size === 0) {
                continue;
            }
            const fedByAnotherUnreachableNode = (site.ir.edges ?? []).some(
                edge =>
                    edge.to.nodeId === node.id &&
                    execInputs.has(edge.to.port) &&
                    nodes[edge.from.nodeId] !== undefined &&
                    !reachable.has(edge.from.nodeId),
            );
            if (fedByAnotherUnreachableNode) {
                continue;
            }
            findings.push({
                ruleId: "blueprint/unreachable-node",
                messageKey: "lint.rule.blueprintUnreachableNode.message" as TranslationKey,
                location: blueprintLocation(site, node.id),
                target: blueprintNodeJumpTarget(site, node.id),
            });
        }
    }
    return findings;
}

/**
 * An event layer that exists and does nothing - no nodes, or a head with nothing wired to its exec
 * output.
 *
 * Event layers are not created for you: a new blueprint has none, and one exists because an author
 * made it. That is what keeps this from firing across a healthy project, and it is why the finding
 * is worth an `info` - somebody wired a button to a handler and then left the handler empty.
 *
 * A graph with nodes but no head is left alone. It is a different sentence ("nothing can start
 * this") and the graph editor already says it in those words.
 */
function runEmptyEvent(ctx: LintContext): LintFinding[] {
    registerCoreBlueprintNodes();
    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        if (site.graphKind !== "event") {
            continue;
        }
        const nodes = Object.values(site.ir.nodes ?? {});
        const entries = nodes.filter(isGraphEntryNode);
        const runsNothing =
            nodes.length === 0 ||
            (entries.length > 0 && !entries.some(entry => hasOutgoingExecEdge(site.ir, entry)));
        if (!runsNothing) {
            continue;
        }
        findings.push({
            ruleId: "blueprint/empty-event",
            messageKey: "lint.rule.blueprintEmptyEvent.message" as TranslationKey,
            location: {
                kind: "blueprint",
                blueprintId: site.blueprintId,
                blueprintName: site.blueprintName,
                graphId: site.graphId,
            },
            target: entries[0] ? blueprintNodeJumpTarget(site, entries[0].id) : undefined,
        });
    }
    return findings;
}

// ---------------------------------------------------------------------------
// blueprint/save-field-empty
// ---------------------------------------------------------------------------

/**
 * A `Save Game` that will run with a declared save field left empty.
 *
 * The read side is what makes this an error rather than a hint. `Get Save Metadata` publishes every
 * declared field as an output that always has a value, and a save screen is built on that promise.
 * A write that skipped a pin does not break at the write - it breaks weeks later, on a player's
 * machine, as a slot whose chapter name is the default instead of the chapter they were in. Nothing
 * at runtime can tell that apart from a save legitimately written before the field existed.
 *
 * A pin counts as filled when an edge feeds it or the card carries a value for it. An empty inline
 * literal counts: an author who typed nothing into a string field chose the empty string, and a rule
 * that argued with that would fire on a save slot deliberately left unnamed.
 *
 * Only nodes that will actually run are reported. In a graph with entry points that means
 * exec-reachable; in one without - a macro, whose entry is whoever invokes it - it means something
 * is wired into its exec input. An abandoned draft with nothing leading to it is already
 * `blueprint/unreachable-node`, and saying it twice helps nobody.
 */
function runSaveFieldEmpty(ctx: LintContext): LintFinding[] {
    registerCoreBlueprintNodes();
    const fields = getActiveSaveSchemaFields();
    if (fields.length === 0) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        const nodes = site.ir.nodes ?? {};
        const saveNodes = Object.values(nodes).filter(node => node.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE);
        if (saveNodes.length === 0) {
            continue;
        }
        const entries = Object.values(nodes).filter(isGraphEntryNode);
        const reachable = new Set<string>();
        for (const entry of entries) {
            for (const nodeId of collectExecReachableNodeIds(site.ir, entry.id)) {
                reachable.add(nodeId);
            }
        }
        for (const node of saveNodes) {
            const willRun = entries.length > 0
                ? reachable.has(node.id)
                : (site.ir.edges ?? []).some(edge => edge.to.nodeId === node.id && edge.to.port === "in");
            if (!willRun) {
                continue;
            }
            const params = node.params ?? {};
            for (const field of fields) {
                const pinId = saveSchemaPinId(field.id);
                const wired = (site.ir.edges ?? []).some(
                    edge => edge.to.nodeId === node.id && edge.to.port === pinId,
                );
                if (wired || Object.prototype.hasOwnProperty.call(params, pinId)) {
                    continue;
                }
                findings.push({
                    ruleId: "blueprint/save-field-empty",
                    messageKey: "lint.rule.blueprintSaveFieldEmpty.message" as TranslationKey,
                    messageParams: { field: field.name },
                    location: blueprintLocation(site, node.id),
                    target: blueprintNodeJumpTarget(site, node.id),
                });
            }
        }
    }
    return findings;
}

export const BLUEPRINT_LINT_RULES: readonly LintRule[] = [
    {
        id: "blueprint/reference-missing",
        category: "blueprint",
        // The same standing as `story/jump-missing`, and for the same reason: the route named in
        // the graph is not there, so pressing the thing that runs it is a dead end in the shipped
        // game. An error is what makes the build refuse it.
        defaultSeverity: "error",
        slug: "blueprintReferenceMissing",
        run: ctx => runReferenceMissing(ctx),
    },
    {
        id: "blueprint/unreachable-node",
        category: "blueprint",
        defaultSeverity: "warning",
        slug: "blueprintUnreachableNode",
        run: ctx => runUnreachableNode(ctx),
    },
    {
        id: "blueprint/empty-event",
        category: "blueprint",
        defaultSeverity: "info",
        slug: "blueprintEmptyEvent",
        run: ctx => runEmptyEvent(ctx),
    },
    {
        id: "blueprint/save-field-empty",
        category: "blueprint",
        // An error, and the only severity that makes the read side honest: every declared field is
        // published as an output that always has a value, so a write that skipped one ships a save
        // nothing can tell from a legitimately older one.
        defaultSeverity: "error",
        slug: "blueprintSaveFieldEmpty",
        run: ctx => runSaveFieldEmpty(ctx),
    },
];
