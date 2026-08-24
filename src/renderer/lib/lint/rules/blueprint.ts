import type { TranslationKey } from "@shared/i18n/catalog";
import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    isBlueprintEventDispatchHeadType,
    isStoryActionCallHeadType,
} from "@shared/types/blueprint/graph";
import type { BlueprintNodeEditorCatalogEntry } from "../../ui-editor/blueprint-nodes/types";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import {
    collectProjectElementIds,
    listBlueprintElementRefSites,
} from "../../workspace/services/ui-editor/blueprint/elementRefSites";
import {
    collectExecReachableNodeIds,
    listBlueprintFnCallSites,
    resolveBlueprintFnCallTarget,
} from "../../workspace/services/ui-editor/blueprint/fnCatalog";
import { listStoryEndings } from "@shared/types/story";
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
 * to whoever renders the report, not to a rule running inside a build). It also needs state only an
 * open editor has - the widget element behind a `widgetMain` blueprint, the runtime event catalogue,
 * the variable registry - and run without those it would report a healthy project by the dozen. The
 * two therefore overlap in spirit and not in code, and this file stays narrow on purpose: only
 * defects that (a) the editor cannot see because they are about something outside the blueprint, or
 * (b) are worth finding without opening every graph one at a time.
 *
 * Where a rule here asks a question the validator also asks, it calls **the same function the
 * validator calls** rather than the validator (`blueprint/fn-target-missing` and
 * `resolveBlueprintFnCallTarget` are the case to copy). Sharing the judgement and not the prose is
 * the only arrangement in which the canvas and the report cannot disagree about one node.
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
type BlueprintReferenceKind =
    | "surface" | "story" | "scene" | "choice" | "ending" | "character" | "textKey" | "dlc";

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
    storyEndings: "ending",
    characters: "character",
    localizationKeys: "textKey",
    // A DLC an author deleted leaves every `Is DLC Installed` that named it answering false
    // forever, so the entrance behind it is never drawn again and nothing else says why.
    dlc: "dlc",
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
    // Not checked *by this rule*: resolving a fn ref takes the calling blueprint's owner, which the
    // option-source sweep above does not have, and the answer is not a set membership test.
    // `blueprint/fn-target-missing` below asks it properly, through the same resolver the graph
    // editor uses for `fn.call_target_not_found`.
    "callableFns",
    // Scoped to the component that owns the blueprint, not to the project.
    "componentParams",
    // Scoped to one surface's element tree, not to the project - so the option list a node is
    // filled from cannot answer whether a value in it is still good. `blueprint/element-ref-missing`
    // below asks the question the other way round, against every element the project has, which is
    // the only form of it that does not report a graph binding to a widget on another page.
    "elements",
    // `AudioTrackService.resolveTrack` falls back to a channel, so a stale track id moves a sound
    // onto another bus rather than breaking it. That is a quieter problem than this rule's other
    // members and does not belong at their severity.
    "audioTracks",
    // Scoped to whichever list the node targets, not to the project: a field id is only meaningful
    // against one shape, and the set of all shapes would call every id in the project valid.
    // `ui/list-item-field-missing` asks the question against the right shape.
    "listItemFields",
]);

const REFERENCE_MESSAGE_KEY: Readonly<Record<BlueprintReferenceKind, TranslationKey>> = {
    surface: "lint.rule.blueprintReferenceMissing.messageSurface" as TranslationKey,
    story: "lint.rule.blueprintReferenceMissing.messageStory" as TranslationKey,
    scene: "lint.rule.blueprintReferenceMissing.messageScene" as TranslationKey,
    choice: "lint.rule.blueprintReferenceMissing.messageChoice" as TranslationKey,
    ending: "lint.rule.blueprintReferenceMissing.messageEnding" as TranslationKey,
    character: "lint.rule.blueprintReferenceMissing.messageCharacter" as TranslationKey,
    textKey: "lint.rule.blueprintReferenceMissing.messageTextKey" as TranslationKey,
    dlc: "lint.rule.blueprintReferenceMissing.messageDlc" as TranslationKey,
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
        // Always present, unlike the documents below: the registry is absent-is-empty by
        // construction, so "this project ships no DLC" and "the list could not be read" are not two
        // states this can be in.
        dlc: new Set(ctx.dlcs.map(dlc => dlc.id)),
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
        const endings = new Set<string>();
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
            // Through the scan rather than the block table, so an ending inside a disabled container
            // is absent here exactly as it is absent from the build - a node pointing at one asks a
            // question no playthrough can ever answer yes to.
            for (const ending of listStoryEndings(entry.document)) {
                endings.add(ending.endingId);
            }
        }
        universe.story = stories;
        universe.scene = scenes;
        universe.choice = choices;
        universe.ending = endings;
    }
    if (ctx.localizationKeys) {
        // Only the names here: this rule asks whether a key exists, never what it says.
        universe.textKey = new Set(ctx.localizationKeys.keys());
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
// blueprint/element-ref-missing
// ---------------------------------------------------------------------------

/**
 * A graph bound to a widget the project does not have.
 *
 * Three node types write a widget down: the element literal and the two element event heads. A
 * binding whose element is gone does nothing at all and says nothing about it - an `On Element
 * Click` head that will never fire, a `Get Element` that throws the first time it runs - and the
 * canvas draws the graph exactly as it draws a working one.
 *
 * It arises two ways and the report is the same for both: a widget deleted while graphs still named
 * it, and a fragment copied out of another project, where every element id is a UUID that project
 * minted (`graphForeignPaste`). The id is kept rather than blanked, so the author is left with the
 * one fact that fixes it.
 *
 * **The universe is every element the project has, not the ones on any single page.** A widget id is
 * unique across the document, and the two narrower questions are both wrong here: the option list a
 * node's picker is filled from holds one surface's elements, so a graph legitimately naming a widget
 * on another page would be reported, and a set built from `document.elements` alone omits every
 * component definition's own tree, so every binding inside a component's blueprint would be. Both
 * are rules that fire on correct graphs, which is worse than not asking.
 *
 * Which surface a reference names is not judged either. An element that exists under a surface id
 * that has since changed is a stale wire rather than a missing widget - a different sentence, and
 * one that would send the author looking for a widget still visible on the page.
 */
function runElementRefMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.uiDocument;
    if (!document) {
        return [];
    }
    const known = collectProjectElementIds(document);
    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        for (const { nodeId, ref } of listBlueprintElementRefSites(site.ir)) {
            if (known.has(ref.elementId)) {
                continue;
            }
            findings.push({
                ruleId: "blueprint/element-ref-missing",
                messageKey: "lint.rule.blueprintElementRefMissing.message" as TranslationKey,
                location: blueprintLocation(site, nodeId),
                target: blueprintNodeJumpTarget(site, nodeId),
            });
        }
    }
    return findings;
}

// ---------------------------------------------------------------------------
// blueprint/fn-target-missing
// ---------------------------------------------------------------------------

/**
 * A `Call Fn` whose function is not there.
 *
 * A call stores its target as `fn:<blueprintId>:<headNodeId>` and nothing else, so it survives the
 * disappearance of what it names perfectly intact: the card still draws, still carries its pins,
 * still sits in the middle of a working chain. What it does at run time is nothing. It arises the
 * two ways every dangling reference does - a function deleted while calls still named it, and a
 * fragment pasted from another project, where both halves of the ref are ids that project minted
 * (`graphForeignPaste` counts exactly these on the way in).
 *
 * **The judgement is `resolveBlueprintFnCallTarget`, which is also what the graph editor calls.**
 * That matters more here than in the sibling rules, because "resolvable" is not a set membership
 * test: a fn is visible to a caller according to the *calling* blueprint's owner, so the same ref
 * is good on one surface and dead on the next. Asking the shared resolver is what keeps this report
 * and the editor's `fn.call_target_not_found` from disagreeing about one node - the whole reason
 * the rule exists is that until now only the editor asked at all, and only for the graph it had
 * open.
 *
 * Only event graphs are swept, and nothing is lost by it: `Call Fn` declares `graphKinds:
 * ["event"]`, so an event graph is the only place one can be placed and the only place the editor
 * judges one. A call found anywhere else is a node in a context that forbids it, which is a
 * different sentence the editor already says.
 *
 * A call with no target picked is not reported. That is an unfinished node - an empty select the
 * author can see - and the editor says so in those words; this rule is about a call that names
 * something.
 */
function runFnTargetMissing(ctx: LintContext): LintFinding[] {
    const document = ctx.blueprintDocument;
    if (!document) {
        return [];
    }
    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(document)) {
        if (site.graphKind !== "event") {
            continue;
        }
        for (const call of listBlueprintFnCallSites(site.ir)) {
            if (resolveBlueprintFnCallTarget(document, call.fnRef, site.owner)) {
                continue;
            }
            // The name the card prints, never the ref: a ref is two ids, and an id in a report is a
            // word nobody can search a project for. A call stored without a snapshot has no name at
            // all, and the sentence that omits it says more than one that prints a UUID.
            findings.push({
                ruleId: "blueprint/fn-target-missing",
                messageKey: (call.name
                    ? "lint.rule.blueprintFnTargetMissing.messageNamed"
                    : "lint.rule.blueprintFnTargetMissing.message") as TranslationKey,
                ...(call.name ? { messageParams: { name: call.name } } : {}),
                location: blueprintLocation(site, call.nodeId),
                target: blueprintNodeJumpTarget(site, call.nodeId),
            });
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
// blueprint/dlc-entrance-unguarded
// ---------------------------------------------------------------------------

/**
 * A `Start Story` into a DLC's story, in a graph that never asks whether the DLC is here.
 *
 * The base build does not carry a DLC's story, so the entrance is a button that fails when a player
 * who has not bought it presses it - and the author cannot see that on their own machine, because
 * Dev Mode carries every story the project has. This is the one fault in the DLC seam that is
 * invisible from the inside.
 *
 * **Per graph, and a warning.** Guarding it somewhere else is legitimate - a menu can hide the whole
 * row before this graph ever runs - so a rule that could only see one graph must not refuse a build
 * over what it cannot see. What it can say is that nothing in reach asks the question.
 *
 * The guard is `Is DLC Installed` and deliberately not the Steam plugin's `Owns DLC`: ownership can
 * only be asked of a storefront that is running, and content gated on it disappears for an offline
 * player. See the node's own comment.
 */
function runDlcEntranceUnguarded(ctx: LintContext): LintFinding[] {
    registerCoreBlueprintNodes();
    const dlcByStory = new Map<string, string>();
    for (const story of ctx.stories) {
        if (story.dlcId) {
            dlcByStory.set(story.id, story.dlcId);
        }
    }
    if (dlcByStory.size === 0) {
        return [];
    }

    const findings: LintFinding[] = [];
    for (const site of listBlueprintGraphSites(ctx.blueprintDocument)) {
        const nodes = Object.values(site.ir.nodes ?? {});
        const guarded = new Set(
            nodes
                .filter(node => node.type === BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED)
                .map(node => String(node.params?.dlcId ?? "").trim()),
        );
        for (const node of nodes) {
            if (node.type !== BLUEPRINT_NODE_TYPE_GAME_START_STORY) {
                continue;
            }
            // The picked value only. A wired Story Id pin is a story this rule cannot name, and
            // guessing would report a graph that is fine - the same reading `planSceneDrop` takes.
            const storyId = String(node.params?.storyId ?? "").trim();
            const dlcId = storyId ? dlcByStory.get(storyId) : undefined;
            if (!dlcId || guarded.has(dlcId)) {
                continue;
            }
            findings.push({
                ruleId: "blueprint/dlc-entrance-unguarded",
                messageKey: "lint.rule.blueprintDlcEntranceUnguarded.message" as TranslationKey,
                location: {
                    kind: "blueprint",
                    blueprintId: site.blueprintId,
                    blueprintName: site.blueprintName,
                    graphId: site.graphId,
                    nodeId: node.id,
                },
                target: blueprintNodeJumpTarget(site, node.id),
            });
        }
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
        id: "blueprint/element-ref-missing",
        category: "blueprint",
        // An error, like every other dangling reference: the graph does nothing where the canvas
        // says it does something, and a build that shipped it would ship a control the player can
        // press to no effect.
        defaultSeverity: "error",
        slug: "blueprintElementRefMissing",
        run: ctx => runElementRefMissing(ctx),
    },
    {
        id: "blueprint/fn-target-missing",
        category: "blueprint",
        // The standing every other dangling reference has here. The graph editor has always called
        // this an error on the canvas; below error the report and the canvas would be saying two
        // different things about one node, and a build would ship a chain that stops halfway.
        defaultSeverity: "error",
        slug: "blueprintFnTargetMissing",
        run: ctx => runFnTargetMissing(ctx),
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
        id: "blueprint/dlc-entrance-unguarded",
        category: "blueprint",
        // A warning, not an error: the guard may legitimately be somewhere this rule cannot see.
        defaultSeverity: "warning",
        slug: "blueprintDlcEntranceUnguarded",
        run: ctx => runDlcEntranceUnguarded(ctx),
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
