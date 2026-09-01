/**
 * What a puppet's model contains, as the editor can ask for it.
 *
 * The engine gives a backend an optional `describe()` for exactly one purpose: so a host never has
 * to parse a `.moc3`, a `.skel` or an `.atlas`. Studio asks the live model instead. This service is
 * the whole of that path — resolve the bundle, load the author's runtime, mount the model, ask, and
 * remember the answer for next time.
 *
 * ## Where the answer lives
 *
 * Nowhere durable. A description is *derived*: it is a reading of two files on disk (the model and
 * the runtime), and re-reading them reproduces it exactly. So it goes under `editor/cache/`, which
 * is excluded from version control, from `.nlspkg`, and from the write freeze — never on the asset
 * record, whose `extras` is documented as being for the author's *decisions* and rides in a project
 * file the whole team shares. A stale entry there would be a merge conflict about a fact nobody
 * decided.
 *
 * ## When the answer stops being true
 *
 * On its own, without a watcher, an eviction hook, or a button. Every lookup takes a fingerprint of
 * everything that could change the answer — the bundle's listing hash and its total bytes, the
 * entry the bundle resolved to, the backend name, and the size + modification time of the backend's
 * own module — and a record whose fingerprint no longer matches is a miss. Re-export a model, drop
 * in a new runtime build, or point the character at a different entry, and the next lookup mounts
 * the model again. See {@link puppetDescriptionFingerprint}.
 *
 * ## When there is no answer
 *
 * Constantly, and it is not an error. Most projects carry no puppet runtime at all; a project
 * written on one machine may open on another that has not installed it; a project that arrived in a
 * package is not trusted to run its own runtimes until the author says so; a backend is free to
 * implement no `describe()`. Every one of those comes back as `{status: "unavailable", reason}` so
 * the caller falls back to letting the author type names. Nothing here throws at a caller.
 *
 * The reason is load-bearing, not decoration: each one selects a different sentence under the
 * dropdowns, and they say different things for the author to do. Flattening one into `failed` is
 * how a project awaiting approval came to be reported as a broken model.
 */

import type { PuppetDescription, PuppetSize } from "narraleaf-react";
import { Service } from "../Service";
import { IPuppetDescriptionService, Services, WorkspaceContext } from "../services";
import { AssetsService } from "../core/AssetsService";
import { FileSystemService } from "../core/FileSystem";
import { CharacterService } from "../core/CharacterService";
import { AssetType } from "../assets/assetTypes";
import type { Asset } from "../assets/types";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { resolveBundleEntry } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    PUPPET_DESCRIPTION_CACHE_VERSION,
    normalizePuppetDescription,
    parsePuppetDescriptionRecord,
    puppetDescriptionFingerprint,
    puppetDescriptionKey,
    type PuppetDescriptionRecord,
    type PuppetDescriptionRequest,
    type PuppetDescriptionResult,
} from "./puppetDescriptionModel";
import {
    createPuppetBackendSource,
    grantModelBundleUrl,
    readPuppetRuntimeStamp,
} from "./projectPuppetRuntimes";
import { createPuppetModelSession, type PuppetModelSession } from "@/lib/ui-editor/runtime/game/puppetModelSession";
import { SurfacePuppetUnavailableError } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import { isProjectTrusted } from "@/lib/workspace/projectTrust";

/** The box a model is mounted into when nobody asked for a particular one. */
const DEFAULT_PROBE_SIZE: PuppetSize = { width: 512, height: 512 };

/** Everything a mount needs, once the request has been resolved against the project. */
interface PuppetMountPlan {
    /** The bundle's entry-file URL, override applied — what the backend receives as `ctx.src`. */
    src: string;
    backend: string;
    options: Record<string, unknown>;
    size: PuppetSize;
    fingerprint: string;
    cacheKey: string;
}

type PlanResult =
    | { ok: true; plan: PuppetMountPlan }
    | { ok: false; result: Extract<PuppetDescriptionResult, { status: "unavailable" }> };

function unavailable(
    reason: Extract<PuppetDescriptionResult, { status: "unavailable" }>["reason"],
    message?: string,
): PlanResult {
    return { ok: false, result: { status: "unavailable", reason, ...(message ? { message } : {}) } };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class PuppetDescriptionService
    extends Service<PuppetDescriptionService>
    implements IPuppetDescriptionService {

    /** Fingerprint -> description, for the current session. Keyed by fingerprint so a stale one can never be served. */
    private readonly memory = new Map<string, PuppetDescription>();
    /** In-flight lookups, keyed by fingerprint: an inspector and a story row asking at once mount one model, not two. */
    private readonly inFlight = new Map<string, Promise<PuppetDescriptionResult>>();
    private readonly listeners = new Set<() => void>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        // Singletons survive a project switch, so every scrap of the previous project goes.
        this.memory.clear();
        this.inFlight.clear();
    }

    public override dispose(): void {
        this.memory.clear();
        this.inFlight.clear();
        this.listeners.clear();
    }

    /** Fires when a lookup produced a description that was not already known. */
    public onDescriptionChanged(handler: () => void): () => void {
        this.listeners.add(handler);
        return () => { this.listeners.delete(handler); };
    }

    /**
     * The description for a puppet, from memory, from `editor/cache/`, or from the live model.
     *
     * Never throws. Never blocks on anything but the mount, which is bounded.
     */
    public async describe(
        request: PuppetDescriptionRequest,
        options?: { refresh?: boolean },
    ): Promise<PuppetDescriptionResult> {
        const planned = await this.plan(request);
        if (!planned.ok) {
            return planned.result;
        }
        const { plan } = planned;

        if (!options?.refresh) {
            const remembered = this.memory.get(plan.fingerprint);
            if (remembered) {
                return { status: "ok", description: remembered, origin: "memory", fingerprint: plan.fingerprint };
            }
            const pending = this.inFlight.get(plan.fingerprint);
            if (pending) {
                return pending;
            }
            const stored = await this.readCache(plan);
            if (stored) {
                this.memory.set(plan.fingerprint, stored.description);
                this.notify();
                return { status: "ok", description: stored.description, origin: "disk", fingerprint: plan.fingerprint };
            }
        }

        const task = this.probe(plan).finally(() => {
            if (this.inFlight.get(plan.fingerprint) === task) {
                this.inFlight.delete(plan.fingerprint);
            }
        });
        this.inFlight.set(plan.fingerprint, task);
        return task;
    }

    /**
     * The same lookup, addressed by character.
     *
     * The convenience the rest of Studio reaches for: a story row names a character, not a bundle
     * and a runtime. A character that is not a puppet answers `no-model`, so a caller can ask
     * without checking the appearance kind first.
     */
    public async describeCharacter(
        characterId: string,
        options?: { refresh?: boolean },
    ): Promise<PuppetDescriptionResult> {
        const characters = this.getContext().services.get<CharacterService>(Services.Character);
        const puppet = characters.getCharacter(characterId)?.profile.appearance.getPuppet();
        if (!puppet?.assetId) {
            return { status: "unavailable", reason: "no-model" };
        }
        return this.describe({
            assetId: puppet.assetId,
            backend: puppet.backend,
            entry: puppet.entry,
            options: puppet.options,
            size: puppet.size,
        }, options);
    }

    /**
     * What is already known, synchronously.
     *
     * For render paths that must not suspend — a dropdown drawing its options during a keystroke.
     * Returns null rather than a promise when nothing is in memory; the caller kicks off
     * {@link describe} and re-renders when {@link onDescriptionChanged} fires.
     */
    public peek(request: PuppetDescriptionRequest): PuppetDescription | null {
        for (const [fingerprint, description] of this.memory) {
            if (fingerprint.endsWith(`:${puppetDescriptionKey(request)}`)) {
                return description;
            }
        }
        return null;
    }

    /**
     * The same synchronous look, addressed by character.
     *
     * What the story editor reads: it holds characters, and rebuilding a request out of an appearance
     * at every call site would put the same four-field mapping in a third place. A character that is
     * not a puppet, or one whose model has not been asked yet, answers null - which is the caller's
     * cue to call {@link describeCharacter} and re-render on {@link onDescriptionChanged}.
     */
    public peekCharacter(characterId: string): PuppetDescription | null {
        const characters = this.getContext().services.get<CharacterService>(Services.Character);
        const puppet = characters.getCharacter(characterId)?.profile.appearance.getPuppet();
        if (!puppet?.assetId || !puppet.backend) {
            return null;
        }
        return this.peek({
            assetId: puppet.assetId,
            backend: puppet.backend,
            entry: puppet.entry,
            options: puppet.options,
            size: puppet.size,
        });
    }

    /** Forget a description, in memory and on disk. Without a request, forgets everything in memory. */
    public async invalidate(request?: PuppetDescriptionRequest): Promise<void> {
        this.memory.clear();
        this.inFlight.clear();
        if (request) {
            const filesystem = this.getContext().services.get<FileSystemService>(Services.FileSystem);
            await filesystem.deleteFile(this.cachePath(puppetDescriptionKey(request))).catch(() => undefined);
        }
        this.notify();
    }

    /**
     * Mount the model into a container the caller owns, and keep it there.
     *
     * The character editor's preview, and a Surface puppet widget on the canvas. The description path
     * disposes its model the moment it has an answer; these keep it, so the author can watch a motion
     * play. Rejects rather than degrading — both callers have somewhere to put the failure.
     *
     * **Two kinds of rejection, and callers do act on them differently.** A
     * {@link SurfacePuppetUnavailableError} means there was never anything to mount — no model asset,
     * no backend named, or the named runtime is not installed — which is the ordinary condition of most
     * projects and has to degrade to an empty box rather than to an error. Anything else means a
     * runtime was found and then misbehaved. The distinction rides in the error's type rather than in
     * its message, so no caller has to pattern-match prose to tell a normal project from a broken one.
     */
    public async openSession(
        request: PuppetDescriptionRequest,
        container: HTMLDivElement,
        options?: { size?: PuppetSize; onWarn?: (message: string) => void },
    ): Promise<PuppetModelSession> {
        const planned = await this.plan(request);
        if (!planned.ok) {
            const { reason, message } = planned.result;
            throw new SurfacePuppetUnavailableError(
                // `plan()` cannot answer `not-described` — that is only decided after a mount — but the
                // union permits it, so it folds into the nearest honest reason instead of being cast away.
                reason === "no-backend" || reason === "backend-missing" || reason === "distrusted"
                    ? reason
                    : "no-model",
                message ?? reason,
            );
        }
        const { plan } = planned;
        const session = await createPuppetModelSession({
            container,
            source: await createPuppetBackendSource(this.getContext().project, plan.backend),
            backend: plan.backend,
            src: plan.src,
            options: plan.options,
            size: options?.size ?? plan.size,
            onWarn: warning => options?.onWarn?.(warning.message),
        });
        // A visible session is a free description: the model is already up, so asking costs one
        // call instead of a second mount. Failures are ignored - the preview is what was asked for.
        if (session.describable && !this.memory.has(plan.fingerprint)) {
            void session.describe()
                .then(raw => this.remember(plan, raw))
                .catch(() => undefined);
        }
        return session;
    }

    // ------------------------------------------------------------------ internals

    /**
     * Resolve a request against the project: which file is the entry, is the runtime installed, and
     * what would make this answer stale.
     *
     * Everything the fingerprint needs is read here, in one pass, because the bundle walk that finds
     * the entry is the same walk that totals its bytes.
     */
    private async plan(request: PuppetDescriptionRequest): Promise<PlanResult> {
        const backend = request.backend?.trim() ?? "";
        if (!backend) {
            return unavailable("no-backend");
        }
        const assetId = request.assetId?.trim() ?? "";
        if (!assetId) {
            return unavailable("no-model");
        }

        const context = this.getContext();
        // The two checks above are about the request and cost nothing, so they stay ahead of this
        // one: a puppet that names no backend should be told so, not told about trust. Everything
        // below reads the project, and none of it can produce an answer for a project whose
        // runtimes may not run.
        if (!await this.mayMount()) {
            return unavailable("distrusted");
        }

        const assets = context.services.get<AssetsService>(Services.Assets);
        const asset = assets.getAssets()[AssetType.Model]?.[assetId] as Asset<AssetType.Model> | undefined;
        if (!asset) {
            return unavailable("no-model", `Model asset ${assetId} is not in this project`);
        }
        const modelService = assets.modelService;
        if (!modelService) {
            return unavailable("no-model", "Model service is not initialized");
        }

        const root = modelService.getBundleRoot(assetId);
        const listing = await modelService.listBundle(root);
        if (!listing.success || !listing.data) {
            return unavailable("no-model", listing.error ?? "Failed to read the model bundle");
        }
        const resolved = modelService.resolveEntry(asset, listing.data.files);
        if (!resolved.entry) {
            return unavailable("no-model", resolved.unresolved === "ambiguous"
                ? `Model bundle "${asset.name}" has more than one possible entry file`
                : `Model bundle "${asset.name}" has no entry file`);
        }

        const backendStamp = await readPuppetRuntimeStamp(context.project, backend);
        if (backendStamp === null) {
            return unavailable("backend-missing", `The runtime "${backend}" is not installed in this project`);
        }

        let bundleUrl: string;
        try {
            bundleUrl = await grantModelBundleUrl(root, resolved.entry);
        } catch (error) {
            return unavailable("no-model", errorMessage(error));
        }
        const override = request.entry?.trim() ?? "";
        const src = override ? resolveBundleEntry(bundleUrl, override) : bundleUrl;
        const options = request.options ?? {};
        const size = request.size ?? null;
        const cacheKey = puppetDescriptionKey({ ...request, assetId, backend });

        return {
            ok: true,
            plan: {
                src,
                backend,
                options,
                size: size ?? DEFAULT_PROBE_SIZE,
                cacheKey,
                // The key is appended so `peek` can match on identity alone; the digest ahead of it
                // is what decides freshness.
                fingerprint: `${puppetDescriptionFingerprint({
                    assetHash: asset.hash ?? "",
                    bundleBytes: listing.data.totalBytes,
                    resolvedEntry: override ? `${resolved.entry}|${override}` : resolved.entry,
                    backend,
                    backendStamp,
                    options,
                    size,
                })}:${cacheKey}`,
            },
        };
    }

    /**
     * Whether a mount attempted from here could be answered at all, as far as is knowable in advance.
     *
     * Trust is the one thing worth asking up front, and asking it buys two separate things.
     *
     * The first is the message. `createPuppetBackendSource` refuses a distrusted project at the
     * moment the mount is already being set up, and a refusal that arrives as a caught exception has
     * to be recognised again on the way out — which is where the reason used to be lost, leaving the
     * author reading "the model could not be read" about a model that is fine. Asked here, the
     * reason is simply the answer.
     *
     * The second is the cost. Nothing below memoizes a failure, so every lookup that cannot succeed
     * still walks the model bundle, reads the runtime's stamp and mints a fresh directory grant
     * through `storageManager.allocateHash` — which does not dedup by path, and whose grants live as
     * long as the window. The scene editor asks for every puppet character on each mount, so that
     * repeats. A distrusted project now stops before any of it.
     *
     * A "no" also puts the disk cache out of reach, since this sits ahead of the cache lookup in
     * {@link describe}. Nothing is lost by that: `editor/cache/` is excluded from version control
     * and from `.nlspkg`, so a project that arrived from elsewhere — the only kind that starts
     * distrusted — brought no descriptions with it.
     */
    private mayMount(): Promise<boolean> {
        return isProjectTrusted(this.getContext().project.resolve());
    }

    /**
     * Mount the model offscreen, ask it, and take it down again.
     *
     * Offscreen rather than detached: a detached container has no layout, and a backend that sizes a
     * canvas from its host would come up zero-sized. It is pushed off the left edge instead, at the
     * size that was asked for, with pointer events off so it can never take a click.
     */
    private async probe(plan: PuppetMountPlan): Promise<PuppetDescriptionResult> {
        const host = document.createElement("div");
        host.setAttribute("aria-hidden", "true");
        host.style.cssText = [
            "position:fixed",
            "left:-20000px",
            "top:0",
            "pointer-events:none",
            "opacity:0",
            `width:${plan.size.width}px`,
            `height:${plan.size.height}px`,
        ].join(";");
        document.body.appendChild(host);

        let session: PuppetModelSession | null = null;
        try {
            session = await createPuppetModelSession({
                container: host,
                source: await createPuppetBackendSource(this.getContext().project, plan.backend),
                backend: plan.backend,
                src: plan.src,
                options: plan.options,
                size: plan.size,
            });
            if (!session.describable) {
                return { status: "unavailable", reason: "not-described" };
            }
            const description = await this.remember(plan, await session.describe());
            if (!description) {
                return {
                    status: "unavailable",
                    reason: "failed",
                    message: "The runtime returned something that is not a model description",
                };
            }
            return { status: "ok", description, origin: "live", fingerprint: plan.fingerprint };
        } catch (error) {
            // A typed unavailability keeps the reason it was given; anything else is a failure and
            // has to stay one. The asymmetry is the whole point: a model that genuinely cannot be
            // read must never start reporting itself as a trust problem, because that sends the
            // author to Settings over a broken file.
            //
            // `plan()` answers `distrusted` before a mount is ever attempted, so that reason
            // should not reach this arm — and the arm is kept anyway. `createPuppetBackendSource`
            // holds the refusal that actually stops the `import()`, deliberately, because it is the
            // only place a workspace-side backend source is minted; and `loadPuppetBackends` is free
            // to report unavailability of its own for a module that registers no backend under the
            // name asked for. Flattening whichever of those arrives would put it back in the hole
            // this arm exists to close.
            if (error instanceof SurfacePuppetUnavailableError) {
                return { status: "unavailable", reason: error.reason, message: errorMessage(error) };
            }
            return { status: "unavailable", reason: "failed", message: errorMessage(error) };
        } finally {
            session?.dispose();
            host.remove();
        }
    }

    /** Validate what a backend returned, then keep it in memory and on disk. */
    private async remember(plan: PuppetMountPlan, raw: unknown): Promise<PuppetDescription | null> {
        const description = normalizePuppetDescription(raw);
        if (!description) {
            return null;
        }
        this.memory.set(plan.fingerprint, description);
        this.notify();
        await this.writeCache(plan, description);
        return description;
    }

    private cachePath(key: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorPuppetDescriptionCacheShard(key));
    }

    private async readCache(plan: PuppetMountPlan): Promise<PuppetDescriptionRecord | null> {
        const filesystem = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const read = await filesystem.readJSON<unknown>(this.cachePath(plan.cacheKey)).catch(() => null);
        if (!read?.ok) {
            return null;
        }
        const record = parsePuppetDescriptionRecord(read.data);
        // A record for the same puppet whose fingerprint moved on is not repaired or migrated - it
        // is simply not an answer to this question, and the probe overwrites it.
        return record && record.fingerprint === plan.fingerprint ? record : null;
    }

    private async writeCache(plan: PuppetMountPlan, description: PuppetDescription): Promise<void> {
        const context = this.getContext();
        const filesystem = context.services.get<FileSystemService>(Services.FileSystem);
        const record: PuppetDescriptionRecord = {
            version: PUPPET_DESCRIPTION_CACHE_VERSION,
            fingerprint: plan.fingerprint,
            describedAt: new Date().toISOString(),
            description,
        };
        try {
            await filesystem.createDir(context.project.resolve(ProjectNameConvention.EditorPuppetDescriptionCache));
            await filesystem.write(this.cachePath(plan.cacheKey), JSON.stringify(record), "utf-8");
        } catch {
            // A cache that cannot be written costs a re-probe next time and nothing else.
        }
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                // A subscriber's own failure is not this service's to propagate.
            }
        }
    }
}
