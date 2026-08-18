/**
 * Edit one breakpoint: when it should stop, rather than whether it exists.
 *
 * Lives in `lib` because both windows open it - the blueprint editor from a node's context menu,
 * the Dev Mode debugger from its breakpoint list and its read-only graph. It takes the variables
 * it can offer as a prop; resolving a blueprint's member variables is the caller's business, and
 * the two callers reach a blueprint document by different routes.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  BLUEPRINT_BREAKPOINT_CONDITION_OPS,
  type BlueprintBreakpoint,
  type BlueprintBreakpointCondition,
  type BlueprintBreakpointConditionOp
} from "@shared/types/blueprint/breakpoints";
import { Button } from "@/lib/components/elements/Button";
import { Input } from "@/lib/components/elements/Input";
import { Modal } from "@/lib/components/elements/Modal";
import { Select } from "@/lib/components/elements/Select";
import { useTranslation } from "@/lib/i18n";

export type BlueprintBreakpointDialogVariable = {
  id: string;
  name: string;
};

export type BlueprintBreakpointDialogProps = {
  open: boolean;
  /** The breakpoint being edited; absent means the node has none yet and one is being created. */
  breakpoint?: BlueprintBreakpoint;
  /** Blueprint member variables a condition may test. Empty disables the condition controls. */
  variables: readonly BlueprintBreakpointDialogVariable[];
  /** Node caption for the dialog title; the node id is bookkeeping and is never shown. */
  nodeLabel?: string;
  onClose: () => void;
  onSubmit: (next: {
    condition: BlueprintBreakpointCondition | null;
    hitCountTarget: number | null;
  }) => void;
};

const NO_CONDITION = "";

export function BlueprintBreakpointDialog(props: BlueprintBreakpointDialogProps): ReactNode {
  const { open, breakpoint, variables, nodeLabel, onClose, onSubmit } = props;
  const { t } = useTranslation();

  const [variableId, setVariableId] = useState<string>(NO_CONDITION);
  const [op, setOp] = useState<BlueprintBreakpointConditionOp>("==");
  const [value, setValue] = useState<string>("");
  const [hitCount, setHitCount] = useState<string>("");

  // Reset from the breakpoint every time the dialog opens: it is reused for whichever node was
  // right-clicked, and carrying the previous node's condition into a fresh one is how a debugger
  // ends up not stopping for reasons nobody can see.
  useEffect(() => {
    if (!open) {
      return;
    }
    setVariableId(breakpoint?.condition?.variableId ?? NO_CONDITION);
    setOp(breakpoint?.condition?.op ?? "==");
    setValue(breakpoint?.condition ? String(breakpoint.condition.value) : "");
    setHitCount(breakpoint?.hitCountTarget ? String(breakpoint.hitCountTarget) : "");
  }, [open, breakpoint]);

  const submit = (): void => {
    const condition: BlueprintBreakpointCondition | null = variableId
      ? { variableId, op, value: coerceConditionValue(value) }
      : null;
    const parsedHitCount = Number.parseInt(hitCount, 10);
    onSubmit({
      condition,
      hitCountTarget: Number.isFinite(parsedHitCount) && parsedHitCount > 1 ? parsedHitCount : null
    });
    onClose();
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="sm"
      title={
        nodeLabel
          ? t("blueprint.breakpoint.editTitleFor", { node: nodeLabel })
          : t("blueprint.breakpoint.editTitle")
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={submit}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-xs">
        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted">{t("blueprint.breakpoint.conditionLabel")}</span>
          {variables.length === 0 ? (
            <p className="text-fg-subtle">{t("blueprint.breakpoint.noVariables")}</p>
          ) : (
            <div className="flex items-center gap-1.5">
              <Select
                size="sm"
                className="min-w-0 flex-1"
                ariaLabel={t("blueprint.breakpoint.conditionVariable")}
                value={variableId}
                options={[
                  { value: NO_CONDITION, label: t("blueprint.breakpoint.always") },
                  ...variables.map((variable) => ({ value: variable.id, label: variable.name }))
                ]}
                onChange={(next) => setVariableId(String(next))}
              />
              <Select
                size="sm"
                className="w-24 shrink-0"
                disabled={!variableId}
                ariaLabel={t("blueprint.breakpoint.conditionOperator")}
                value={op}
                options={BLUEPRINT_BREAKPOINT_CONDITION_OPS.map((entry) => ({
                  value: entry,
                  label: entry === "contains" ? t("blueprint.breakpoint.opContains") : entry
                }))}
                onChange={(next) => setOp(next as BlueprintBreakpointConditionOp)}
              />
              <Input
                size="sm"
                className="w-28 shrink-0"
                disabled={!variableId}
                aria-label={t("blueprint.breakpoint.conditionValue")}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted">{t("blueprint.breakpoint.hitCountLabel")}</span>
          <Input
            size="sm"
            type="number"
            min={1}
            className="w-28"
            placeholder="1"
            aria-label={t("blueprint.breakpoint.hitCountLabel")}
            value={hitCount}
            onChange={(event) => setHitCount(event.target.value)}
          />
          <p className="text-fg-subtle">{t("blueprint.breakpoint.hitCountHint")}</p>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Read the typed field as the value the author meant. `3` compares as a number, `true` as a
 * boolean, everything else as text - the same reading the condition evaluator's loose equality
 * would arrive at, decided once here so the stored breakpoint says which one it is.
 */
function coerceConditionValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true" || trimmed === "false") {
    return trimmed === "true";
  }
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return raw;
}
