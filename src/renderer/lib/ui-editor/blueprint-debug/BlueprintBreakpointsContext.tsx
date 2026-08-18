/**
 * The breakpoints of the graph currently on screen, reachable from inside a node card.
 *
 * A context rather than a prop for one specific reason: the blueprint editor's flow projection is
 * memoised against a structural signature, so anything threaded through node `data` only reaches
 * the card when that signature changes. Breakpoints change constantly and change nothing
 * structural, and widening the signature to include them would rebuild every node card on every
 * toggle. Reading them from context re-renders the cards that consume it and nothing else.
 *
 * Absent (null) wherever no debugger exists - a blueprint editor opened with no project path, and
 * every consumer of the flow canvas that is not the editor. Consumers must degrade to "no
 * breakpoints here", never assume a provider.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";

export type BlueprintBreakpointScope = {
  blueprintId: string;
  /** The graph on screen; a breakpoint's identity is (blueprint, graph, node). */
  graphId: string;
  byKey: ReadonlyMap<string, BlueprintBreakpoint>;
  /** Add when absent, remove when present. */
  toggle: (nodeId: string) => void;
  setEnabled: (nodeId: string, enabled: boolean) => void;
  /** Open the condition / hit-count editor for this node. */
  edit: (nodeId: string) => void;
};

const Context = createContext<BlueprintBreakpointScope | null>(null);

export function BlueprintBreakpointScopeProvider(props: {
  value: BlueprintBreakpointScope | null;
  children: ReactNode;
}): ReactNode {
  return <Context.Provider value={props.value}>{props.children}</Context.Provider>;
}

export function useBlueprintBreakpointScope(): BlueprintBreakpointScope | null {
  return useContext(Context);
}

/** The breakpoint on one node of the graph in scope, if there is one. */
export function useBlueprintBreakpointForNode(nodeId: string): BlueprintBreakpoint | undefined {
  const scope = useContext(Context);
  if (!scope) {
    return undefined;
  }
  return scope.byKey.get(
    blueprintBreakpointKey({ blueprintId: scope.blueprintId, graphId: scope.graphId, nodeId })
  );
}
