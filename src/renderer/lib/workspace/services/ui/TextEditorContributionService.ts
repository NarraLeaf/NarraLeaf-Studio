import { UIStore } from "./UIStore";
import {
    textEditorContributionMatches,
    type PluginTextEditorActionDef,
    type PluginTextEditorLanguageDef,
    type PluginTextEditorPreviewDef,
} from "./textEditorContributions";

/**
 * Text Editor Contribution Service
 *
 * The registry behind `app.services.textEditor`: the languages, previews and actions plugins add
 * to Studio's built-in text editor. Built on {@link UIStore} and shaped exactly like
 * `PanelService` - register returns a disposer, ids replace in place, and the editor subscribes
 * through the `stateChanged` hooks rather than being pushed at.
 *
 * Studio registers nothing here itself. That is the point of the phase: the interface exists, the
 * Markdown editing and preview it was cut for belong to a plugin.
 */
export class TextEditorContributionService {
    private store: UIStore;

    constructor(store: UIStore) {
        this.store = store;
    }

    /**
     * Register a language. Returns a disposer.
     *
     * Registering does *not* touch monaco: the editor installs the grammar the first time it
     * opens a document with a matching extension, so a plugin can declare a language without
     * pulling monaco into workspace startup.
     */
    public registerLanguage(def: PluginTextEditorLanguageDef): () => void {
        this.store.registerTextEditorLanguage(def);
        return () => this.store.unregisterTextEditorLanguage(def.id);
    }

    /** Register a preview pane. Returns a disposer. */
    public registerPreview(def: PluginTextEditorPreviewDef): () => void {
        this.store.registerTextEditorPreview(def);
        return () => this.store.unregisterTextEditorPreview(def.id);
    }

    /** Register a document command. Returns a disposer. */
    public registerAction(def: PluginTextEditorActionDef): () => void {
        this.store.registerTextEditorAction(def);
        return () => this.store.unregisterTextEditorAction(def.id);
    }

    public getLanguages(): PluginTextEditorLanguageDef[] {
        return this.store.getTextEditorLanguages();
    }

    public getPreviews(): PluginTextEditorPreviewDef[] {
        return this.store.getTextEditorPreviews();
    }

    public getActions(): PluginTextEditorActionDef[] {
        return this.store.getTextEditorActions();
    }

    /**
     * The language to open a `.<extension>` document in, or undefined when no plugin claims it.
     *
     * First registration wins rather than last: two plugins claiming `.md` is a conflict nobody
     * can resolve at this layer, and flipping the answer on every re-register would make which
     * grammar you get depend on plugin load order from one session to the next.
     */
    public languageForExtension(extension: string): PluginTextEditorLanguageDef | undefined {
        return this.getLanguages().find(def => textEditorContributionMatches(def.extensions, extension));
    }

    public previewsForExtension(extension: string): PluginTextEditorPreviewDef[] {
        return this.getPreviews().filter(def => textEditorContributionMatches(def.extensions, extension));
    }

    /** Actions that declare no `extensions` apply to every text document. */
    public actionsForExtension(extension: string): PluginTextEditorActionDef[] {
        return this.getActions().filter(def => textEditorContributionMatches(def.extensions, extension));
    }
}
