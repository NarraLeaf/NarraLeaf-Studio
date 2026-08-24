import {
    APP_TAG_SCHEMA_VERSION,
    migrateProjectAppTagDocument,
    type ProjectAppTagDocument,
} from "../../types/appTag";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/app-tags.json` - the build variants the project can be shipped as.
 *
 * Owned by `AppTagService`. A first-class document rather than a corner of `.nlproj` because the
 * `.nlproj` holds the values a tag overrides: version control has to be able to show "the demo's
 * name changed" as its own change, and a diff of the whole project file cannot.
 *
 * Holds author-created tags only. The release tag is synthesized on read, so this document is
 * absent, not empty-with-one-entry, in a project that has never had another variant.
 *
 * The path is `ProjectNameConvention.EditorAppTags` spelled as a pattern; the two are kept in step
 * by the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see both
 * (this module is shared, the convention is not).
 */
export const APP_TAGS_DOCUMENT_PATH = "editor/app-tags.json";

export const appTagsSpec = defineDocumentSpec<ProjectAppTagDocument>({
    kind: "app-tags",
    version: APP_TAG_SCHEMA_VERSION,
    paths: [APP_TAGS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "an app tag list");
        rejectNewerSchema(record, context, APP_TAG_SCHEMA_VERSION);
        // A present-but-wrong `tags` is corrupt rather than "no tags": the normalizer answers an
        // empty list for anything it cannot read, and the first edit would write that back over
        // whatever the author actually had.
        if (record.tags !== undefined && !Array.isArray(record.tags)) {
            context.corrupt(`"tags" must be an array, got ${typeof record.tags}`);
        }
        // Same hazard as `tags`, and the values at stake are ones the author typed into a build
        // dialog: the normalizer answers an empty record for anything it cannot read, and the first
        // edit would write that back over whatever was there.
        if (record.pluginConfig !== undefined
            && (typeof record.pluginConfig !== "object"
                || record.pluginConfig === null
                || Array.isArray(record.pluginConfig))
        ) {
            context.corrupt(`"pluginConfig" must be an object, got ${typeof record.pluginConfig}`);
        }
        // Same hazard again, and this one decides which art ships: a build axis whose position is
        // unreadable would fall back to "nothing declared", and the build would refuse rather than
        // quietly pick - but the first edit would still write the empty record over what was there.
        if (record.assetAxes !== undefined
            && (typeof record.assetAxes !== "object"
                || record.assetAxes === null
                || Array.isArray(record.assetAxes))
        ) {
            context.corrupt(`"assetAxes" must be an object, got ${typeof record.assetAxes}`);
        }
        return migrateProjectAppTagDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "appTags", value: document.tags.length}],
    }),
    diff: diffAppTags,
});

const LABEL = {
    added: "documentDiff.appTags.added",
    removed: "documentDiff.appTags.removed",
    renamed: "documentDiff.appTags.renamed",
    displayName: "documentDiff.appTags.displayName",
    identifier: "documentDiff.appTags.identifier",
    version: "documentDiff.appTags.version",
    plugins: "documentDiff.appTags.plugins",
    assetAxes: "documentDiff.appTags.assetAxes",
    scenes: "documentDiff.appTags.scenes",
    ending: "documentDiff.appTags.ending",
    order: "documentDiff.appTags.order",
} as const;

/** The three identity fields a variant may state differently, and the label each one is read under. */
const OVERRIDE_LABELS = [
    ["displayName", LABEL.displayName],
    ["identifier", LABEL.identifier],
    ["version", LABEL.version],
] as const;

/**
 * One row per variant, plus the values every variant inherits.
 *
 * The three root records are compared as well as the tags, because they are what an unstated key on
 * a variant resolves to: an edit there changes what every edition of the project builds as, and a
 * comparison that only walked the tags would report nothing at all for it. They carry no `subject` -
 * they belong to the project rather than to anything the author named.
 */
export function diffAppTags(base: ProjectAppTagDocument, head: ProjectAppTagDocument, options: {limit: number}): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(byId(base.tags), byId(head.tags))) {
        const path = ["tags", entry.key];
        const subject = authoredName(entry.head?.name) ?? authoredName(entry.base?.name);
        if (!entry.base || !entry.head) {
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {subject}));
            continue;
        }
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            rows.push(change([...path, "name"], "changed", LABEL.renamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject,
            }));
        }
        for (const [key, label] of OVERRIDE_LABELS) {
            if (!sameJsonValue(entry.base.overrides?.[key], entry.head.overrides?.[key])) {
                // An absent key is this variant inheriting the project's value, so one side of the
                // pair is simply missing - which is what the surface draws for a value that was
                // gained or given up.
                rows.push(change([...path, key], presence(entry.base.overrides?.[key], entry.head.overrides?.[key]), label, {
                    params: fromToParams(entry.base.overrides?.[key], entry.head.overrides?.[key]),
                    subject,
                }));
            }
        }
        for (const [key, label] of [
            ["pluginConfig", LABEL.plugins],
            ["assetAxes", LABEL.assetAxes],
            ["reachableScenes", LABEL.scenes],
            ["endingSurfaceId", LABEL.ending],
        ] as const) {
            if (!sameJsonValue(entry.base[key], entry.head[key])) {
                rows.push(change([...path, key], presence(entry.base[key], entry.head[key]), label, {subject}));
            }
        }
    }

    for (const [key, label] of [
        ["pluginConfig", LABEL.plugins],
        ["assetAxes", LABEL.assetAxes],
        ["reachableScenes", LABEL.scenes],
    ] as const) {
        if (!sameJsonValue(base[key], head[key])) {
            rows.push(change([key], presence(base[key], head[key]), label));
        }
    }

    // The list is the order the variants are drawn in, which the author arranged. Reported only
    // when the same variants came out in a different order - a variant that arrived or left has
    // already been reported as itself.
    if (!sameJsonValue(sharedOrder(base, head), sharedOrder(head, base))) {
        rows.push(change(["tags"], "moved", LABEL.order));
    }

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

/** The ids of `source`'s tags that `other` also has, in `source`'s order. */
function sharedOrder(source: ProjectAppTagDocument, other: ProjectAppTagDocument): string[] {
    const known = new Set(other.tags.map(tag => tag.id));
    return source.tags.map(tag => tag.id).filter(id => known.has(id));
}

function presence(base: unknown, head: unknown): "added" | "removed" | "changed" {
    if (base === undefined) {
        return "added";
    }
    return head === undefined ? "removed" : "changed";
}
