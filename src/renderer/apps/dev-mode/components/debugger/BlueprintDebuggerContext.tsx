/**
 * One debugger state for the whole Dev Mode window.
 *
 * The panel (a sibling of the stage) and the graph overlay (on top of the stage) sit in different
 * places in the tree but are two views of one thing: the same stop, the same breakpoints, the same
 * graph being looked at. A context is what lets them stay one thing without either owning the other.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { BlueprintDebugSession } from "@/lib/ui-editor/blueprint-runtime/BlueprintDebugSession";
import { useBlueprintDebugger, type UseBlueprintDebuggerResult } from "./useBlueprintDebugger";

type BlueprintDebuggerContextValue = UseBlueprintDebuggerResult & {
  session: BlueprintDebugSession | null;
  blueprintDocument: BlueprintDocument | undefined;
  /** The graph overlay is open because the author asked for it, rather than because of a stop. */
  graphBrowserOpen: boolean;
  openGraphBrowser: () => void;
  closeGraphBrowser: () => void;
};

const BlueprintDebuggerContext = createContext<BlueprintDebuggerContextValue | null>(null);

export function BlueprintDebuggerProvider(props: {
  session: BlueprintDebugSession | null;
  blueprintDocument: BlueprintDocument | undefined;
  projectPath: string | null;
  children: ReactNode;
}): ReactNode {
  const { session, blueprintDocument, projectPath, children } = props;
  const debugger_ = useBlueprintDebugger({ session, blueprintDocument, projectPath });
  const [graphBrowserOpen, setGraphBrowserOpen] = useState(false);

  const value = useMemo<BlueprintDebuggerContextValue>(
    () => ({
      ...debugger_,
      session,
      blueprintDocument,
      graphBrowserOpen,
      openGraphBrowser: () => setGraphBrowserOpen(true),
      closeGraphBrowser: () => setGraphBrowserOpen(false)
    }),
    [debugger_, session, blueprintDocument, graphBrowserOpen]
  );

  return (
    <BlueprintDebuggerContext.Provider value={value}>{children}</BlueprintDebuggerContext.Provider>
  );
}

export function useBlueprintDebuggerContext(): BlueprintDebuggerContextValue | null {
  return useContext(BlueprintDebuggerContext);
}
