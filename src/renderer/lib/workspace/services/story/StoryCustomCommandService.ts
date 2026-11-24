import { loadDocument, saveDocument, type DocumentStorage } from "@shared/documents/documentIo";
import { storyCommandsSpec } from "@shared/documents/specs";
import type { DocumentCorruptError } from "@shared/documents/types";
import { RendererError } from "@shared/utils/error";
import {
    createEmptyStoryCustomCommandDocument,
    customCommandLibrary,
    customCommandNameProblem,
    foldCustomCommandName,
    normalizeStoryCustomCommandDocument,
    type StoryCustomCommandLibrary,
} from "@shared/story/customCommands";
import {
    STORY_CUSTOM_COMMAND_SCHEMA_VERSION,
    type StoryCustomCommand,
    type StoryCustomCommandDocument,
} from "@shared/types/story/customCommands";
import { publishCustomStoryCommands } from "@/apps/workspace/modules/story/scene-editor/commands/customCommands";
import { createProjectDocumentStorage } from "../core/DocumentStorage";
import { storeWrite } from "../autosave/writeReport";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { Service } from "../Service";
import { Services, type IStoryCustomCommandService, type WorkspaceContext } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver, reportUnreadableDocument } from "../autosave/SaveStatusService";
import { EventEmitter } from "../ui/EventEmitter";

type StoryCustomCommandServiceEvents = {
    /** A command was added, edited, renamed or removed. Carries the whole list. */
    commandsChanged: StoryCustomCommand[];
    dirtyChanged: boolean;
};

export type StoryCustomCommandNameProblem = "empty" | "invalid" | "taken";

/**
 * The project's own story commands. Owns `editor/story/commands.json`.
 *
 * Mirrors {@link TransformPresetService} - one project JSON, seeded from absence, revision +
 * debounced autosave, change events and the same refuse-to-overwrite latch - because it is the same
 * class of thing: a small project-level list several surfaces read and version control has to see
 * entry by entry.
 *
 * One difference: rows REFER to these. A call stores the command's id, so renaming one is safe and
 * deleting one leaves its calls playing nothing (and the `story/custom-command-missing` lint says so).
 *
 * Every change is published to the command layer at once (`publishCustomStoryCommands`), so the
 * story editor parses `/左右摇晃` the moment the command exists.
 */
export class StoryCustomCommandService extends Service<StoryCustomCommandService> implements IStoryCustomCommandService {
    private document: StoryCustomCommandDocument | null = null;
    private unreadable: DocumentCorruptError | null = null;
    private readonly events = new EventEmitter<StoryCustomCommandServiceEvents>();
    private dirty = false;
    private revision = 0;
    private libraryCache: { revision: number; library: StoryCustomCommandLibrary } | null = null;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.save(this.getDocument()),
        onError: err => console.warn("[StoryCustomCommandService] auto-save failed", err),
    });

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);
        await registerAutoSaver(ctx, depend, "storyCommands", "workspace.shell.save.stores.storyCommands", this.autoSaver);
        await this.load();
    }

    public async load(): Promise<void> {
        const result = await loadDocument(storyCommandsSpec, this.storage(), storyCommandsSpec.pathFor());
        this.unreadable = null;
        this.revision = 0;
        this.libraryCache = null;
        if (result.status === "missing") {
            // Not written on first open: a file holding an empty list would sit in every project's
            // first commit saying nothing. It is written when the first command is.
            this.document = createEmptyStoryCustomCommandDocument();
        } else if (result.status === "corrupt") {
            this.unreadable = result.error;
            this.document = createEmptyStoryCustomCommandDocument();
            reportUnreadableDocument(this.getContext(), result);
        } else {
            this.document = result.document;
        }
        this.setDirty(false);
        this.publish();
    }

    public async save(document: StoryCustomCommandDocument): Promise<void> {
        if (this.unreadable) {
            throw new RendererError(
                `Refusing to write ${this.unreadable.path}: it is on disk but could not be read `
                + `(${this.unreadable.reason}), so anything written now would replace it with an empty list.`,
            );
        }
        this.autoSaver.cancel();
        const updated = normalizeStoryCustomCommandDocument({ ...document, schemaVersion: STORY_CUSTOM_COMMAND_SCHEMA_VERSION });
        await saveDocument(storyCommandsSpec, this.storage(), storyCommandsSpec.pathFor(), updated);
        this.document = updated;
        this.setDirty(false);
    }

    public getDocument(): StoryCustomCommandDocument {
        if (!this.document) {
            throw new RendererError("Story commands not initialized");
        }
        return this.document;
    }

    public documentOrNull(): StoryCustomCommandDocument | null {
        return this.document;
    }

    /** Every command, in the order the author made them. Copies; edit through the mutators. */
    public listCommands(): StoryCustomCommand[] {
        return this.getDocument().commands.map(command => structuredClone(command));
    }

    public getCommand(id: string): StoryCustomCommand | null {
        const command = this.getDocument().commands.find(candidate => candidate.id === id);
        return command ? structuredClone(command) : null;
    }

    /** By id, the way the compiler and the stage walk look a call up. Rebuilt only when the list changes. */
    public library(): StoryCustomCommandLibrary {
        if (this.libraryCache?.revision !== this.revision || !this.document) {
            this.libraryCache = { revision: this.revision, library: customCommandLibrary(this.document?.commands) };
        }
        return this.libraryCache.library;
    }

    /** Why a name cannot be used (blank, unreadable on a line, or taken in this project), or null. */
    public nameProblem(name: string, selfId?: string): StoryCustomCommandNameProblem | null {
        return customCommandNameProblem(name, this.getDocument().commands, selfId);
    }

    /** A new, empty command under this name. Null when the name cannot be used. */
    public createCommand(name: string, seed: Partial<Pick<StoryCustomCommand, "rows" | "params" | "description">> = {}): StoryCustomCommand | null {
        if (this.nameProblem(name)) {
            return null;
        }
        const command: StoryCustomCommand = {
            id: this.generateId(),
            name: name.trim(),
            params: seed.params ?? [],
            rows: seed.rows ?? [],
            ...(seed.description ? { description: seed.description } : {}),
        };
        this.applyMutation(commands => [...commands, command]);
        return structuredClone(command);
    }

    /**
     * Replace what a command is. `false` when there is no such command, or the new name cannot be used.
     * The id never changes: it is what every call holds.
     */
    public updateCommand(id: string, patch: Partial<Omit<StoryCustomCommand, "id">>): boolean {
        const existing = this.getDocument().commands.find(command => command.id === id);
        if (!existing) {
            return false;
        }
        if (patch.name !== undefined && this.nameProblem(patch.name, id)) {
            return false;
        }
        const next: StoryCustomCommand = { ...existing, ...patch, id, name: (patch.name ?? existing.name).trim() };
        if (patch.description !== undefined && !patch.description.trim()) {
            delete next.description;
        }
        this.applyMutation(commands => commands.map(command => (command.id === id ? next : command)));
        return true;
    }

    /** Forget a command. Its calls stay in the scenes and play nothing until one is made again. */
    public removeCommand(id: string): boolean {
        if (!this.getDocument().commands.some(command => command.id === id)) {
            return false;
        }
        this.applyMutation(commands => commands.filter(command => command.id !== id));
        return true;
    }

    /**
     * Add commands read out of a shared file. A name this project already holds is kept apart rather
     * than overwritten (`name 2`), and every command gets an id of this project's own, so importing the
     * same file twice cannot merge into the first copy. Returns the commands that landed.
     */
    public importCommands(items: readonly StoryCustomCommand[]): StoryCustomCommand[] {
        const added: StoryCustomCommand[] = [];
        const idMap = new Map<string, string>();
        for (const item of items) {
            const name = this.availableName(item.name, added);
            if (!name) {
                continue;
            }
            const id = this.generateId(added);
            idMap.set(item.id, id);
            added.push({ ...structuredClone(item), id, name });
        }
        // A command made of commands calls its parts by id: point those calls at the copies made here.
        for (const command of added) {
            for (const row of command.rows) {
                const payload = row.block.kind === "action" ? row.block.payload : null;
                if (payload?.action === "customCommand" && idMap.has(payload.commandId)) {
                    payload.commandId = idMap.get(payload.commandId)!;
                }
            }
        }
        if (added.length > 0) {
            this.applyMutation(commands => [...commands, ...added]);
        }
        return added.map(command => structuredClone(command));
    }

    public onCommandsChanged(handler: (commands: StoryCustomCommand[]) => void): () => void {
        return this.events.on("commandsChanged", handler);
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

    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    private applyMutation(mutator: (commands: StoryCustomCommand[]) => StoryCustomCommand[]): void {
        const document = this.getDocument();
        this.document = normalizeStoryCustomCommandDocument({ ...document, commands: mutator([...document.commands]) });
        this.revision += 1;
        this.setDirty(true);
        this.autoSaver.schedule();
        this.publish();
    }

    private publish(): void {
        publishCustomStoryCommands(this.getDocument().commands);
        this.events.emit("commandsChanged", this.listCommands());
    }

    private availableName(raw: string, pending: readonly StoryCustomCommand[]): string | null {
        const base = raw.trim();
        if (!base || customCommandNameProblem(base, []) === "invalid") {
            return null;
        }
        const taken = new Set([...this.getDocument().commands, ...pending].map(command => foldCustomCommandName(command.name)));
        if (!taken.has(foldCustomCommandName(base))) {
            return base;
        }
        for (let suffix = 2; ; suffix += 1) {
            const candidate = `${base}${suffix}`;
            if (!taken.has(foldCustomCommandName(candidate))) {
                return candidate;
            }
        }
    }

    private generateId(pending: readonly StoryCustomCommand[] = []): string {
        const uuidService = this.getContext().services.get<UuidService>(Services.Uuid);
        const taken = new Set([...this.getDocument().commands, ...pending].map(command => command.id));
        for (let attempt = 0; ; attempt += 1) {
            const random = uuidService.generate(true).replace(/[^0-9a-z]/gi, "").toLowerCase();
            const id = `c${random.slice(0, 9)}${attempt > 0 ? attempt.toString(36) : ""}`;
            if (!taken.has(id)) {
                return id;
            }
        }
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private storage(): DocumentStorage {
        return createProjectDocumentStorage(this.getContext(), storeWrite("workspace.shell.save.stores.storyCommands", "retried"));
    }
}
