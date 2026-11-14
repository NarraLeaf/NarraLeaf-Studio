import { collectTransfer, listTransfers, offerTransfer, abandonTransfers } from "@/lib/team/teamTransfer";
import {
    opDocumentKind,
    type LiveAppTagOp,
    type LiveAssetFolderOp,
    type LiveAssetOp,
    type LiveAssetSetOp,
    type LiveAudioTrackOp,
    type LiveBrandOp,
    type LiveCharacterOp,
    type LiveDerived,
    type LiveDictionaryOp,
    type LiveDlcOp,
    type LiveDocument,
    type LiveLocalizationKeyOp,
    type LiveLocalizationOp,
    type LiveOp,
    type LiveStoryOp,
    type LiveUIGraphOp,
    type LiveUIOp,
    type LiveVariableOp,
    type LiveVoiceOp,
} from "@shared/live/ops";
import type { ProjectOp, TeamStoryLibraryOp } from "@shared/authority/project";
import type { TeamTransferState } from "@shared/types/teamTransfer";
import { Services, type WorkspaceContext } from "../services";
import { AppTagService } from "../appTag/AppTagService";
import { AssetSetService } from "../assets/AssetSetService";
import { AudioTrackService } from "../audio/AudioTrackService";
import { BrandService } from "../brand/BrandService";
import { AssetsService, type AssetBlobPort } from "../core/AssetsService";
import { CharacterService } from "../core/CharacterService";
import { DictionaryService } from "../dictionary/DictionaryService";
import { DlcService } from "../dlc/DlcService";
import { LocalizationService } from "../localization/LocalizationService";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { VoiceService } from "../voice/VoiceService";

/** Where an edit goes: the document it is about, the operation, and what a paste derived. */
export type TeamDocHandler = (document: LiveDocument, op: ProjectOp, derived?: LiveDerived) => boolean;

/**
 * The address of the document an operation is about. Read off the operation where it names its
 * document (a language, an asset type, a folder section); the one story an editing gesture is in
 * comes from the story service's own sink call.
 */
export function documentForOp(op: LiveOp, storyId?: string): LiveDocument {
    const kind = opDocumentKind(op);
    switch (kind) {
        case "story":
            if (storyId === undefined) throw new Error("a story operation needs its story");
            return { doc: "story", storyId };
        case "localization":
            return { doc: "localization", locale: (op as LiveLocalizationOp).locale };
        case "voice":
            return { doc: "voice", locale: (op as LiveVoiceOp).locale };
        case "assets":
            return { doc: "assets", assetType: (op as LiveAssetOp).assetType };
        case "asset-groups":
            return { doc: "asset-groups", category: (op as LiveAssetFolderOp).category };
        default:
            return { doc: kind } as LiveDocument;
    }
}

/**
 * Every document service of one workspace, wired to a team project's server.
 *
 * `install` gives each service a sink that hands its edits to `handler` instead of applying them;
 * `apply` puts an effect the server published into the service that owns its document. The same
 * seams a live session hangs off, so the editors need nothing new.
 */
export class TeamDocWiring {
    private readonly transfers = new Map<string, { bytes: number; state: TeamTransferState | "unknown" }>();
    private poll: ReturnType<typeof setInterval> | null = null;

    public constructor(
        private readonly ctx: WorkspaceContext,
        private readonly remoteOrigin: string,
        private readonly project: string,
    ) {}

    private get<T>(service: Services): T {
        return this.ctx.services.get(service as never) as T;
    }

    /** Hand every service's edits to `handler`, or (null) give every service its own edits back. */
    public install(handler: TeamDocHandler | null): void {
        const story = this.get<StoryService>(Services.Story);
        if (handler === null) {
            story.setOperationSink(null);
            this.get<CharacterService>(Services.Character).setOperationSink(null);
            this.get<LocalizationService>(Services.Localization).setOperationSink(null);
            this.get<VoiceService>(Services.Voice).setOperationSink(null);
            this.get<AssetsService>(Services.Assets).setOperationSink(null, null);
            this.get<AppTagService>(Services.AppTags).setOperationSink(null);
            this.get<DlcService>(Services.Dlc).setOperationSink(null);
            this.get<BrandService>(Services.Brand).setOperationSink(null);
            this.get<UIDocumentService>(Services.UIDocument).setOperationSink(null);
            this.get<UIGraphService>(Services.UIGraph).setOperationSink(null);
            this.get<DictionaryService>(Services.Dictionary).setOperationSink(null);
            this.get<AudioTrackService>(Services.AudioTracks).setOperationSink(null);
            this.get<AssetSetService>(Services.AssetSets).setOperationSink(null);
            this.get<VariableRegistryService>(Services.VariableRegistry).setOperationSink(null);
            this.stopPolling();
            return;
        }
        const plain = { handle: (op: LiveOp) => handler(documentForOp(op), op) };
        story.setOperationSink({
            handle: (storyId, op, derived) => handler({ doc: "story", storyId }, op, derived),
            library: (storyId, op: TeamStoryLibraryOp) => handler({ doc: "story", storyId }, op),
        });
        this.get<CharacterService>(Services.Character).setOperationSink(plain);
        this.get<LocalizationService>(Services.Localization).setOperationSink(plain);
        this.get<VoiceService>(Services.Voice).setOperationSink(plain);
        this.get<AssetsService>(Services.Assets).setOperationSink(plain, this.blobPort());
        this.get<AppTagService>(Services.AppTags).setOperationSink(plain);
        this.get<DlcService>(Services.Dlc).setOperationSink(plain);
        this.get<BrandService>(Services.Brand).setOperationSink(plain);
        this.get<UIDocumentService>(Services.UIDocument).setOperationSink(plain);
        this.get<UIGraphService>(Services.UIGraph).setOperationSink(plain);
        this.get<DictionaryService>(Services.Dictionary).setOperationSink(plain);
        this.get<AudioTrackService>(Services.AudioTracks).setOperationSink(plain);
        this.get<AssetSetService>(Services.AssetSets).setOperationSink(plain);
        // Deleting a variable is safe to state only while the interface - which can refer to it - is
        // in memory to be checked, the condition a live session puts on it too.
        this.get<VariableRegistryService>(Services.VariableRegistry).setOperationSink({
            ...plain,
            canDelete: () => {
                try {
                    return this.get<UIDocumentService>(Services.UIDocument).getDocument() !== null;
                } catch {
                    return false;
                }
            },
        });
    }

    /** Put one effect the server published into the service that owns its document. */
    public apply(document: LiveDocument, op: ProjectOp, derived?: LiveDerived): void {
        switch (document.doc) {
            case "story": {
                const story = this.get<StoryService>(Services.Story);
                if (op.op === "create-story" || op.op === "delete-story") {
                    story.applyTeamLibraryOp(document.storyId, op);
                } else {
                    story.applyLiveOp(document.storyId, op as LiveStoryOp);
                }
                break;
            }
            case "characters":
                this.get<CharacterService>(Services.Character).applyLiveOp(op as LiveCharacterOp);
                break;
            case "localization":
            case "localization-keys":
                this.get<LocalizationService>(Services.Localization).applyLiveOp(op as LiveLocalizationOp | LiveLocalizationKeyOp);
                break;
            case "voice":
                this.get<VoiceService>(Services.Voice).applyLiveOp(op as LiveVoiceOp);
                break;
            case "assets":
            case "asset-groups":
                this.get<AssetsService>(Services.Assets).applyLiveOp(op as LiveAssetOp | LiveAssetFolderOp);
                break;
            case "app-tags":
                this.get<AppTagService>(Services.AppTags).applyLiveOp(op as LiveAppTagOp);
                break;
            case "dlc":
                this.get<DlcService>(Services.Dlc).applyLiveOp(op as LiveDlcOp);
                break;
            case "brand":
                this.get<BrandService>(Services.Brand).applyLiveOp(op as LiveBrandOp);
                break;
            case "ui":
                this.get<UIDocumentService>(Services.UIDocument).applyLiveOp(op as LiveUIOp);
                break;
            case "ui-graphs":
                this.get<UIGraphService>(Services.UIGraph).applyLiveOp(op as LiveUIGraphOp);
                break;
            case "dictionary":
                this.get<DictionaryService>(Services.Dictionary).applyLiveOp(op as LiveDictionaryOp);
                break;
            case "audio-tracks":
                this.get<AudioTrackService>(Services.AudioTracks).applyLiveOp(op as LiveAudioTrackOp);
                break;
            case "asset-sets":
                this.get<AssetSetService>(Services.AssetSets).applyLiveOp(op as LiveAssetSetOp);
                break;
            case "variables":
                this.get<VariableRegistryService>(Services.VariableRegistry).applyLiveOp(op as LiveVariableOp);
                break;
        }
        if (derived !== undefined) {
            const localization = this.get<LocalizationService>(Services.Localization);
            const voice = this.get<VoiceService>(Services.Voice);
            for (const [locale, units] of Object.entries(derived.translations ?? {})) {
                localization.adoptUnits(locale, units);
            }
            for (const [locale, units] of Object.entries(derived.voice ?? {})) {
                voice.adoptUnits(locale, units);
            }
        }
    }

    /**
     * Where an asset's file goes: up to the server's blob store when this window imports one, and
     * down from it when somebody else did. The server writes it into the next saved version.
     */
    private blobPort(): AssetBlobPort {
        const { remoteOrigin, project } = this;
        return {
            offer: async (assetId, part, source) => {
                const answered = await offerTransfer({ remoteOrigin, project, transferId: part.transferId, label: assetId, source });
                if (!answered.ok) {
                    return { ok: false, problem: answered.problem };
                }
                if (answered.kind !== "offered") {
                    return { ok: false, problem: { kind: "refused", detail: "that transfer was not accepted" } };
                }
                this.transfers.set(part.transferId, { bytes: 0, state: "moving" });
                this.startPolling();
                return { ok: true, part: { ...part, size: answered.size, digest: answered.digest } };
            },
            collect: (assetId, part, destination) => {
                if (this.transfers.has(part.transferId)) return;
                this.transfers.set(part.transferId, { bytes: 0, state: "waiting" });
                void collectTransfer({ remoteOrigin, project, transferId: part.transferId, label: assetId, destination, size: part.size, digest: part.digest });
                this.startPolling();
            },
            arrived: part => this.transfers.get(part.transferId) ?? { bytes: 0, state: "unknown" },
            abandon: part => {
                this.transfers.delete(part.transferId);
                void abandonTransfers(remoteOrigin, project, [part.transferId]);
            },
        } as AssetBlobPort;
    }

    private startPolling(): void {
        this.poll ??= setInterval(() => {
            void listTransfers().then(views => {
                for (const view of views) {
                    if (this.transfers.has(view.transferId)) {
                        this.transfers.set(view.transferId, { bytes: view.bytes, state: view.state });
                    }
                }
                const moving = [...this.transfers.values()].some(entry => entry.state === "moving" || entry.state === "waiting");
                if (!moving) this.stopPolling();
            });
        }, 1000);
    }

    private stopPolling(): void {
        if (this.poll !== null) {
            clearInterval(this.poll);
            this.poll = null;
        }
    }
}
