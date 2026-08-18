/**
 * Breakpoints for the graph open in the blueprint editor: the table, the context-menu actions the
 * node cards and the canvas reach through context, and the condition dialog they open.
 *
 * The editor is where a breakpoint is usually placed - the author is already looking at the node
 * that is behaving wrongly. The table itself is machine-local and shared with the Dev Mode
 * debugger through the global settings store, so a breakpoint added here is armed in a running
 * game without saving anything to the project.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";
import { getBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { BlueprintBreakpointDialog } from "@/lib/ui-editor/blueprint-debug/BlueprintBreakpointDialog";
import {
  BlueprintBreakpointScopeProvider,
  type BlueprintBreakpointScope as BlueprintBreakpointScopeValue
} from "@/lib/ui-editor/blueprint-debug/BlueprintBreakpointsContext";
import { useBlueprintBreakpoints } from "@/lib/ui-editor/blueprint-runtime/useBlueprintBreakpoints";
import { useTranslation } from "@/lib/i18n";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { resolveBlueprintNodeTitle } from "../blueprintNodeI18n";

export function BlueprintBreakpointScope(props: {
  projectPath: string | null;
  blueprintId: string;
  /** Null while no graph is open; the scope then provides nothing. */
  graphId: string | null;
  ir: BlueprintGraphIr | null | undefined;
  /** Member variables of this blueprint, offered as condition subjects. */
  variables: readonly { id: string; name: string }[];
  children: ReactNode;
}): ReactNode {
  const { projectPath, blueprintId, graphId, ir, variables, children } = props;
  const { t } = useTranslation();
  const { byKey, toggle, setEnabled, configure } = useBlueprintBreakpoints(projectPath);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const target = useCallback(
    (nodeId: string) => (graphId ? { blueprintId, graphId, nodeId } : null),
    [blueprintId, graphId]
  );

  const scope = useMemo<BlueprintBreakpointScopeValue | null>(() => {
    if (!graphId || !projectPath) {
      return null;
    }
    return {
      blueprintId,
      graphId,
      byKey,
      toggle: (nodeId) => toggle({ blueprintId, graphId, nodeId }),
      setEnabled: (nodeId, enabled) => setEnabled({ blueprintId, graphId, nodeId }, enabled),
      edit: (nodeId) => setEditingNodeId(nodeId)
    };
  }, [blueprintId, graphId, projectPath, byKey, toggle, setEnabled]);

  const editingTarget = editingNodeId ? target(editingNodeId) : null;
  const editingBreakpoint = editingTarget
    ? byKey.get(blueprintBreakpointKey(editingTarget))
    : undefined;
  const editingNodeType = editingNodeId ? ir?.nodes?.[editingNodeId]?.type : undefined;
  const editingCatalog = editingNodeType
    ? getBlueprintNodeEditorCatalogEntry(editingNodeType)
    : undefined;

  return (
    <BlueprintBreakpointScopeProvider value={scope}>
      {children}
      <BlueprintBreakpointDialog
        open={Boolean(editingTarget)}
        breakpoint={editingBreakpoint}
        variables={variables}
        nodeLabel={
          editingCatalog
            ? resolveBlueprintNodeTitle(editingCatalog.displayName, t)
            : (editingNodeType ?? undefined)
        }
        onClose={() => setEditingNodeId(null)}
        onSubmit={(next) => {
          if (editingTarget) {
            configure(editingTarget, next);
          }
        }}
      />
    </BlueprintBreakpointScopeProvider>
  );
}
