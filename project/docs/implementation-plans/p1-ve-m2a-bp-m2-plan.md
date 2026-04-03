# P1: Visual Editor M2-A + Blueprint System M2

**Status:** Implemented in-repo (2026-04). Source of truth for full technical breakdown: `.cursor/plans/ve-bp-p1-plan_0bbbbf27.plan.md`.

## Scope delivered (this pass)

- Widgets: `nl.text`, `nl.image`, `nl.container` (Container/Frame), `nl.button` — registered in `BuiltinWidgetModules`; `supportsBlueprintLogic: true` for all four plus existing `nl.rectangle`.
- Local instance blueprint: `ensureEventGraph` / `removeEventGraph` / `listEventGraphIds`; event IR under `Blueprint.program.graphs.events[eventId].graph`; `UIDocumentService.setElementBlueprintEvent` / `clearElementBlueprintEvent` for `UIBehaviorBinding.blueprintEvent` + graph persistence.
- Read-only Blueprint summary: `ReadonlyBlueprintSection` + `useReadonlyBlueprintSummary`; Rectangle uses the shared block.
- Validation: owner/event key consistency; active bindings must resolve to existing declarations.
- Copy/paste prep: `planSubtreeDuplicateBlueprintRemap` (data-only helper, no UI).

## Explicit non-goals (unchanged)

Stack/Scroll/Spacer/Repeater, full blueprint editor, runtime execution, clipboard duplicate UI — per parent plan.

## Verification notes

- `npx tsc --noEmit -p src/renderer/tsconfig.json` and `src/main/tsconfig.json` pass.
- Manual: insert widgets from docker/right-click; confirm `widgetMain` in read-only summary after sync; optional API test via `setElementBlueprintEvent` from devtools.
