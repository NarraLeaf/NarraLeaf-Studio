/**
 * Variables panel (right sidebar). Always present, whether or not a story is open.
 *
 * The sections are split by OWNERSHIP, not by lifetime. The story document owns scene variables and
 * nothing else; the two project-level scopes - saved and global - live in the project variable
 * registry (`editor/variables.json`) and are created from here. Hence the order: the two scopes this
 * panel authors come first, and the scene scope - a read-only reflection of declaration rows the
 * author writes in the story with `/local` - comes last.
 *
 * That ownership split is also why the panel has two shapes. Saved and global are project resources
 * and render from the registry with no payload at all; the scene section needs a focused story, so
 * it appears only when a scene editor has published one (see `StorySceneEditorTab`), and is omitted
 * outright otherwise. Not an empty section, and not a line explaining its absence - a section that
 * cannot have content is not content.
 *
 * A project-level section can still list rows a STORY declares (`/save`, `/global`): a project whose
 * rows were never migrated into the registry, which in practice means one that was frozen when the
 * migration ran. Those are listed but not edited here, because their source of truth is a line in a
 * scene - clicking one goes to that line, exactly as a scene row does. Nothing labels them; an
 * editable row and a non-editable row already look different, and a badge saying so would only name
 * what is visible.
 *
 * ⚠ Those legacy rows can only be merged in while their story is focused, because they live in the
 * story document and nothing else here reads one. So on a frozen, unmigrated project the saved and
 * global sections list MORE rows with a story open than without. The asymmetry is not a bug and not
 * worth a fix: post-migration there are no such rows, and the alternative - loading every story in
 * the project to fill a side panel - costs far more than the case is worth.
 *
 * Comments in English per convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpCircle, Plus, Trash2 } from "lucide-react";
import type { PanelComponentProps } from "../types";
import { useTranslation } from "@/lib/i18n";
import {
  CONTROL_SIZE_CLASS,
  CONTROL_SQUARE_CLASS,
  HintPopover,
  Select,
  type SelectOption
} from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useWorkspace } from "@/apps/workspace/context";
import { useRegistry } from "@/apps/workspace/registry";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import {
  LocalBlueprintService,
  VARIABLE_PANEL_HISTORY_SCOPE_ID
} from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import type { StoryDocument, StoryLiteralValue, StoryVariableValueType } from "@shared/types/story";
import {
  declarationDefaultForType,
  findDeclarationBlock,
  savedVariableDefs,
  sceneVariableDefs,
  storyPersistentDefs
} from "@shared/types/story";
import type { TranslationKey } from "@shared/i18n";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import {
  buildMergedVariableView,
  type MergedPersistentEntry
} from "@shared/variables/mergedPersistentView";
import { jumpToSearchTarget } from "../search/searchJump";
import type { StoryVariablesPanelPayload } from "./storyVariablesPanelId";

const INPUT_CLASS = cn(
  CONTROL_SIZE_CLASS.sm,
  "min-w-0 flex-1 rounded-md border border-edge bg-surface-raised text-fg outline-none focus:border-primary/50"
);

function formatDefault(
  value: StoryLiteralValue | undefined,
  valueType: StoryVariableValueType
): string {
  if (value === undefined || value === null) return "";
  if (valueType === "json") return typeof value === "string" ? value : JSON.stringify(value);
  return String(value);
}

function parseDefault(text: string, valueType: StoryVariableValueType): StoryLiteralValue {
  if (valueType === "boolean") return text === "true";
  if (valueType === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }
  if (valueType === "json") {
    try {
      return JSON.parse(text) as StoryLiteralValue;
    } catch {
      return text;
    }
  }
  return text;
}

type VariableRow = {
  id: string;
  name: string;
  valueType: StoryVariableValueType;
  defaultValue?: StoryLiteralValue;
};

/** One table of type labels, so the read-only rows name a type exactly as the editable rows' dropdown does. */
const VALUE_TYPE_KEYS: Record<StoryVariableValueType, TranslationKey> = {
  boolean: "storyVars.valueType.boolean",
  number: "storyVars.valueType.number",
  string: "storyVars.valueType.string",
  json: "storyVars.valueType.json"
};

function useValueTypeOptions(): SelectOption[] {
  const { t } = useTranslation();
  return useMemo(
    () =>
      (Object.keys(VALUE_TYPE_KEYS) as StoryVariableValueType[]).map((valueType) => ({
        value: valueType,
        label: t(VALUE_TYPE_KEYS[valueType])
      })),
    [t]
  );
}

function VariableRowEditor(props: {
  row: VariableRow;
  onRename: (name: string) => void;
  onRetype: (valueType: StoryVariableValueType) => void;
  onDefault: (value: StoryLiteralValue) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const freeze = useFreezeGuard();
  const valueTypeOptions = useValueTypeOptions();
  return (
    <div className="flex items-center gap-1.5">
      {/* All three of these rewrite project data, and until this pass only the delete
                button beside them knew about the freeze: on a frozen project the author could rename
                a variable, retype it and edit its default, watch the row update, and lose all of it
                on thaw. `readOnly` rather than `disabled` on the two text boxes, matching what the
                inspector framework does with its own text fields - the name and the default are
                what the author came to READ, and a disabled input is dimmed past reading. */}
      <input
        className={INPUT_CLASS}
        value={props.row.name}
        onChange={(event) => props.onRename(event.target.value)}
        readOnly={freeze.frozen}
        data-tip={freeze.frozen ? freeze.reason : undefined}
        aria-label={t("storyVars.row.nameAria")}
      />
      <Select
        options={valueTypeOptions}
        value={props.row.valueType}
        onChange={(value) => props.onRetype(String(value) as StoryVariableValueType)}
        size="sm"
        portalMenu
        disabled={freeze.frozen}
        className="w-24 shrink-0"
      />
      <input
        className={INPUT_CLASS}
        value={formatDefault(props.row.defaultValue, props.row.valueType)}
        placeholder={t("storyVars.row.defaultPlaceholder")}
        onChange={(event) => props.onDefault(parseDefault(event.target.value, props.row.valueType))}
        readOnly={freeze.frozen}
        data-tip={freeze.frozen ? freeze.reason : undefined}
        aria-label={t("storyVars.row.defaultAria")}
      />
      <button
        type="button"
        className={cn(
          CONTROL_SQUARE_CLASS.sm,
          "flex items-center justify-center rounded-md text-fg-subtle hover:bg-fill hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
        )}
        onClick={props.onDelete}
        {...freeze.writes(false, t("storyVars.row.delete"))}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * A variable this panel does not own: it was declared as a row in the story, so the row is where it
 * is edited, and this is a way to get there.
 *
 * Nothing here says "click me". It is a `<button>`, so it carries the pointer cursor every other
 * clickable row in Studio carries, and hovering lifts it out of the muted palette the way the search
 * panel's hits do (fill behind it, the name up to full `text-fg`, the border from subtle to solid) -
 * three changes at once, which is what makes a static row read as a target. Nothing static
 * distinguishes it either: it is visibly not an input, and that IS the distinction from the editable
 * rows above it. The focus state is a border colour rather than a ring because `styles.css` kills
 * `box-shadow` on native buttons with `!important`, so a ring here would be dead code.
 */
export function VariableJumpRow(props: {
  name: string;
  valueType: StoryVariableValueType;
  onJump: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={props.onJump}
      className={cn(
        CONTROL_SIZE_CLASS.sm,
        "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-edge-subtle",
        "text-left text-fg-muted transition-colors duration-150",
        "hover:border-edge hover:bg-fill hover:text-fg focus:border-primary"
      )}
    >
      <span className="truncate">{props.name}</span>
      <span className="shrink-0 text-2xs text-fg-subtle">
        {t(VALUE_TYPE_KEYS[props.valueType])}
      </span>
    </button>
  );
}

function SectionHeader(props: { title: string; hint: string; onAdd?: () => void }) {
  const { t } = useTranslation();
  // Declaring a variable writes project data. The hint popover beside it does not, and stays
  // open to a reader of a frozen project.
  const freeze = useFreezeGuard();
  return (
    <div className="flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-1">
        <div className="truncate text-xs font-medium text-fg">{props.title}</div>
        <HintPopover text={props.hint} icon={<HelpCircle className="h-3.5 w-3.5" />} width={176} />
      </div>
      {props.onAdd ? (
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded-md border border-edge px-2 text-2xs text-fg-muted hover:border-primary/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          onClick={props.onAdd}
          {...freeze.writes()}
        >
          <Plus className="h-3 w-3" /> {t("common.add")}
        </button>
      ) : null}
    </div>
  );
}

export function StoryVariablesPanel({ payload }: PanelComponentProps<StoryVariablesPanelPayload>) {
  const { t } = useTranslation();
  const { context, isInitialized } = useWorkspace();
  const { openEditorTab, setPanelVisibility } = useRegistry();
  const storyId = payload?.storyId;
  const sceneId = payload?.sceneId;

  const storyService = useMemo(
    () => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null),
    [context, isInitialized]
  );
  const blueprintService = useMemo(
    () =>
      context && isInitialized
        ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint)
        : null,
    [context, isInitialized]
  );
  const registryService = useMemo(
    () =>
      context && isInitialized
        ? context.services.get<VariableRegistryService>(Services.VariableRegistry)
        : null,
    [context, isInitialized]
  );

  const [document, setDocument] = useState<StoryDocument | null>(null);
  const [registryRows, setRegistryRows] = useState<{
    saved: VariableRegistryEntry[];
    persistent: VariableRegistryEntry[];
  }>({ saved: [], persistent: [] });

  useEffect(() => {
    if (!storyService || !storyId) {
      setDocument(null);
      return;
    }
    const read = () => {
      try {
        setDocument({ ...storyService.getStoryDocument(storyId) });
      } catch {
        setDocument(null);
      }
    };
    read();
    return storyService.onDocumentChanged((event) => {
      if (event.storyId === storyId) setDocument({ ...event.document });
    });
  }, [storyService, storyId]);

  useEffect(() => {
    if (!blueprintService || !registryService) return;
    const read = () =>
      setRegistryRows({
        saved: blueprintService.listSavedVariables(),
        persistent: blueprintService.listPersistentVariables()
      });
    read();
    // The registry's own event, not the blueprint history one this panel used to watch. Every
    // registry mutation emits it, including the ones history coalesces or refuses to record - and
    // a refused edit is exactly when a controlled input must be re-rendered, or the box keeps
    // showing text the registry already rejected (an emptied name). Undo/redo restores the
    // registry through `replaceRegistry`, which emits it too, so one subscription covers both.
    return registryService.onRegistryChanged(read);
  }, [blueprintService, registryService]);

  // Both project-level scopes are the merged view: registry entries (authored here) unioned with
  // whatever declaration rows the story still carries for that scope.
  const savedRows: MergedPersistentEntry[] = useMemo(
    () =>
      buildMergedVariableView(
        registryRows.saved,
        document ? Object.values(savedVariableDefs(document)) : []
      ).entries,
    [registryRows.saved, document]
  );
  const persistentRows: MergedPersistentEntry[] = useMemo(
    () =>
      buildMergedVariableView(
        registryRows.persistent,
        document ? Object.values(storyPersistentDefs(document)) : []
      ).entries,
    [registryRows.persistent, document]
  );

  const sceneRows: VariableRow[] = useMemo(() => {
    if (!document || !sceneId) return [];
    const scene = document.scenes[sceneId];
    return scene ? Object.values(sceneVariableDefs(scene)) : [];
  }, [document, sceneId]);

  /**
   * Open the declaration row that declares this variable.
   *
   * `variableId` is the declaration BLOCK id (that is what the v6 tables key by), so the lookup is
   * the same one every ref-to-row jump uses, and the navigation is the search panel's deep link
   * rather than a second way to open a scene editor at a block.
   */
  const jumpToDeclaration = useCallback(
    (variableId: string) => {
      if (!document) return;
      const found = findDeclarationBlock(document, variableId);
      if (!found) return;
      jumpToSearchTarget(
        {
          kind: "storyBlock",
          storyId: document.id,
          sceneId: found.sceneId,
          blockId: found.block.id,
          storyName: document.name,
          // The scene is the one the walk just found it in, so the fallback is unreachable;
          // empty rather than invented, which lets the jump's own `sceneName || storyName`
          // name the tab if it ever is reached.
          sceneName: document.scenes[found.sceneId]?.name ?? ""
        },
        { openEditorTab, setPanelVisibility, context }
      );
    },
    [document, openEditorTab, setPanelVisibility, context]
  );

  const addSaved = useCallback(() => {
    // Created immediately, with the registry's own generated name and the simplest type there is;
    // the row that appears is the editor for it. A modal asking for a name first would be the
    // blueprint member tree's gesture, not this panel's - here every other row is edited in place.
    blueprintService?.createSavedRegistryVariable(VARIABLE_PANEL_HISTORY_SCOPE_ID, {
      valueType: "boolean",
      defaultValue: false
    });
  }, [blueprintService]);

  const addPersistent = useCallback(() => {
    blueprintService?.createPersistentVariable(VARIABLE_PANEL_HISTORY_SCOPE_ID, {
      valueType: "boolean",
      defaultValue: false
    });
  }, [blueprintService]);

  /** One project-level row: editable when this panel owns it, a jump when the story does. */
  const renderProjectRow = (
    entry: MergedPersistentEntry,
    edit: {
      rename: (id: string, name: string) => void;
      retype: (id: string, valueType: StoryVariableValueType) => void;
      setDefault: (id: string, value: StoryLiteralValue) => void;
      remove: (id: string) => void;
    }
  ) =>
    entry.source === "story" ? (
      <VariableJumpRow
        key={entry.storageKey}
        name={entry.name}
        valueType={entry.valueType}
        onJump={() => jumpToDeclaration(entry.id)}
      />
    ) : (
      <VariableRowEditor
        key={entry.storageKey}
        row={entry}
        onRename={(name) => edit.rename(entry.id, name)}
        onRetype={(valueType) => {
          edit.retype(entry.id, valueType);
          edit.setDefault(entry.id, declarationDefaultForType(valueType));
        }}
        onDefault={(value) => edit.setDefault(entry.id, value)}
        onDelete={() => edit.remove(entry.id)}
      />
    );

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-col gap-2">
        <SectionHeader
          title={t("storyVars.saved.title")}
          hint={t("storyVars.saved.hint")}
          onAdd={addSaved}
        />
        {/* An empty scope lists nothing. The + in the header above it is the action, and a
                    line saying the list is empty would only be describing the list. */}
        <div className="flex flex-col gap-1.5">
          {savedRows.map((entry) =>
            renderProjectRow(entry, {
              rename: (id, name) =>
                blueprintService?.renameSavedRegistryVariable(
                  VARIABLE_PANEL_HISTORY_SCOPE_ID,
                  id,
                  name
                ),
              retype: (id, valueType) =>
                blueprintService?.setSavedRegistryVariableValueType(
                  VARIABLE_PANEL_HISTORY_SCOPE_ID,
                  id,
                  valueType
                ),
              setDefault: (id, value) =>
                blueprintService?.setSavedRegistryVariableDefault(
                  VARIABLE_PANEL_HISTORY_SCOPE_ID,
                  id,
                  value
                ),
              remove: (id) =>
                blueprintService?.deleteSavedRegistryVariable(VARIABLE_PANEL_HISTORY_SCOPE_ID, id)
            })
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionHeader
          title={t("storyVars.persistent.title")}
          hint={t("storyVars.persistent.hint")}
          onAdd={addPersistent}
        />
        <div className="flex flex-col gap-1.5">
          {persistentRows.map((entry) =>
            renderProjectRow(entry, {
              rename: (id, name) =>
                blueprintService?.renamePersistentVariable(
                  VARIABLE_PANEL_HISTORY_SCOPE_ID,
                  id,
                  name
                ),
              retype: (id, valueType) =>
                blueprintService?.setPersistentVariableValueType(
                  VARIABLE_PANEL_HISTORY_SCOPE_ID,
                  id,
                  valueType
                ),
              setDefault: (id, value) =>
                blueprintService?.setPersistentVariableDefault(
                  VARIABLE_PANEL_HISTORY_SCOPE_ID,
                  id,
                  value
                ),
              remove: (id) =>
                blueprintService?.deletePersistentVariable(VARIABLE_PANEL_HISTORY_SCOPE_ID, id)
            })
          )}
        </div>
      </div>

      {/* Present only while a scene editor is focused: with no scene there is no scope, so the
                section has nothing to be empty ABOUT and is dropped rather than shown blank.

                No `+` even then: a scene variable is declared with `/local` in the scene itself,
                which is also the only place it can be edited - so every row here is a way back to
                that line. */}
      {storyId && sceneId ? (
        <div className="flex flex-col gap-2">
          <SectionHeader title={t("storyVars.scene.title")} hint={t("storyVars.scene.hint")} />
          <div className="flex flex-col gap-1.5">
            {sceneRows.map((row) => (
              <VariableJumpRow
                key={row.id}
                name={row.name}
                valueType={row.valueType}
                onJump={() => jumpToDeclaration(row.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
