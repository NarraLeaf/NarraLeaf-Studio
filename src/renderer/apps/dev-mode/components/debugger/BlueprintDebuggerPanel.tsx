/**
 * The debugger drawer: what is stopped, where it came from, what it can see, and every breakpoint
 * in the project. The graph itself is not here - 380px is not a canvas - it is in the overlay,
 * which opens on a stop and can also be opened from the button in this panel's header.
 */

import { useMemo, type ReactNode } from "react";
import { CircleDot, Network, SlidersHorizontal, Trash2 } from "lucide-react";
import type { BlueprintBreakpoint } from "@shared/types/blueprint/breakpoints";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { getBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { resolveBlueprintNodeTitle } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { DevModePanelModeToggle, type DevModePanelChrome } from "../DevModePanelChrome";
import { formatDebugValue } from "../debugValueFormat";
import { BlueprintDebuggerToolbar } from "./BlueprintDebuggerToolbar";
import { useBlueprintDebuggerContext } from "./BlueprintDebuggerContext";
import {
  groupBreakpointsByBlueprint,
  resolveBlueprintGraphIr,
  resolveBlueprintGraphName,
  resolveBlueprintNodeType
} from "./blueprintDebuggerModel";

export function BlueprintDebuggerPanel(props: {
  className?: string;
  chrome?: DevModePanelChrome;
}): ReactNode {
  const { className, chrome } = props;
  const { t } = useTranslation();
  const ctx = useBlueprintDebuggerContext();

  const rootClass = [
    "flex h-full min-h-0 shrink-0 flex-col bg-surface-sunken text-2xs text-fg-muted",
    chrome?.floating ? "" : "border-l border-edge",
    className
  ]
    .filter(Boolean)
    .join(" ");

  if (!ctx) {
    return <div className={rootClass} />;
  }

  const { snapshot, session, blueprintDocument } = ctx;
  const paused = snapshot.status === "paused";
  const scope =
    paused && snapshot.pausedFrameId
      ? (session?.readFrameScope(snapshot.pausedFrameId) ?? null)
      : null;

  return (
    <div className={rootClass}>
      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5 ${
          chrome?.floating ? "cursor-grab select-none active:cursor-grabbing" : ""
        }`}
        onPointerDown={chrome?.onTitleBarPointerDown}
      >
        <span className="text-xs font-medium text-fg">{t("devMode.debugger.title")}</span>
        <div className="flex items-center gap-1">
          <ToolbarButton
            size="xs"
            aria-label={t("devMode.debugger.openGraph")}
            data-tip={t("devMode.debugger.openGraph")}
            onClick={ctx.openGraphBrowser}
          >
            <Network className="h-3.5 w-3.5" aria-hidden />
          </ToolbarButton>
          <DevModePanelModeToggle chrome={chrome} />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5">
        <span className={paused ? "text-warning" : "text-fg-subtle"}>
          {paused
            ? snapshot.reason === "breakpoint"
              ? t("devMode.debugger.statusBreakpoint")
              : t("devMode.debugger.statusStepped")
            : snapshot.pausePending
              ? t("devMode.debugger.statusPausePending")
              : t("devMode.debugger.statusRunning")}
        </span>
        <BlueprintDebuggerToolbar session={session} snapshot={snapshot} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto font-mono leading-snug">
        {paused ? (
          <>
            <Section title={t("devMode.debugger.callStack")}>
              <ul className="space-y-0.5">
                {[...snapshot.stack].reverse().map((frame) => {
                  const graphName =
                    resolveBlueprintGraphName(
                      blueprintDocument,
                      frame.blueprintId,
                      frame.graphId
                    ) ??
                    frame.graphId ??
                    "";
                  const blueprintName = frame.blueprintId
                    ? (blueprintDocument?.blueprints[frame.blueprintId]?.name ?? "")
                    : "";
                  const nodeTitle = frame.currentNodeId
                    ? nodeTitleOf(
                        blueprintDocument,
                        frame.blueprintId,
                        frame.graphId,
                        frame.currentNodeId,
                        t
                      )
                    : null;
                  return (
                    <li
                      key={frame.frameId}
                      className={`rounded-md px-1.5 py-1 ${
                        frame.frameId === snapshot.pausedFrameId
                          ? "bg-fill-strong text-fg"
                          : "text-fg-muted"
                      }`}
                    >
                      <div className="truncate">
                        {graphName}
                        {nodeTitle ? <span className="text-fg-subtle"> · {nodeTitle}</span> : null}
                      </div>
                      {blueprintName ? (
                        <div className="truncate text-fg-subtle">{blueprintName}</div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Section>

            <Section title={t("devMode.debugger.scope")}>
              {scope && scope.variables.length > 0 ? (
                <ScopeRows entries={scope.variables} />
              ) : (
                <p className="text-fg-subtle">{t("devMode.debugger.scopeEmpty")}</p>
              )}
              {scope?.eventPayload && scope.eventPayload.length > 0 ? (
                <>
                  <p className="mt-2 text-fg-subtle">{t("devMode.debugger.eventPayload")}</p>
                  <ScopeRows entries={scope.eventPayload} />
                </>
              ) : null}
              {scope && scope.nodeOutputs.length > 0 ? (
                <>
                  <p className="mt-2 text-fg-subtle">{t("devMode.debugger.nodeOutputs")}</p>
                  {scope.nodeOutputs.map((output) => (
                    <div key={output.nodeId} className="mt-1">
                      <div className="truncate text-fg-subtle">
                        {nodeTitleOf(
                          blueprintDocument,
                          snapshot.pausedBlueprintId,
                          snapshot.pausedGraphId,
                          output.nodeId,
                          t
                        ) ?? output.nodeId}
                      </div>
                      <ScopeRows entries={output.values} />
                    </div>
                  ))}
                </>
              ) : null}
            </Section>
          </>
        ) : null}

        <Section
          title={t("devMode.debugger.breakpoints")}
          action={
            ctx.breakpoints.length > 0 ? (
              <ToolbarButton
                size="xs"
                aria-label={t("devMode.debugger.removeAllBreakpoints")}
                title={t("devMode.debugger.removeAllBreakpoints")}
                onClick={ctx.removeAllBreakpoints}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </ToolbarButton>
            ) : null
          }
        >
          <BreakpointList />
        </Section>
      </div>
    </div>
  );
}

function Section(props: { title: string; action?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="border-b border-edge p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        {/* FieldLabel's typography, spelled out because that component is a label/span/div
                    and a section heading wants to stay an <h3>. Not uppercased: the eyebrow style
                    this matches is not, and shouting a word is not what makes it read as a heading. */}
        <h3 className="text-2xs font-medium tracking-wide text-fg-subtle">{props.title}</h3>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function ScopeRows(props: { entries: { name: string; value: unknown }[] }): ReactNode {
  return (
    <ul className="space-y-0.5">
      {props.entries.map((entry) => (
        <li key={entry.name} className="flex gap-1.5">
          <span className="shrink-0 text-fg">{entry.name}</span>
          <span className="min-w-0 flex-1 truncate text-fg-muted">
            {formatDebugValue(entry.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BreakpointList(): ReactNode {
  const { t } = useTranslation();
  const ctx = useBlueprintDebuggerContext();
  const groups = useMemo(
    () => (ctx ? groupBreakpointsByBlueprint(ctx.breakpoints, ctx.blueprintDocument) : []),
    [ctx]
  );
  if (!ctx) {
    return null;
  }
  if (groups.length === 0) {
    return <p className="text-fg-subtle">{t("devMode.debugger.breakpointsEmpty")}</p>;
  }
  return (
    <div className="space-y-2">
      {groups.map((group) => (
        <div key={group.blueprintId}>
          <div className="truncate text-fg-subtle">{group.blueprintName}</div>
          <ul className="space-y-0.5">
            {group.breakpoints.map((breakpoint) => (
              <BreakpointRow key={blueprintBreakpointKey(breakpoint)} breakpoint={breakpoint} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BreakpointRow(props: { breakpoint: BlueprintBreakpoint }): ReactNode {
  const { breakpoint } = props;
  const { t } = useTranslation();
  const ctx = useBlueprintDebuggerContext();
  if (!ctx) {
    return null;
  }
  const nodeType = resolveBlueprintNodeType(ctx.blueprintDocument, breakpoint);
  const catalog = nodeType ? getBlueprintNodeEditorCatalogEntry(nodeType) : undefined;
  const graphName =
    resolveBlueprintGraphName(ctx.blueprintDocument, breakpoint.blueprintId, breakpoint.graphId) ??
    breakpoint.graphId;
  const missing = !resolveBlueprintGraphIr(
    ctx.blueprintDocument,
    breakpoint.blueprintId,
    breakpoint.graphId
  )?.nodes?.[breakpoint.nodeId];

  return (
    <li className="flex items-center gap-1.5">
      <button
        type="button"
        className="shrink-0 cursor-default"
        aria-label={
          breakpoint.enabled ? t("blueprint.breakpoint.disable") : t("blueprint.breakpoint.enable")
        }
        data-tip={
          breakpoint.enabled ? t("blueprint.breakpoint.disable") : t("blueprint.breakpoint.enable")
        }
        onClick={() => ctx.setBreakpointEnabled(breakpoint, !breakpoint.enabled)}
      >
        <CircleDot
          className={`h-3 w-3 ${breakpoint.enabled ? "text-danger" : "text-fg-subtle"}`}
          aria-hidden
        />
      </button>
      <button
        type="button"
        className="min-w-0 flex-1 cursor-default truncate text-left hover:text-fg"
        onClick={() => {
          ctx.setView(breakpoint.blueprintId, breakpoint.graphId);
          ctx.openGraphBrowser();
        }}
      >
        <span className={missing ? "text-fg-subtle line-through" : "text-fg-muted"}>
          {catalog
            ? resolveBlueprintNodeTitle(catalog.displayName, t)
            : (nodeType ?? t("devMode.debugger.missingNode"))}
        </span>
        <span className="text-fg-subtle"> · {graphName}</span>
      </button>
      <ToolbarButton
        size="xs"
        aria-label={t("blueprint.breakpoint.edit")}
        data-tip={t("blueprint.breakpoint.edit")}
        onClick={() => ctx.openBreakpointEditor(breakpoint)}
      >
        <SlidersHorizontal className="h-3 w-3" aria-hidden />
      </ToolbarButton>
      <ToolbarButton
        size="xs"
        aria-label={t("blueprint.breakpoint.remove")}
        data-tip={t("blueprint.breakpoint.remove")}
        onClick={() => ctx.removeBreakpoint(breakpoint)}
      >
        <Trash2 className="h-3 w-3" aria-hidden />
      </ToolbarButton>
    </li>
  );
}

function nodeTitleOf(
  document: Parameters<typeof resolveBlueprintGraphIr>[0],
  blueprintId: string | undefined,
  graphId: string | undefined,
  nodeId: string,
  t: UseTranslation["t"]
): string | null {
  const nodeType = resolveBlueprintGraphIr(document, blueprintId, graphId)?.nodes?.[nodeId]?.type;
  if (!nodeType) {
    return null;
  }
  const catalog = getBlueprintNodeEditorCatalogEntry(nodeType);
  return catalog ? resolveBlueprintNodeTitle(catalog.displayName, t) : nodeType;
}
