import {
  BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
  BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
  BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_TEXT,
  BLUEPRINT_NODE_TYPE_LITERAL,
  BLUEPRINT_NODE_TYPE_LITERAL_STRING
} from "@shared/types/blueprint/graph";
import {
  isNetworkAddressAllowed,
  networkAllowlistCspSources,
  type NetworkAllowlist
} from "@shared/types/networkAllowlist";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { SearchJumpTarget } from "../../workspace/services/search/searchIndexModel";
import { blueprintNodeJumpTarget, listBlueprintGraphSites } from "../blueprintSites";
import type { LintContext } from "../context";
import type { LintFinding, LintRule } from "../types";

/**
 * `network` - whether the project's blueprints ask for something its settings forbid.
 *
 * One rule, and it exists because of an asymmetry the other categories do not have: a network node
 * in a project with Allow HTTP off is not a style opinion or a probable mistake, it is code that
 * **provably cannot run**. The shipped game confines the renderer to its own protocol and cancels
 * every HTTP request (`runtime/main/networkPolicy.ts`), and the host refuses the request before it
 * is made. The node is dead, and nothing an author does at runtime revives it.
 *
 * That is why this defaults to `error` and why the build has a gate of its own rather than relying
 * on this rule. Lint is switchable - `runOnBuild` turns the sweep off and a severity can be set to
 * `off` - so it can inform an author but must not be the only thing standing between a project and
 * a build that ships dead graphs. See `BuildService.runNetworkGate`, which is unconditional for the
 * same reason the media gate is.
 */

const NETWORK_NODE_TYPES: ReadonlySet<string> = new Set([
  BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
  BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_TEXT,
  BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON
]);

/** The `url` pin id on the Fetch node. Its literal lives in `params` under the same key. */
const FETCH_URL_PIN = "url";

/**
 * The address a Fetch node will request, or null when it is only knowable at run time.
 *
 * Two shapes count as written, because they are the same authored fact: the address typed into
 * the pin (an unwired data pin reads its own `params` entry), and the address in a string
 * literal node wired to it. Anything else - a variable, a concatenation, another node's output -
 * has no value here and must not be guessed at.
 */
function writtenFetchUrl(
  ir: BlueprintGraphIr,
  node: { id: string; params?: Record<string, unknown> }
): string | null {
  const edge = ir.edges?.find(
    (item) => item.to.nodeId === node.id && item.to.port === FETCH_URL_PIN
  );
  if (!edge) {
    const written = String(node.params?.[FETCH_URL_PIN] ?? "").trim();
    return written || null;
  }
  const source = ir.nodes?.[edge.from.nodeId];
  if (!source || edge.from.port !== "value") {
    return null;
  }
  if (
    source.type !== BLUEPRINT_NODE_TYPE_LITERAL_STRING &&
    source.type !== BLUEPRINT_NODE_TYPE_LITERAL
  ) {
    return null;
  }
  const written = String(source.params?.value ?? "").trim();
  return written || null;
}

export type BlueprintNetworkNodeSite = {
  blueprintId: string;
  blueprintName: string;
  graphId: string;
  nodeId: string;
  nodeType: string;
  /**
   * The address a Fetch node will request, when it is knowable without running the graph.
   *
   * Null for the two read-the-response nodes, which address nothing, and for a Fetch whose
   * address is computed - a variable, a concatenation, anything that is not written down.
   * Guessing at one of those would produce findings against a string never requested, so
   * they are decided at run time instead, where the address exists.
   *
   * A `url` pin wired to a string literal node counts as written: it is the same fact the
   * author typed, one drag further away.
   */
  literalUrl: string | null;
  target: SearchJumpTarget;
};

/**
 * Every network node in the document, wherever it lives.
 *
 * Events, functions **and macros** - the walk itself lives in `listBlueprintGraphSites`, which every
 * blueprint-reading rule shares: a Fetch buried in a macro ships exactly like one on an event, and
 * the reference indexer already learned that omitting macros hides real usage.
 *
 * Exported because the build gate runs this same sweep. Two implementations of "does this project
 * use the network" would be two chances to disagree, and the one that decides whether a build ships
 * is the one that must not be wrong.
 */
export function collectBlueprintNetworkNodes(
  document: BlueprintDocument | null
): BlueprintNetworkNodeSite[] {
  const sites: BlueprintNetworkNodeSite[] = [];
  for (const site of listBlueprintGraphSites(document)) {
    for (const node of Object.values(site.ir.nodes ?? {})) {
      if (!NETWORK_NODE_TYPES.has(node.type)) {
        continue;
      }
      sites.push({
        blueprintId: site.blueprintId,
        blueprintName: site.blueprintName,
        graphId: site.graphId,
        nodeId: node.id,
        nodeType: node.type,
        literalUrl:
          node.type === BLUEPRINT_NODE_TYPE_NETWORK_FETCH ? writtenFetchUrl(site.ir, node) : null,
        target: blueprintNodeJumpTarget(site, node.id)
      });
    }
  }
  return sites;
}

/**
 * A network node in a project whose Allow HTTP setting is off.
 *
 * One finding per node rather than one per project: the author's next action is to open the node
 * and delete it, or to change the setting, and a single project-level finding would name neither.
 */
function runFetchDisallowed(ctx: LintContext): LintFinding[] {
  if (ctx.network.allowHttp) {
    return [];
  }
  return collectBlueprintNetworkNodes(ctx.blueprintDocument).map((site) => ({
    ruleId: "network/fetch-disallowed" as const,
    messageKey: "lint.rule.networkFetchDisallowed.message" as const,
    messageParams: { blueprint: site.blueprintName },
    location: {
      kind: "blueprint" as const,
      blueprintId: site.blueprintId,
      blueprintName: site.blueprintName,
      graphId: site.graphId,
      nodeId: site.nodeId
    },
    target: site.target
  }));
}

/**
 * A Fetch node whose written address the project's allowlist does not cover.
 *
 * Only written addresses, for the reason stated on {@link BlueprintNetworkNodeSite.literalUrl}.
 * A computed one does not exist until the graph runs, and the host refuses it there with a
 * message naming the list.
 *
 * Plugin-declared hosts count. A project narrowed to a list still reaches what the author
 * approved at install, and reporting a node that will work is worse than reporting nothing.
 *
 * Error, with an unconditional build gate behind it, for the reason `network/fetch-disallowed`
 * has one: lint is switchable, and a switched-off rule must not be all that stands between a
 * project and a build that ships a request the game refuses.
 */
function runFetchNotAllowlisted(ctx: LintContext): LintFinding[] {
  const allowlist = projectNetworkAllowlist(ctx);
  if (!ctx.network.allowHttp || networkAllowlistCspSources(allowlist) === null) {
    return [];
  }
  const findings: LintFinding[] = [];
  for (const site of collectBlueprintNetworkNodes(ctx.blueprintDocument)) {
    if (!site.literalUrl || isNetworkAddressAllowed(site.literalUrl, allowlist)) {
      continue;
    }
    findings.push({
      ruleId: "network/fetch-not-allowlisted" as const,
      messageKey: "lint.rule.networkFetchNotAllowlisted.message" as const,
      messageParams: { url: site.literalUrl },
      location: {
        kind: "blueprint" as const,
        blueprintId: site.blueprintId,
        blueprintName: site.blueprintName,
        graphId: site.graphId,
        nodeId: site.nodeId
      },
      target: site.target
    });
  }
  return findings;
}

/**
 * The list one build of this project would be narrowed to: the author's entries plus every
 * installed plugin's declared hosts, in the shape the matcher takes.
 *
 * Exported because the build gate resolves the same thing, and two answers to "what may this
 * project reach" would be two chances to disagree - the rule the node sweep above follows too.
 */
export function projectNetworkAllowlist(ctx: LintContext): NetworkAllowlist {
  return {
    policy: ctx.network.policy,
    entries: ctx.network.allowlist,
    plugins: ctx.pluginNetworkDeclarations
  };
}

export const NETWORK_LINT_RULES: readonly LintRule[] = [
  {
    id: "network/fetch-disallowed",
    category: "network",
    defaultSeverity: "error",
    slug: "networkFetchDisallowed",
    run: (ctx) => runFetchDisallowed(ctx)
  },
  {
    id: "network/fetch-not-allowlisted",
    category: "network",
    defaultSeverity: "error",
    slug: "networkFetchNotAllowlisted",
    run: (ctx) => runFetchNotAllowlisted(ctx)
  }
];
