/**
 * Project → App → Build variants: the editions the same project can be shipped as.
 *
 * Sits directly under the identity fields it varies, because every value a variant can state is one
 * of those fields: the release tag's row shows them read-only, and each variant below shows the same
 * three with whatever it says differently.
 *
 * **Inheritance is legible from the field itself.** A key the variant does not state is an empty
 * input showing the inherited value as its placeholder; a key it does state holds real text and
 * grows a Restore beside it. So "is this mine or the project's" is answerable without reading a
 * word, and Restore is exactly as reachable as the key it restores. What a variant *is* belongs to
 * the `appTags` help topic, not to a paragraph on this page.
 *
 * Built on `Accordion` like the audio buses beside it: a list of N of the same thing, one row each,
 * nothing expanded until the author asks.
 *
 * Deleting a variant does not rewrite what pointed at it - those references resolve to release from
 * then on - which is what the count beside Delete and the confirmation say before the author commits.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import { HelpTrigger } from "@/lib/help";
import { listUnreadableMechanisms, type UnreadableMechanism } from "@/lib/build/releaseContent";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Button, Input, Select, type SelectOption } from "@/lib/components/elements";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { Blueprint } from "@shared/types/blueprint/document";
import { listScenesInDocumentOrder } from "@shared/types/story";
import {
  APP_TAG_OVERRIDE_KEYS,
  countAppTagReferences,
  RELEASE_APP_TAG,
  resolveAppTagEndingSurface,
  resolveAppTagIdentity,
  type AppTagBaseIdentity,
  type AppTagOverrideKey,
  type ProjectAppTag
} from "@shared/types/appTag";
import { useWorkspace } from "../../../context";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * Same clamp the audio list needs, and for the same reason: `Accordion` owns the header's flex chain,
 * so a long variant name would otherwise push the sub-page into horizontal scroll from inside a
 * component this file cannot reach.
 */
const HEADER_WIDTH_CLAMP = "min-w-0 [&>button]:min-w-0 [&>button>span]:min-w-0";

/**
 * What points at one variant: everything, and the part of it that is written in the script.
 *
 * The two are separate because deleting a variant does two different things to them. Every reference
 * simply reads the release values from then on, which is the one number the row shows. A cut point is
 * a reference that also stops HAPPENING - the row stays in the scene and ends nothing - and the
 * confirmation has to say so before the author commits, which it cannot do from a total.
 */
type AppTagReferenceCount = { total: number; story: number };

/** One scene a declaration can name. Flat, because a declaration crosses stories. */
type DeclarableScene = { storyId: string; sceneId: string; label: string };

/** One page a variant can end on. */
type EndingPage = { id: string; name: string };

/** Whether two page lists would render the same picker. */
function sameSurfaces(a: readonly EndingPage[], b: readonly EndingPage[]): boolean {
  return (
    a.length === b.length &&
    a.every((page, index) => page.id === b[index].id && page.name === b[index].name)
  );
}

/** The pages a variant can name as its ending, as the picker lists them. */
function readSurfaces(context: WorkspaceContext): EndingPage[] {
  try {
    return (
      context.services.get<UIDocumentService>(Services.UIDocument).getDocument().surfaces ?? []
    ).map((surface) => ({ id: surface.id, name: surface.name }));
  } catch {
    return [];
  }
}

/**
 * What the project holds that a build cannot read, and the scenes a declaration may name.
 *
 * Loaded once per open rather than watched: a blueprint gaining a wired pin while this panel is on
 * screen is not a flow anyone has, and a watcher would re-read every story document on every
 * keystroke in the graph editor.
 */
async function loadMechanisms(context: WorkspaceContext): Promise<{
  mechanisms: UnreadableMechanism[];
  scenes: DeclarableScene[];
  surfaces: EndingPage[];
}> {
  const services = context.services;
  // The page list is watched separately, so the picker sees a page made while this panel is open.
  const surfaces = readSurfaces(context);
  let blueprints: Blueprint[] = [];
  try {
    const document = services.get<UIGraphService>(Services.UIGraph).getDocument().blueprintDocument;
    blueprints = Object.values(document?.blueprints ?? {});
  } catch {
    blueprints = [];
  }
  const listed = await getInterface().plugins.list();
  const plugins = listed.success
    ? listed.data.plugins
        .filter((plugin) => plugin.enabled && plugin.manifest.entries?.runtime)
        .map((plugin) => ({
          id: plugin.manifest.id,
          name: plugin.manifest.name ?? plugin.manifest.id,
          runtimeCapabilities: plugin.manifest.contributes.runtimeCapabilities ?? []
        }))
    : [];

  const mechanisms = listUnreadableMechanisms({ blueprints, plugins });
  if (mechanisms.length === 0) {
    // Nothing to declare, so nothing to read every story document for.
    return { mechanisms, scenes: [], surfaces };
  }

  const storyService = services.get<StoryService>(Services.Story);
  const scenes: DeclarableScene[] = [];
  for (const entry of storyService.getLibraryIndex().stories) {
    try {
      const document = await storyService.loadStory(entry.id);
      for (const scene of listScenesInDocumentOrder(document)) {
        scenes.push({
          storyId: entry.id,
          sceneId: scene.id,
          label: `${entry.name} / ${scene.name}`
        });
      }
    } catch {
      // A story that will not load reports itself elsewhere; the rest are still declarable.
    }
  }
  return { mechanisms, scenes, surfaces };
}

export function ProjectAppTagsSection({ config, uiService }: ProjectSectionProps) {
  const { t, tn } = useTranslation();
  const { context, isInitialized } = useWorkspace();
  const freeze = useFreezeGuard();

  const tagService = useMemo(() => {
    if (!context || !isInitialized) {
      return null;
    }
    return context.services.get<AppTagService>(Services.AppTags);
  }, [context, isInitialized]);

  const [tags, setTags] = useState<ProjectAppTag[]>([]);
  const [references, setReferences] = useState<Record<string, AppTagReferenceCount>>({});
  const [unreadable, setUnreadable] = useState<{
    mechanisms: UnreadableMechanism[];
    scenes: DeclarableScene[];
    surfaces: EndingPage[];
  }>({
    mechanisms: [],
    scenes: [],
    surfaces: []
  });
  /** Collapsed by default. A variant the author just created is the exception - they made it to name it. */
  const [openIds, setOpenIds] = useState<string[]>([]);

  useEffect(() => {
    if (!tagService) {
      setTags([]);
      return;
    }
    setTags(tagService.listTags());
    return tagService.onTagsChanged(setTags);
  }, [tagService]);

  useEffect(() => {
    if (!context || !isInitialized) {
      return;
    }
    let active = true;
    void loadMechanisms(context).then((loaded) => {
      if (active) {
        setUnreadable(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [context, isInitialized]);

  /**
   * The page list, kept current while this panel is open.
   *
   * Watched where the mechanisms above are not, because making the page and naming it here is one
   * flow: an author draws the demo's ending page, comes back, and the picker has to offer it. Only
   * the id and name are read, and an unchanged list is dropped before it can re-render, so this
   * costs a walk of the surface array per edit rather than a re-read of the project.
   */
  useEffect(() => {
    if (!context || !isInitialized) {
      return;
    }
    const uiDocument = context.services.get<UIDocumentService>(Services.UIDocument);
    return uiDocument.onDocumentChanged(() => {
      const surfaces = readSurfaces(context);
      setUnreadable((current) =>
        sameSurfaces(current.surfaces, surfaces) ? current : { ...current, surfaces }
      );
    });
  }, [context, isInitialized]);

  /**
   * The project's own identity - what a variant that states nothing resolves to.
   *
   * Read from the config this page is already showing rather than from the service, so an edit to
   * the name field above is reflected in every variant's placeholder in the same render.
   */
  const base = useMemo<AppTagBaseIdentity>(
    () => ({
      displayName: config.name?.trim() ?? "",
      identifier: config.identifier?.trim() ?? "",
      version: config.metadata?.version?.trim() ?? ""
    }),
    [config.identifier, config.metadata?.version, config.name]
  );

  /** The project's own ending page. See the note on `tags` for why an empty list means "not read yet". */
  const projectEndingSurfaceId = useMemo(
    () => (tags.length > 0 ? (tagService?.getProjectEndingSurfaceId() ?? "") : ""),
    [tagService, tags]
  );

  // Recomputed when the id set changes rather than on every keystroke: renaming a variant or
  // editing one of its overrides cannot change how many things point at it, and re-reading every
  // story document per character typed would be a scan per frame.
  // JSON rather than a delimiter join: an id is only trimmed, not restricted, so any separator
  // could in principle appear inside one and split a single tag into two.
  const tagIdKey = JSON.stringify(tags.map((tag) => tag.id));
  useEffect(() => {
    if (!context || !isInitialized) {
      return;
    }
    let active = true;
    void (async () => {
      const counts = await countReferences(context, JSON.parse(tagIdKey) as string[]);
      if (active) {
        setReferences(counts);
      }
    })();
    return () => {
      active = false;
    };
  }, [context, isInitialized, tagIdKey]);

  // Filtered rather than pruned in an effect: a deleted variant's id would otherwise sit in the
  // open set and re-open a later tag that happened to be handed the same id.
  const openItems = useMemo(() => {
    const known = new Set(tags.map((tag) => tag.id));
    return openIds.filter((id) => known.has(id));
  }, [openIds, tags]);

  const addTag = useCallback(() => {
    // The same name every time on purpose - the service numbers it, so pressing Add twice gives
    // two variants an author can tell apart rather than two rows reading "New Variant".
    const created = tagService?.createTag({ name: t("project.appTags.newTagName") });
    if (created) {
      setOpenIds((prev) => [...prev, created.id]);
    }
  }, [t, tagService]);

  const removeTag = useCallback(
    async (tag: ProjectAppTag) => {
      if (!tagService) {
        return;
      }
      const uses = references[tag.id]?.total ?? 0;
      const cuts = references[tag.id]?.story ?? 0;
      // The variant those references fall back to, read off the model rather than written into the
      // sentence, so the copy follows a rename.
      const fallback = { name: RELEASE_APP_TAG.name };
      // Two sentences when the script has cut points naming this variant: what happens to every
      // reference, and then what happens to those rows, which is not the same thing. They are kept,
      // and a kept cut point that names nothing ends nothing.
      const detail =
        cuts > 0
          ? `${tn("project.appTags.deleteDetail", uses, fallback)} ${tn("project.appTags.deleteDetailCuts", cuts)}`
          : tn("project.appTags.deleteDetail", uses, fallback);
      const confirmed = await uiService?.showDestructiveConfirm(
        t("project.appTags.deleteConfirm", { name: tag.name }),
        detail,
        t("project.appTags.delete")
      );
      if (confirmed) {
        tagService.deleteTag(tag.id);
      }
    },
    [references, t, tagService, tn, uiService]
  );

  return (
    <SettingsGroup
      title={t("project.group.appTags")}
      helpTopic="appTags"
      trailing={
        <>
          <HelpTrigger topic="appTags" />
          <Button size="sm" onClick={addTag} {...freeze.writes(!tagService)} className="shrink-0">
            <Plus className="h-3.5 w-3.5" />
            {t("project.appTags.add")}
          </Button>
        </>
      }
    >
      {/* The top rule is the list's own edge: every row carries a bottom hairline, so without
                it the list is bounded below and open above. */}
      <div className="min-w-0 border-t border-edge">
        <Accordion className="min-w-0" multiple openItems={openItems} onOpenChange={setOpenIds}>
          {tags.map((tag) => (
            <TagItem
              key={tag.id}
              tag={tag}
              base={base}
              projectEndingSurfaceId={projectEndingSurfaceId}
              service={tagService}
              uses={references[tag.id]?.total ?? 0}
              mechanisms={unreadable.mechanisms}
              scenes={unreadable.scenes}
              surfaces={unreadable.surfaces}
              onDelete={() => void removeTag(tag)}
            />
          ))}
        </Accordion>
      </div>
    </SettingsGroup>
  );
}

/**
 * One variant: its name on the collapsed row, its three keys behind the disclosure.
 *
 * The release tag renders the same three keys read-only. It is not a variant - it is what the
 * variants are read against - so it has no name field, no Restore and no Delete, and the values it
 * shows are the fields higher up this same page.
 */
function TagItem({
  tag,
  base,
  projectEndingSurfaceId,
  service,
  uses,
  mechanisms,
  scenes,
  surfaces,
  onDelete
}: {
  tag: ProjectAppTag;
  base: AppTagBaseIdentity;
  /** The project's own declared addresses - what a variant that states none opens. */
  /** The project's own ending page - what a variant that states none ends on. */
  projectEndingSurfaceId: string;
  service: AppTagService | null;
  uses: number;
  mechanisms: readonly UnreadableMechanism[];
  scenes: readonly DeclarableScene[];
  surfaces: readonly EndingPage[];
  onDelete: () => void;
}) {
  const { t, tn } = useTranslation();
  const freeze = useFreezeGuard();
  const frozen = freeze.writes(!service);

  const identity = useMemo(() => resolveAppTagIdentity(tag, base), [base, tag]);
  const ending = useMemo(
    () => resolveAppTagEndingSurface(tag, projectEndingSurfaceId),
    [projectEndingSurfaceId, tag]
  );

  return (
    <AccordionItem
      id={tag.id}
      className="min-w-0"
      headerClassName={HEADER_WIDTH_CLAMP}
      contentClassName="min-w-0"
      headerProps={{
        // The row's handle: verification, and anything that later has to find a variant on
        // screen, reads this rather than matching a translated label.
        "data-app-tag": tag.id
      }}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-fg">{tag.name}</span>
        </span>
      }
    >
      {/*
       * `Accordion` listens for Enter/Space on `window` to toggle the focused row and only
       * exempts real input elements, so the two keys are stopped here for everything else in
       * the body. Scoped to those two, so application keybindings still reach the window.
       */}
      <div
        className="grid gap-2.5 bg-fill-subtle px-3 py-2.5 [&>*]:min-w-0"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
          }
        }}
      >
        {tag.builtin ? null : (
          <Field label={t("project.appTags.nameTitle")}>
            <CommittedInput
              value={tag.name}
              disabled={frozen.disabled}
              label={t("project.appTags.nameTitle")}
              handle={`${tag.id}:name`}
              onCommit={(name) => service?.renameTag(tag.id, name)}
            />
          </Field>
        )}

        {APP_TAG_OVERRIDE_KEYS.map((key) => (
          <OverrideField
            key={key}
            tagId={tag.id}
            overrideKey={key}
            label={t(`project.appTags.fields.${key}`)}
            inherited={base[key]}
            stated={tag.overrides[key]}
            readOnly={tag.builtin === true}
            value={identity[key].value}
            disabled={frozen.disabled}
            service={service}
          />
        ))}

        {/* Absent in a project where nothing can start a scene the build cannot read, which
                    is most of them. A part that cannot have content is not content. */}
        {mechanisms.length === 0 ? null : (
          <div className="grid gap-2 border-t border-edge pt-2">
            <span className="text-2xs font-medium text-fg-muted">
              {t("project.appTags.reachableTitle")}
            </span>
            {mechanisms.map((mechanism) => (
              <MechanismField
                key={mechanism.mechanismKey}
                tag={tag}
                mechanism={mechanism}
                scenes={scenes}
                service={service}
                disabled={frozen.disabled}
              />
            ))}
          </div>
        )}
        {/* Editable on the release row too, unlike the identity keys above: the
                    project's own choice has no field higher up the page to be read from. */}
        <EndingField
          tagId={tag.id}
          label={t("project.appTags.ending.title")}
          surfaceId={ending.value}
          overridden={ending.overridden}
          surfaces={surfaces}
          disabled={frozen.disabled}
          service={service}
        />

        {tag.builtin ? null : (
          <div className="flex min-w-0 items-center justify-between gap-2 border-t border-edge pt-2">
            <span className="min-w-0 truncate text-2xs text-fg-subtle">
              {tn("project.appTags.usedBy", uses)}
            </span>
            <span className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={onDelete}
                {...freeze.writes(!service)}
                className="px-1.5 hover:text-danger"
                data-app-tag-delete={tag.id}
              >
                {t("project.appTags.delete")}
              </Button>
            </span>
          </div>
        )}
      </div>
    </AccordionItem>
  );
}

/**
 * What one mechanism can start under one variant.
 *
 * A scene list and nothing else. There is deliberately no "any scene" box: an author who could tick
 * one would tick it once and every later demo would carry the whole story with nothing on screen
 * saying so. Ticking nothing is a real answer - this mechanism starts nothing in this variant - and
 * it is what a demo says about the chapter select the main build uses.
 *
 * The release row edits the project's own list, which every variant inherits. It stores nothing of
 * its own, so there is nowhere else for its answer to go, and that is the same rule a `global`-scoped
 * plugin field follows.
 */
function MechanismField({
  tag,
  mechanism,
  scenes,
  service,
  disabled
}: {
  tag: ProjectAppTag;
  mechanism: UnreadableMechanism;
  scenes: readonly DeclarableScene[];
  service: AppTagService | null;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const key = mechanism.mechanismKey;
  const stated = tag.builtin ? undefined : tag.reachableScenes?.[key];
  const effective = service?.resolveReachableScenes(tag.id)[key];
  const ticked = useMemo(
    () => new Set((effective ?? []).map((scene) => `${scene.storyId}:${scene.sceneId}`)),
    [effective]
  );

  const toggle = (scene: DeclarableScene) => {
    const pair = `${scene.storyId}:${scene.sceneId}`;
    const next = ticked.has(pair)
      ? (effective ?? []).filter((entry) => `${entry.storyId}:${entry.sceneId}` !== pair)
      : [...(effective ?? []), { storyId: scene.storyId, sceneId: scene.sceneId }];
    service?.setDeclaredScenes(tag.id, key, next);
  };

  return (
    <Field
      label={mechanism.location}
      trailing={
        stated === undefined ? undefined : (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => service?.clearDeclaredScenes(tag.id, key)}
            className="h-auto px-1 py-0 text-2xs"
          >
            {t("project.appTags.restore")}
          </Button>
        )
      }
    >
      {/* Capped rather than growing: a real project holds dozens of scenes, and the rows below
                this one have to stay reachable. */}
      <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-edge bg-surface px-2 py-1.5">
        {scenes.map((scene) => (
          <label
            key={`${scene.storyId}:${scene.sceneId}`}
            className="flex cursor-pointer items-center gap-2"
          >
            <input
              type="checkbox"
              className="rounded-sm"
              checked={ticked.has(`${scene.storyId}:${scene.sceneId}`)}
              disabled={disabled}
              onChange={() => toggle(scene)}
            />
            <span className="min-w-0 truncate text-2xs text-fg">{scene.label}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

/**
 * One key of one variant.
 *
 * The input holds the variant's own value when it has one and is empty when it does not, with the
 * inherited value as the placeholder - so the field says which of the two it is showing without a
 * second control saying it. Restore appears only where there is something to restore, which makes it
 * the marker as well as the action.
 */
function OverrideField({
  tagId,
  overrideKey,
  label,
  inherited,
  stated,
  readOnly,
  value,
  disabled,
  service
}: {
  tagId: string;
  overrideKey: AppTagOverrideKey;
  label: string;
  inherited: string;
  stated: string | undefined;
  readOnly: boolean;
  value: string;
  disabled: boolean;
  service: AppTagService | null;
}) {
  const { t } = useTranslation();

  if (readOnly) {
    return (
      <Field label={label}>
        <div
          className="min-h-7 min-w-0 truncate rounded-md border border-edge bg-surface-raised px-2 py-1 text-xs text-fg-muted"
          data-app-tag-value={`${tagId}:${overrideKey}`}
        >
          {value}
        </div>
      </Field>
    );
  }

  return (
    <Field
      label={label}
      trailing={
        stated === undefined ? null : (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => service?.clearOverride(tagId, overrideKey)}
            className="px-1.5"
            data-app-tag-restore={`${tagId}:${overrideKey}`}
          >
            {t("project.appTags.restore")}
          </Button>
        )
      }
    >
      <CommittedInput
        value={stated ?? ""}
        placeholder={inherited}
        disabled={disabled}
        label={label}
        handle={`${tagId}:${overrideKey}`}
        allowEmpty
        onCommit={(next) => service?.setOverride(tagId, overrideKey, next)}
      />
    </Field>
  );
}

/**
 * The page one variant shows when its story falls off the end.
 *
 * One value rather than a list, read exactly as the identity keys are: the row shows what is in
 * force, and Restore appears only when this variant is the reason for it.
 *
 * **"Show nothing" is an option in the list, not the absence of a choice.** It is a real answer - a
 * demo whose cut point is its ending may want the last frame left on screen - and it has to be
 * distinguishable from inheriting, which is what Restore goes back to. Picking it on the release row
 * is the project saying its builds end on nothing, which is what every project did before this
 * field existed.
 *
 * A page the project no longer has stays selected and shows as its id. The alternative is a picker
 * that silently reads as "show nothing" for a variant that names a deleted page, which is the one
 * reading an author cannot tell from a page they never picked.
 */
function EndingField({
  tagId,
  label,
  surfaceId,
  overridden,
  surfaces,
  disabled,
  service
}: {
  tagId: string;
  label: string;
  surfaceId: string;
  overridden: boolean;
  surfaces: readonly EndingPage[];
  disabled: boolean;
  service: AppTagService | null;
}) {
  const { t } = useTranslation();

  const options = useMemo<SelectOption[]>(() => {
    const known = surfaces.map((surface) => ({ value: surface.id, label: surface.name }));
    const missing =
      surfaceId && !surfaces.some((surface) => surface.id === surfaceId)
        ? [{ value: surfaceId, label: surfaceId }]
        : [];
    return [{ value: "", label: t("project.appTags.ending.none") }, ...known, ...missing];
  }, [surfaceId, surfaces, t]);

  return (
    <Field
      label={label}
      trailing={
        !overridden ? null : (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => service?.clearEndingSurface(tagId)}
            className="px-1.5"
            data-app-tag-ending-restore={tagId}
          >
            {t("project.appTags.restore")}
          </Button>
        )
      }
    >
      {/* The handle is on a wrapper rather than on `Select`, which destructures a fixed prop
                list and would drop a data attribute silently - the very trap its `aria-label` note
                documents. */}
      <div className="min-w-0" data-app-tag-ending={tagId}>
        <Select
          size="sm"
          fullWidth
          portalMenu
          className="min-w-0"
          options={options}
          value={surfaceId}
          disabled={disabled}
          ariaLabel={label}
          onChange={(value) => service?.setEndingSurface(tagId, String(value))}
        />
      </div>
    </Field>
  );
}

/**
 * A labelled field inside a variant.
 *
 * A `div` rather than a `label`, for the reason the audio list documents: wrapping a control whose
 * trigger is a button in a `label` makes the click that operates it fire twice.
 */
function Field({
  label,
  trailing,
  children
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1 [&>*]:min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-2xs font-medium text-fg-muted">{label}</span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/**
 * Committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: the service trims what it is given and treats blank as "clear this key", so a
 * per-keystroke commit would delete the override the moment the author selected the text to retype
 * it, and would eat the space they typed in the middle of a name.
 *
 * `allowEmpty` separates the two things a blank field can mean. On an override it is the author
 * saying "inherit this again" and the service is told. On the name it is a value the service refuses,
 * and telling it would leave the field showing a blank the model never accepted - so the field puts
 * the stored name back instead.
 */
function CommittedInput({
  value,
  placeholder,
  disabled,
  label,
  handle,
  allowEmpty = false,
  onCommit
}: {
  value: string;
  placeholder?: string;
  disabled: boolean;
  label: string;
  /** `<tagId>:name` or `<tagId>:<override key>` - what verification finds this field by. */
  handle: string;
  allowEmpty?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next !== value && (allowEmpty || next)) {
      onCommit(next);
    } else {
      setDraft(value);
    }
  }, [allowEmpty, draft, onCommit, value]);

  return (
    <Input
      size="sm"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      className="w-full min-w-0"
      data-app-tag-field={handle}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * How many stored references each variant has.
 *
 * **Exactly three document sets are swept**: every story document, the interface blueprints
 * (`UIGraphService`) and the interface document (`UIDocumentService`). That is complete rather than
 * partial, because there is one place a variant can be named - the `appTag` command slot, which
 * lives in a story row - and the other two are swept because a blueprint node or a widget prop is
 * where the next holder would appear. Nothing else in the project can hold an `appTagId` today.
 *
 * **A holder added anywhere else has to be added here**, or the number beside Delete under-reports
 * and an author strands references it told them did not exist. Characters, assets metadata, the
 * variable registry, voice, localization and the `.nlproj` are deliberately not swept, and each of
 * them becoming a holder is a change to this function.
 *
 * Reads the in-memory documents rather than the files, so the count reflects unsaved edits - the same
 * reason `ReferenceService` is renderer-side. A story that has never been opened is loaded here;
 * failures are skipped rather than propagated, because an unreadable story is already reported
 * elsewhere and must not leave this surface without a number.
 */
async function countReferences(
  context: WorkspaceContext,
  tagIds: readonly string[]
): Promise<Record<string, AppTagReferenceCount>> {
  const storyRoots: unknown[] = [];
  try {
    const storyService = context.services.get<StoryService>(Services.Story);
    for (const entry of storyService.listStories()) {
      const document = await storyService.loadStory(entry.id).catch(() => null);
      if (document) {
        storyRoots.push(document);
      }
    }
  } catch {
    // The story library is not loaded in every context this panel can mount in.
  }
  const otherRoots: unknown[] = [];
  // Each in its own guard: a document service that has not loaded contributes nothing rather than
  // costing the surface the counts the others could have provided.
  try {
    otherRoots.push(context.services.get<UIGraphService>(Services.UIGraph).getDocument());
  } catch {
    /* not loaded */
  }
  try {
    otherRoots.push(context.services.get<UIDocumentService>(Services.UIDocument).getDocument());
  } catch {
    /* not loaded */
  }

  // Two sweeps rather than one, because the confirmation says two different things: how many
  // references in total stop naming this variant, and - separately - how many rows in the script
  // stay written and stop taking effect. Only the story documents can hold the second kind.
  const story = countAppTagReferences(storyRoots, tagIds);
  const rest = countAppTagReferences(otherRoots, tagIds);
  const counts: Record<string, AppTagReferenceCount> = {};
  for (const id of tagIds) {
    counts[id] = { total: (story[id] ?? 0) + (rest[id] ?? 0), story: story[id] ?? 0 };
  }
  return counts;
}
