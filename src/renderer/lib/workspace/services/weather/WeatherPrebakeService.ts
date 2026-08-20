import { getInterface } from "@/lib/app/bridge";
import type { StoryDocument, StoryId } from "@shared/types/story";
import { weatherBakeKey } from "@shared/weather/bakeKey";
import type { WeatherBakeSpec } from "@shared/weather/model";
import { collectWeatherSpecs } from "@shared/weather/stage";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";

/**
 * How long the project has to stop changing before Studio starts making its weather.
 *
 * Long, and deliberately longer than the reference index's 300ms: that index answers a question the
 * author can ask at any moment, while this only starts work nobody has asked for yet. Waiting a few
 * seconds costs nothing and keeps the encoder off the machine while someone is still typing.
 */
const SETTLE_MS = 5000;

/**
 * Bake a project's weather before anyone waits for it.
 *
 * The scheduler already knows how to run speculative work safely: `idle` work yields to a run, and
 * an `idle` bake that someone then waits on is promoted in place rather than restarted. What it
 * deliberately does not decide is **when** to speculate, because that is a judgement about the thing
 * being watched rather than about the queue. This is that judgement for weather.
 *
 * ## The wait this exists to remove
 *
 * Opening a project and pressing Run is the path that matters, and nothing about it is an edit - so
 * watching for edits alone would leave the common case paying the full bake. The pass therefore runs
 * once the library is known and reads every story, not only the ones the author has opened. That
 * read is not an added cost: the reference index loads the same documents through the same cache, so
 * whichever of the two gets there first pays for both.
 *
 * ## Why nothing here reports anything
 *
 * A pre-bake has no audience. It cannot fail in a way an author should hear about, because a clip
 * that did not get made is simply made again - blockingly, with the status bar showing it - the
 * moment a run needs it. The only thing this service can get wrong is doing work nobody benefits
 * from, so both of its guards are about not doing any: settle first, and submit only what changed.
 */
export class WeatherPrebakeService extends Service<WeatherPrebakeService> {
    private unsubs: Array<() => void> = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** The keys last handed to the scheduler; nothing is resubmitted until this set changes. */
    private submitted = new Set<string>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        await depend([
            ctx.services.get<StoryService>(Services.Story),
            ctx.services.get<UIDocumentService>(Services.UIDocument),
        ]);

        const storyService = ctx.services.get<StoryService>(Services.Story);
        const uiDocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);

        this.unsubs.push(
            storyService.onDocumentChanged(() => this.schedule()),
            storyService.onLibraryChanged(() => this.schedule()),
            // The stage's design size is half of what a clip's identity is, so a resize means every
            // story now names different pictures than the ones already on disk.
            uiDocumentService.onDocumentChanged(() => this.schedule()),
        );

        this.schedule();
    }

    public override dispose(): void {
        for (const unsub of this.unsubs) {
            unsub();
        }
        this.unsubs = [];
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.submitted.clear();
    }

    private schedule(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.submit();
        }, SETTLE_MS);
    }

    private async submit(): Promise<void> {
        const ctx = this.getContext();
        const storyService = ctx.services.get<StoryService>(Services.Story);
        const documents: StoryDocument[] = [];
        for (const entry of storyService.listStories()) {
            const document = await this.readStory(storyService, entry.id);
            if (document) {
                documents.push(document);
            }
        }
        const specs = collectWeatherSpecs(documents, ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument());
        const keys = new Set(specs.map(weatherBakeKey));

        // Nothing new to have ready. This is the common case by a wide margin: writing prose changes
        // the document constantly and changes the weather never.
        if (specs.length === 0 || (keys.size === this.submitted.size && [...keys].every(key => this.submitted.has(key)))) {
            return;
        }
        this.submitted = keys;

        try {
            await getInterface().studioTasks.prebakeWeather(ctx.project.getConfig().projectPath, specs);
        } catch {
            // The submission itself failing changes nothing an author can act on: the clips are made
            // when they are needed. Forgetting what was submitted is the only thing worth doing, so
            // a later edit tries again.
            this.submitted = new Set();
        }
    }

    /** One story, or nothing at all if it will not read. Speculation is where saying nothing is safe. */
    private async readStory(storyService: StoryService, storyId: StoryId): Promise<StoryDocument | null> {
        try {
            return await storyService.loadStory(storyId);
        } catch {
            return null;
        }
    }
}
