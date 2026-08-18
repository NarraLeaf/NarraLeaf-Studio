import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { brandSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
  BRAND_SCHEMA_VERSION,
  BUILTIN_BRAND_COLORS,
  createEmptyProjectBrandDocument,
  isBuiltinBrandColorId,
  normalizeProjectBrandColors,
  type BrandColor,
  type ProjectBrandDocument
} from "@shared/types/brand";
import {
  getActiveBrandPalette,
  setActiveBrandPalette,
  type BrandPalette
} from "@shared/brand/brandRegistry";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IBrandService, WorkspaceContext } from "../services";
import {
  DEFAULT_AUTOSAVE_DELAY_MS,
  DEFAULT_AUTOSAVE_MAX_WAIT_MS,
  DebouncedSaver
} from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";

type BrandServiceEvents = {
  colorsChanged: BrandColor[];
  dirtyChanged: boolean;
};

/**
 * What a brand-new author colour is worth before they have picked anything.
 *
 * White rather than a shade of the brand: a new swatch that already looks like `primary` reads as
 * "this did something", and the author would have to notice it did not. A blank-looking swatch is
 * the one that asks to be filled in.
 */
const NEW_BRAND_COLOR_VALUE = "#FFFFFF";

/**
 * The project's palette. Owns `editor/brand.json`.
 *
 * Mirrors {@link AudioTrackService} and {@link VariableRegistryService} - one project JSON, seeded
 * from absence, revision + debounced autosave, change events, and the same refuse-to-overwrite latch
 * - because a palette is the same class of thing: a small project-level table that many editors
 * reference and version control has to see row by row.
 *
 * The one thing it does that its siblings do not is **publish**. Every colour field in Studio reads
 * the module-level active palette rather than this service (threading a palette through a hundred
 * inspectors is not an option), so every path that changes the list also pushes it to
 * `setActiveBrandPalette`. That push is content-compared upstream, so pushing on every emit costs
 * nothing when nothing moved.
 *
 * Every mutation goes through {@link applyColorMutation}, which re-normalizes: no caller can leave a
 * duplicate id, a missing seed or an unpaintable row in memory, so the invariants the resolvers rely
 * on hold between saves and not only across them.
 */
export class BrandService extends Service<BrandService> implements IBrandService {
  private document: ProjectBrandDocument | null = null;
  /**
   * Set when `editor/brand.json` is on disk but could not be parsed, and never cleared until a load
   * succeeds. Everything else carries on - a project with one broken document still has to open -
   * but {@link save} refuses while it is set: the in-memory list is the bare seed, and writing that
   * over the file would turn "unreadable" into "the author's colours are gone".
   */
  private unreadable: DocumentCorruptError | null = null;
  private readonly events = new EventEmitter<BrandServiceEvents>();
  private dirty = false;
  private revision = 0;
  private readonly autoSaver = new DebouncedSaver({
    delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
    maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
    save: () => this.save(this.getDocument()),
    onError: (err) => console.warn("[BrandService] auto-save failed", err)
  });

  protected async init(
    ctx: WorkspaceContext,
    depend: (services: Service[]) => Promise<void>
  ): Promise<void> {
    const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
    const projectService = ctx.services.get<ProjectService>(Services.Project);
    const uuidService = ctx.services.get<UuidService>(Services.Uuid);
    await depend([filesystemService, projectService, uuidService]);
    await registerAutoSaver(
      ctx,
      depend,
      "brand",
      "workspace.shell.save.stores.brand",
      this.autoSaver
    );

    await this.load();
  }

  public async load(): Promise<BrandColor[]> {
    const result = await loadDocument(brandSpec, this.storage(), brandSpec.pathFor());
    // Both cleared before the branch, not inside it: these services are singletons that re-init
    // on a project switch, and either one carried over would be the previous project speaking for
    // this one - a latch left set makes the next project's first save refuse, and a revision left
    // high is a number the canvas subscribers of a fresh project start counting from.
    this.unreadable = null;
    this.revision = 0;

    if (result.status === "missing") {
      // Written on first open rather than lazily, so version control has the palette from the
      // moment the project is opened rather than from the first colour the author touches -
      // the same trade `VariableRegistryService` makes, and for the same reason: a document
      // that appears out of nowhere three commits later is a diff nobody can explain.
      await this.save(createEmptyProjectBrandDocument());
      return this.listColors();
    }

    if (result.status === "corrupt") {
      // Reported and survived, not thrown: this runs inside `init`, and throwing here is how
      // one unreadable document stops the whole project from opening.
      this.unreadable = result.error;
      this.document = createEmptyProjectBrandDocument();
      reportUnreadableDocument(this.getContext(), result);
    } else {
      this.document = result.document;
    }

    this.setDirty(false);
    this.emitColorsChanged();
    return this.listColors();
  }

  public async save(document: ProjectBrandDocument): Promise<void> {
    if (this.unreadable) {
      throw new RendererError(
        `Refusing to write ${this.unreadable.path}: it is on disk but could not be read ` +
          `(${this.unreadable.reason}), so anything written now would replace it with the bare seeds.`
      );
    }
    // This write supersedes whatever the timer was going to do.
    this.autoSaver.cancel();
    const updated: ProjectBrandDocument = {
      ...document,
      schemaVersion: BRAND_SCHEMA_VERSION,
      colors: normalizeProjectBrandColors(document.colors)
    };
    await saveDocument(brandSpec, this.storage(), brandSpec.pathFor(), updated);
    this.document = updated;
    this.setDirty(false);
    this.emitColorsChanged();
  }

  public getDocument(): ProjectBrandDocument {
    if (!this.document) {
      throw new RendererError("Brand palette not initialized");
    }
    return this.document;
  }

  /** Every colour, seeds first. The array is a copy; edit through the mutators. */
  public listColors(): BrandColor[] {
    return [...this.getDocument().colors];
  }

  public getColor(id: string): BrandColor | undefined {
    return this.getDocument().colors.find((color) => color.id === id);
  }

  /**
   * The resolved palette, for a panel that wants to draw what an id paints as.
   *
   * Deliberately the module-level palette rather than a second one built from this document. There
   * is one right answer to "what colour is `button.primary`" per window, and a palette this service
   * kept privately could differ from the one the canvas is painting from for as long as it took
   * anyone to notice - a class of bug with no symptom other than two swatches disagreeing.
   */
  public getPalette(): BrandPalette {
    return getActiveBrandPalette();
  }

  /** Write out anything the auto-save timer still owes, and wait for it. */
  public async flushPendingChanges(): Promise<void> {
    await this.autoSaver.flush();
  }

  public onColorsChanged(handler: (colors: BrandColor[]) => void): () => void {
    return this.events.on("colorsChanged", handler);
  }

  public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
    return this.events.on("dirtyChanged", handler);
  }

  public isDirty(): boolean {
    return this.dirty;
  }

  public getRevision(): number {
    return this.revision;
  }

  /**
   * A new colour of the author's own, appended after the seeds.
   *
   * **No invented name.** A seeded slot has a translated default the panel supplies; an author's
   * colour has no such thing, so a name made up here would be an English word written into a
   * versioned document that a zh project then reads back verbatim - the exact failure
   * `@shared/types/brand` documents for the seeds. A caller that wants a default passes one.
   */
  public createColor(input?: { name?: string; value?: string }): BrandColor {
    const name = input?.name?.trim();
    const color: BrandColor = {
      id: this.generateColorId(),
      ...(name ? { name } : {}),
      value: input?.value?.trim() || NEW_BRAND_COLOR_VALUE
    };
    this.applyColorMutation((colors) => [...colors, color]);
    return this.getColor(color.id) ?? color;
  }

  /** Rename. Blank is refused rather than stored, because a nameless row is a row with no label. */
  public renameColor(id: string, name: string): boolean {
    const next = name.trim();
    if (!next || !this.getColor(id)) {
      return false;
    }
    this.updateColor(id, { name: next });
    return true;
  }

  /**
   * Patch one colour. `id` and `builtin` are not patchable: the id is what every stored link holds,
   * and `builtin` is derived from it on every load.
   *
   * A seeded slot is patchable like any other - re-pointing `button.primary` is the whole feature.
   */
  public updateColor(id: string, patch: { name?: string; value?: string }): void {
    this.applyColorMutation((colors) =>
      colors.map((color) => {
        if (color.id !== id) {
          return color;
        }
        const next: BrandColor = { ...color };
        if (patch.name !== undefined) {
          const name = patch.name.trim();
          if (name) {
            next.name = name;
          } else {
            // Removed, not blanked. The normalizer drops an empty name anyway, and an
            // explicit `undefined` left on the record is what the canonical encoder refuses
            // by name - the colour the author just cleared would be the one that stops the
            // file saving.
            delete next.name;
          }
        }
        // A blank value is ignored rather than written. An entry with nothing to paint is dropped
        // by the normalizer, so storing "" would turn "the author cleared the field while
        // retyping" into "the author's colour is gone".
        const value = patch.value?.trim();
        if (value) {
          next.value = value;
        }
        return next;
      })
    );
  }

  /**
   * Delete an author's colour. Refuses the seeded slots outright - they are what the control
   * appearances point at and what the panel's accordions are built from, so they exist at all
   * times; the normalizer would put a deleted one straight back anyway, and a delete that silently
   * does nothing is worse than one that says no.
   *
   * Links pointing at the deleted colour are NOT rewritten. They resolve to null and are reported
   * by lint, which is why the surface counts the references and says how many before the author
   * presses the button rather than quietly repointing them at something they did not choose.
   */
  public deleteColor(id: string): boolean {
    if (isBuiltinBrandColorId(id) || !this.getColor(id)) {
      return false;
    }
    this.applyColorMutation((colors) => colors.filter((color) => color.id !== id));
    return true;
  }

  /** Move a colour to sit before `beforeId` in the stored order, or last when that is null. */
  public moveColor(id: string, beforeId: string | null): void {
    this.applyColorMutation((colors) => {
      const moving = colors.find((color) => color.id === id);
      if (!moving || beforeId === id) {
        return colors;
      }
      const rest = colors.filter((color) => color.id !== id);
      const index = beforeId === null ? -1 : rest.findIndex((color) => color.id === beforeId);
      if (index < 0) {
        return [...rest, moving];
      }
      rest.splice(index, 0, moving);
      return rest;
    });
  }

  /** Replace the whole document (history restore). Sets, publishes and emits without touching history. */
  public replaceDocument(document: ProjectBrandDocument): void {
    this.document = {
      schemaVersion: BRAND_SCHEMA_VERSION,
      colors: normalizeProjectBrandColors(document.colors)
    };
    this.revision += 1;
    this.setDirty(true);
    this.autoSaver.schedule();
    this.emitColorsChanged();
  }

  /**
   * Hand the window back the built-in palette.
   *
   * The active palette is module-level and outlives this service's context, so a project closed
   * without this would leave its brand painting the next project that opens, for as long as it took
   * that project's own document to load. The seeds are the right thing to fall back to for the same
   * reason they are what an unpublished host reads.
   */
  public dispose(): void {
    setActiveBrandPalette(BUILTIN_BRAND_COLORS);
  }

  /** The single mutation entry - mutate the list, re-normalize, bump, mark dirty, autosave, publish. */
  private applyColorMutation(mutator: (colors: BrandColor[]) => BrandColor[]): void {
    const document = this.getDocument();
    document.colors = normalizeProjectBrandColors(mutator([...document.colors]));
    this.revision += 1;
    this.setDirty(true);
    this.autoSaver.schedule();
    this.emitColorsChanged();
  }

  /**
   * A short id for an author's own colour.
   *
   * **Generated, never derived from the name.** Links are stored by id, so an id that followed the
   * name would break every link the moment the author renamed the colour - the one thing the whole
   * protocol promises cannot happen.
   *
   * The shape is a leading letter plus hex, which is inside the grammar `@shared/brand/brandLink`
   * accepts (each segment starting lower-case, at most one dot) - the leading `c` is there because
   * a bare UUID may start with a digit, which that grammar rejects. Seven hex digits is short enough
   * to read in a diff and, against the handful of colours a palette holds, far past the point where
   * a collision is what anyone should worry about; the loop is for correctness, not for odds.
   *
   * The attempt suffix is what makes the loop terminate rather than merely be unlikely to spin: a
   * generator that returns the same bytes every time still produces a fresh id on each pass, so the
   * worst case is bounded by the number of colours already taken.
   */
  private generateColorId(): string {
    const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
    const taken = new Set(this.getDocument().colors.map((color) => color.id));

    for (let attempt = 0; ; attempt += 1) {
      const random = uuidService
        .generate(true)
        .replace(/[^0-9a-z]/gi, "")
        .toLowerCase();
      const id = `c${random.slice(0, 7)}${attempt > 0 ? attempt.toString(36) : ""}`;
      if (!taken.has(id)) {
        return id;
      }
    }
  }

  /**
   * Publish first, then tell the subscribers.
   *
   * In that order because a subscriber that re-reads a colour during its own handler has to see the
   * palette the event is about; the other way round it would read the previous one and paint a
   * frame behind.
   */
  private emitColorsChanged(): void {
    const colors = this.listColors();
    setActiveBrandPalette(colors);
    this.events.emit("colorsChanged", colors);
  }

  private setDirty(value: boolean): void {
    if (this.dirty === value) {
      return;
    }
    this.dirty = value;
    this.events.emit("dirtyChanged", value);
  }

  private storage(): DocumentStorage {
    return createProjectDocumentStorage(this.getContext());
  }
}
