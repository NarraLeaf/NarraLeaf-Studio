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
    type ProjectBrandDocument,
} from "@shared/types/brand";
import { getActiveBrandPalette, setActiveBrandPalette, type BrandPalette } from "@shared/brand/brandRegistry";
import { insertLiveRecordBefore } from "@shared/live/config";
import type { LiveBrandOp } from "@shared/live/ops";
import { setActiveProjectFonts, setActiveProjectLocale } from "@shared/typography/projectFonts";
import {
    normalizeProjectFontStack,
    PROJECT_FONT_STACK_MAX,
    sameProjectFontStack,
    type ProjectFontEntry,
} from "@shared/types/typography";
import { LocalizationService } from "../localization/LocalizationService";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { Service } from "../Service";
import { Services, IBrandService, WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { UuidService } from "../core/UuidService";
import { EventEmitter } from "../ui/EventEmitter";

type BrandServiceEvents = {
    colorsChanged: BrandColor[];
    fontsChanged: ProjectFontEntry[];
    dirtyChanged: boolean;
};

/**
 * Somewhere a palette edit can go instead of into the document.
 *
 * The seam a live session hangs this table off; see `DlcOpSink`, which is the same bargain one
 * document along. With a sink installed an edit becomes an operation and the document is not
 * touched; the panel changes when the operation comes back as somebody's effect and
 * {@link BrandService.applyLiveOp} applies it.
 *
 * ⚠ **Offered by each mutator rather than by the two write paths they share.**
 * {@link BrandService.applyColorMutation} takes a whole-list closure and can state nothing finer
 * than "the palette is now this", and a colour's name is a blur-committed field.
 */
export type BrandOpSink = {
    /**
     * Take one operation, or decline it. True means the document must not be touched at all; false
     * is the ordinary answer outside a session.
     */
    handle(op: LiveBrandOp): boolean;
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
    /** Where palette edits go instead of into the document, when something else owns them. */
    private opSink: BrandOpSink | null = null;
    /** Unsubscribe from the localization config; see {@link watchProjectLocale}. */
    private stopLocaleWatch: (() => void) | null = null;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[BrandService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        const localizationService = ctx.services.get<LocalizationService>(Services.Localization);
        await depend([filesystemService, projectService, uuidService, localizationService]);
        await registerAutoSaver(ctx, depend, "brand", "workspace.shell.save.stores.brand", this.autoSaver);

        this.watchProjectLocale(localizationService);
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
        this.emitFontsChanged();
        return this.listColors();
    }

    public async save(document: ProjectBrandDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with the bare seeds.`,
            );
        }
        // This write supersedes whatever the timer was going to do.
        this.autoSaver.cancel();
        const updated: ProjectBrandDocument = {
            ...document,
            schemaVersion: BRAND_SCHEMA_VERSION,
            colors: normalizeProjectBrandColors(document.colors),
            fonts: normalizeProjectFontStack(document.fonts),
        };
        await saveDocument(brandSpec, this.storage(), brandSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
        this.emitColorsChanged();
        this.emitFontsChanged();
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
        return this.getDocument().colors.find(color => color.id === id);
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

    /**
     * The project's default font stack, in priority order. The array is a copy; edit through the
     * mutators.
     */
    public listFonts(): ProjectFontEntry[] {
        return [...this.getDocument().fonts];
    }

    public onFontsChanged(handler: (fonts: ProjectFontEntry[]) => void): () => void {
        return this.events.on("fontsChanged", handler);
    }

    /**
     * Append a font to the stack. Refuses one already on it, and refuses to grow past
     * {@link PROJECT_FONT_STACK_MAX}.
     *
     * Reported rather than silent, because the caller is a picker the author has just pressed a font
     * in: nothing happening on screen is indistinguishable from a control that does not work.
     */
    public addFont(assetId: string, locales?: readonly string[]): boolean {
        const id = assetId.trim();
        if (!id) {
            return false;
        }
        const fonts = this.getDocument().fonts;
        if (fonts.length >= PROJECT_FONT_STACK_MAX || fonts.some(entry => entry.assetId === id)) {
            return false;
        }
        const restriction = locales && locales.length > 0 ? { locales: [...locales] } : {};
        this.applyFontMutation(entries => [...entries, { assetId: id, ...restriction }]);
        return true;
    }

    /**
     * Restrict a rung to some languages, or - with an empty list - to none, which means all of them.
     *
     * Whole-list rather than add/remove one language at a time: the control is a set of checkboxes
     * whose state the author reads off the screen, so what it has to be able to say is "this is the
     * set now". An add/remove pair would make the same edit two writes and two undo steps.
     *
     * Answers false for a rung that is not on the stack, and for a restriction that is already what
     * was asked for - a write that changes nothing must not mark the document dirty or push a
     * revision that repaints every text widget in the project.
     */
    public setFontLocales(assetId: string, locales: readonly string[]): boolean {
        const entries = this.getDocument().fonts;
        const current = entries.find(entry => entry.assetId === assetId);
        if (!current) {
            return false;
        }
        const next = normalizeProjectFontStack([{ assetId, locales: [...locales] }])[0] ?? { assetId };
        if (sameProjectFontStack([current], [next])) {
            return false;
        }
        this.applyFontMutation(list => list.map(entry => (entry.assetId === assetId ? next : entry)));
        return true;
    }

    public removeFont(assetId: string): boolean {
        if (!this.getDocument().fonts.some(entry => entry.assetId === assetId)) {
            return false;
        }
        this.applyFontMutation(entries => entries.filter(entry => entry.assetId !== assetId));
        return true;
    }

    /**
     * Move a font one rung up (`-1`) or down (`+1`).
     *
     * By offset rather than to an index because the surface's control is a pair of arrows, and the
     * two ends have to be no-ops rather than wraps - a font already at the top pressed upwards must
     * not appear at the bottom, which is the one outcome the author cannot have meant.
     */
    public moveFont(assetId: string, offset: number): boolean {
        const entries = this.getDocument().fonts;
        const from = entries.findIndex(entry => entry.assetId === assetId);
        const to = from + offset;
        if (from < 0 || offset === 0 || to < 0 || to >= entries.length) {
            return false;
        }
        this.applyFontMutation(list => {
            const next = [...list];
            const [moving] = next.splice(from, 1);
            next.splice(to, 0, moving!);
            return next;
        });
        return true;
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
            value: input?.value?.trim() || NEW_BRAND_COLOR_VALUE,
        };
        if (this.offer({ op: "create-brand-color", color })) {
            // ⚠ Inside a session the colour handed back is NOT in the palette yet - it is what this
            // window has asked for, and it lands when the effect comes back.
            return color;
        }
        this.applyColorMutation(colors => [...colors, color]);
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
        const current = this.getColor(id);
        if (!current) {
            return;
        }
        const next = patchedColor(current, patch);
        if (this.offer({ op: "update-brand-color", colorId: id, color: next })) {
            return;
        }
        this.applyColorMutation(colors => colors.map(color => (color.id === id ? next : color)));
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
        if (this.offer({ op: "delete-brand-color", colorId: id })) {
            return true;
        }
        this.applyColorMutation(colors => colors.filter(color => color.id !== id));
        return true;
    }

    /** Move a colour to sit before `beforeId` in the stored order, or last when that is null. */
    public moveColor(id: string, beforeId: string | null): void {
        if (this.offer({ op: "move-brand-color", colorId: id, beforeId })) {
            return;
        }
        this.moveColorLocally(id, beforeId);
    }

    private moveColorLocally(id: string, beforeId: string | null): void {
        this.applyColorMutation(colors => {
            const moving = colors.find(color => color.id === id);
            if (!moving || beforeId === id) {
                return colors;
            }
            const rest = colors.filter(color => color.id !== id);
            const index = beforeId === null ? -1 : rest.findIndex(color => color.id === beforeId);
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
            colors: normalizeProjectBrandColors(document.colors),
            fonts: normalizeProjectFontStack(document.fonts),
        };
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.emitColorsChanged();
        this.emitFontsChanged();
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
        // The empty stack for the same reason the seeds are the palette's answer: it is what a
        // project that has chosen no default font holds, so a project closed here cannot leave
        // its typeface setting the next project's text for as long as that project's load takes.
        setActiveProjectFonts([]);
        // And the language it was resolved in, for the same reason and with the same
        // consequence: an empty one filters nothing, which is what an unpublished host reads.
        this.stopLocaleWatch?.();
        this.stopLocaleWatch = null;
        setActiveProjectLocale("");
    }

    /**
     * Keep the window's typography language in step with the project's source language.
     *
     * A rung of the stack may be restricted to some languages, so the stack has no resolved answer
     * without one - and the language the *editor* resolves in is the project's source language, the
     * one an author writes and previews in. That is the same call `resolveEditorAssetSetMember` makes
     * for pictures, and it is made here rather than in `LocalizationService` because this service is
     * already the one that publishes the project's typography to the module-level store; splitting
     * the two halves of one publish across two services is how they come to disagree.
     *
     * Subscribed rather than read once: changing the source language is a thing an author does early
     * on, and a stack still resolved in the old one would set the whole project in the wrong face
     * until the project was reopened.
     */
    private watchProjectLocale(localization: LocalizationService): void {
        this.stopLocaleWatch?.();
        setActiveProjectLocale(localization.getConfiguration().sourceLocale);
        this.stopLocaleWatch = localization.onConfigChanged(config => {
            setActiveProjectLocale(config.sourceLocale);
        });
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
     * {@link applyColorMutation} for the font stack. Same contract, same single entry point.
     *
     * ⚠ **This is where a live session intercepts the stack, and the colours are intercepted in
     * their mutators instead.** The asymmetry is the vocabulary's: the operation for the stack IS the
     * whole stack - four gestures all state a new order of at most a handful of rungs - so this point
     * can state it truthfully, where "the palette is now this" would be last-writer-wins over
     * somebody's half-typed colour name.
     */
    private applyFontMutation(mutator: (fonts: ProjectFontEntry[]) => ProjectFontEntry[]): void {
        const document = this.getDocument();
        const fonts = normalizeProjectFontStack(mutator([...document.fonts]));
        if (this.offer({ op: "set-brand-fonts", fonts })) {
            return;
        }
        document.fonts = fonts;
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.emitFontsChanged();
    }

    /* --------------------------------------------------------------- the live-session seam */

    /** Send palette edits somewhere else, or take them back. Null restores the ordinary behaviour. */
    public setOperationSink(sink: BrandOpSink | null): void {
        this.opSink = sink;
    }

    /**
     * The document as it stands, or null before it has been read.
     *
     * What a digest is taken over. Null rather than the throw {@link getDocument} makes, because the
     * caller is a fingerprint and "this window does not hold the palette" has to be hashable.
     */
    public liveDocument(): ProjectBrandDocument | null {
        return this.document;
    }

    /**
     * Apply one operation to the document, **without consulting the sink**.
     *
     * The other side of the seam. Every branch goes through one of the two mutation entries, so the
     * palette is re-normalized and published exactly as an ordinary edit publishes it - a colour that
     * reached the document without `setActiveBrandPalette` would be one the window does not paint
     * with until something unrelated repainted.
     *
     * **Nothing here enters this author's undo stack**; see `DlcService.applyLiveOp`.
     */
    public applyLiveOp(op: LiveBrandOp): void {
        switch (op.op) {
            case "create-brand-color": {
                const color = structuredClone(op.color) as BrandColor;
                this.applyColorMutation(colors => (colors.some(entry => entry.id === color.id)
                    // A creation for a colour already here is a retry that escaped the receipts.
                    ? colors.map(entry => (entry.id === color.id ? color : entry))
                    : insertLiveRecordBefore(colors, color, op.beforeId)));
                return;
            }
            case "update-brand-color": {
                if (!this.getColor(op.colorId)) {
                    // The host refuses an update naming a colour it cannot find, so reaching this is
                    // this machine having missed the creation. The digest on this effect reports it.
                    return;
                }
                const color = structuredClone(op.color) as BrandColor;
                this.applyColorMutation(colors => colors.map(entry => (entry.id === op.colorId ? color : entry)));
                return;
            }
            case "delete-brand-color":
                this.applyColorMutation(colors => colors.filter(entry => entry.id !== op.colorId));
                return;
            case "move-brand-color":
                this.moveColorLocally(op.colorId, op.beforeId);
                return;
            case "set-brand-fonts": {
                const fonts = structuredClone(op.fonts) as ProjectFontEntry[];
                const document = this.getDocument();
                document.fonts = normalizeProjectFontStack(fonts);
                this.revision += 1;
                this.setDirty(true);
                this.autoSaver.schedule();
                this.emitFontsChanged();
                return;
            }
            default: {
                // ⚠ The switch is exhaustive by construction, and this is what says so. A verb added
                // with no case here would be a silent no-op: the effect would land on every other
                // machine in the room and not on this one.
                const unapplied: never = op;
                return unapplied;
            }
        }
    }

    /** Hand one operation to the sink, or say that there is none. See {@link BrandOpSink}. */
    private offer(op: LiveBrandOp): boolean {
        return this.opSink?.handle(op) ?? false;
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
        const taken = new Set(this.getDocument().colors.map(color => color.id));

        for (let attempt = 0; ; attempt += 1) {
            const random = uuidService.generate(true).replace(/[^0-9a-z]/gi, "").toLowerCase();
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

    /** Publish first, then tell the subscribers - see {@link emitColorsChanged}. */
    private emitFontsChanged(): void {
        const fonts = this.listFonts();
        setActiveProjectFonts(fonts);
        this.events.emit("fontsChanged", fonts);
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

/**
 * `color` with a patch written over it - the record `updateColor` stores, and the one an operation
 * carries.
 *
 * Outside the class because both halves of that mutator read it: the operation must carry the same
 * record the local write would have produced, and a second spelling of these two rules is a colour
 * that reads one way in a session and another outside one.
 */
function patchedColor(color: BrandColor, patch: { name?: string; value?: string }): BrandColor {
    const next: BrandColor = { ...color };
    if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name) {
            next.name = name;
        } else {
            // Removed, not blanked. The normalizer drops an empty name anyway, and an explicit
            // `undefined` left on the record is what the canonical encoder refuses by name - the
            // colour the author just cleared would be the one that stops the file saving.
            delete next.name;
        }
    }
    // A blank value is ignored rather than written. An entry with nothing to paint is dropped by the
    // normalizer, so storing "" would turn "the author cleared the field while retyping" into "the
    // author's colour is gone".
    const value = patch.value?.trim();
    if (value) {
        next.value = value;
    }
    return next;
}
