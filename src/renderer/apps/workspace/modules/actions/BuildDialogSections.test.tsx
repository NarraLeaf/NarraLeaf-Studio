import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildPreflightSection } from "@shared/types/gameBuild";
import type { SigningCredential } from "@shared/types/signing";
import { RELEASE_APP_TAG, resolveAppTagIdentity, type ProjectAppTag } from "@shared/types/appTag";
import type { PluginBuildConfigFieldContribution } from "@shared/types/plugins";
import type { PluginBuildConfigDeclaringPlugin } from "@shared/utils/pluginBuildConfig";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { ProjectDependencyResolution, ProjectDependencyTable } from "@shared/types/pluginDependencies";
import {
    buildPluginEntries,
    BuildDialogContent,
    ContentSection,
    OutputSection,
    type BuildDialogInfo,
    type BuildPluginEntry,
} from "./BuildDialog";
import { build as enBuild } from "@shared/i18n/catalog/en/build";
import {
    BUILD_DIALOG_PAGES,
    BUILD_DIALOG_SECTIONS,
    initialDialogState,
    OFFERED_FORMATS,
    togglePlatform,
} from "./buildDialogState";
import { SigningSection, SigningSummary } from "./BuildSigningSection";

/**
 * Guards the things about the Signing section that cannot be seen from its own
 * file: that the dialog's rail actually shows it, that the editable rows the
 * project panel hosts appear one per signable platform, and that the dialog's
 * read-only mirror reports the same selection without claiming anything the
 * vault has not answered for yet.
 *
 * Rendered with `renderToStaticMarkup`, so effects never run - what is being
 * checked is the shape each takes before it has heard from the vault, which is
 * also the first thing an author sees.
 */

/**
 * Every section a preflight finding can name. Written as a total record so the
 * union growing breaks this file at compile time, and the assertion below then
 * fails until the rail grows with it - which is the failure that shipped once
 * already: `signing` findings existed with no section to render them in.
 */
const EVERY_SECTION: Record<BuildPreflightSection, true> = {
    targets: true,
    identity: true,
    content: true,
    plugins: true,
    signing: true,
    output: true,
};

const noop = () => undefined;
const neverRemoves = async (_credential: SigningCredential) => false;

/** A project called "My Game", with only the release variant and no plugin asking for anything. */
const info: BuildDialogInfo = {
    hostPlatform: "macos",
    hostArch: "arm64",
    productName: "My Game",
    appId: "com.example.game",
    appTags: [RELEASE_APP_TAG],
    baseIdentity: { displayName: "My Game", identifier: "com.example.game", version: "1.0.0" },
    configurablePlugins: [],
    locales: [],
    defaultOutputDir: "/tmp/dist",
    electronMirror: "",
};

const DEMO_TAG: ProjectAppTag = { id: "tag-demo", name: "Demo", overrides: {} };

const withVariant: BuildDialogInfo = { ...info, appTags: [RELEASE_APP_TAG, DEMO_TAG] };

describe("the build dialog's rail", () => {
    it("has a section for every section a finding can name", () => {
        expect([...BUILD_DIALOG_SECTIONS].sort()).toEqual(Object.keys(EVERY_SECTION).sort());
    });

    it("keeps Output last, so the footer's Build button is the end of the walk", () => {
        expect(BUILD_DIALOG_SECTIONS[BUILD_DIALOG_SECTIONS.length - 1]).toBe("output");
    });

    /**
     * The variant page is a page and not a section, and it comes first. A finding filed against it
     * would render nowhere for a project that has only the release variant, which is the project the
     * page is hidden for.
     */
    it("is the sections with the variant page in front of them", () => {
        expect(BUILD_DIALOG_PAGES).toEqual(["variant", ...BUILD_DIALOG_SECTIONS]);
        expect(Object.keys(EVERY_SECTION)).not.toContain("variant");
    });
});

/**
 * The targets section renders one pill per offered format, straight off
 * OFFERED_FORMATS and labelled by `build.format.<format>`. That indirection is
 * what makes a new format cheap and also what makes it silent: a format added
 * to the table with no label renders an untranslated key in the dialog, and
 * nothing else in the suite would notice.
 */
describe("the targets section's format pills", () => {
    it("offers Android both of its packages, with the APK first", () => {
        // Two formats of one platform, not two platforms: same payload, same
        // signing credential, different container.
        expect(OFFERED_FORMATS.android).toEqual(["apk", "aab"]);
    });

    it("has a label for every format any platform offers", () => {
        for (const [platform, formats] of Object.entries(OFFERED_FORMATS)) {
            for (const format of formats) {
                expect(enBuild.format[format], `build.format.${format} is missing (offered by ${platform})`)
                    .toBeTruthy();
            }
        }
    });

    it("starts Android on the APK alone, so the AAB is a deliberate choice", () => {
        // Both formats mean a second container built from the same payload; the
        // preflight warning is what points a publishing author at the AAB.
        const state = togglePlatform(initialDialogState(null, "windows", "x64"), "android", true);
        expect([...state.formats.android]).toEqual(["apk"]);
    });
});

describe("SigningSection", () => {
    it("shows one row per signable target in the selection", () => {
        const markup = renderToStaticMarkup(
            <SigningSection
                platforms={["windows", "android"]}
                signing={{}}
                onChange={noop}
                onRemove={neverRemoves}
            />,
        );

        expect(markup).toContain("Windows");
        expect(markup).toContain("Android");
        // macOS signing is a later batch and must not offer a row; Linux and iOS
        // are signable but were not selected here.
        expect(markup).not.toContain("macOS");
        expect(markup).not.toContain("Linux");
        expect(markup).not.toContain("iOS");
    });

    it("says so when nothing selected can be signed", () => {
        const markup = renderToStaticMarkup(
            <SigningSection platforms={[]} signing={{}} onChange={noop} onRemove={neverRemoves} />,
        );

        expect(markup).toContain("Select a target that can be signed.");
    });

    it("renders the section's findings underneath the rows", () => {
        const markup = renderToStaticMarkup(
            <SigningSection platforms={["linux"]} signing={{}} onChange={noop} onRemove={neverRemoves}>
                <p>a finding</p>
            </SigningSection>,
        );

        expect(markup).toContain("a finding");
    });
});

/**
 * The dialog's half: a last look, not a second place to change things.
 *
 * The picker and the import form live in Project ▸ Settings now, so what a regression could take
 * away here is the reporting - and one specific lie. `signing.list()` has not answered during a
 * static render, so an id that IS on this machine still resolves to nothing; saying "Missing on this
 * machine" at that moment would be a warning that appears on every open and then withdraws itself.
 */
describe("SigningSummary", () => {
    it("names what signs each target, and says so where nothing is chosen", () => {
        const markup = renderToStaticMarkup(
            <SigningSummary platforms={["windows", "android"]} signing={{}} />,
        );

        expect(markup).toContain("Windows");
        expect(markup).toContain("Android");
        expect(markup).toContain("Not signed");
        expect(markup).not.toContain("macOS");
    });

    it("offers no control: choosing and importing are the panel's, not the dialog's", () => {
        const markup = renderToStaticMarkup(
            <SigningSummary platforms={["windows"]} signing={{ windows: "cred-1" }} />,
        );

        expect(markup).not.toContain("<select");
        expect(markup).not.toContain("Import");
    });

    it("does not call a credential missing before the vault has answered", () => {
        const markup = renderToStaticMarkup(
            <SigningSummary platforms={["windows"]} signing={{ windows: "cred-1" }} />,
        );

        expect(markup).not.toContain("Missing on this machine");
    });

    it("says so when nothing selected can be signed", () => {
        const markup = renderToStaticMarkup(<SigningSummary platforms={[]} signing={{}} />);

        expect(markup).toContain("Select a target that can be signed.");
    });

    it("renders the findings and the jump back to the panel underneath the rows", () => {
        const markup = renderToStaticMarkup(
            <SigningSummary platforms={["linux"]} signing={{}}>
                <p>a finding</p>
            </SigningSummary>,
        );

        expect(markup).toContain("a finding");
    });
});

describe("buildPluginEntries", () => {
    const table: ProjectDependencyTable = {
        schemaVersion: 1,
        plugins: [
            { id: "narraleaf.gallery", name: "Gallery", builtIn: true, authoredVersion: "1.2.0", hard: true, usedBy: {} },
            { id: "someone.unnamed", builtIn: false, authoredVersion: "0.4.1", hard: false, usedBy: {} },
        ],
    };

    it("prefers the resolution, which is the only thing that knows the plugin is unusable here", () => {
        const resolution: ProjectDependencyResolution = {
            entries: [{
                dependency: table.plugins[0],
                installedVersion: "2.0.0",
                status: "incompatible",
                suppressed: true,
            }],
            suppressedPluginIds: ["narraleaf.gallery"],
            overall: "blocked",
        };

        expect(buildPluginEntries(resolution, table)).toEqual([{
            id: "narraleaf.gallery",
            label: "Gallery",
            version: "1.2.0",
            status: "incompatible",
            suppressed: true,
        }]);
    });

    it("still names what ships before the first resolve, without claiming a status", () => {
        expect(buildPluginEntries(null, table)).toEqual([
            { id: "narraleaf.gallery", label: "Gallery", version: "1.2.0" },
            // No recorded name - the id is what is left to call it, and it beats an empty row.
            { id: "someone.unnamed", label: "someone.unnamed", version: "0.4.1" },
        ]);
    });

    it("is empty rather than undefined when the project has no plugin table at all", () => {
        expect(buildPluginEntries(null, null)).toEqual([]);
        expect(buildPluginEntries(null)).toEqual([]);
    });
});

/**
 * The Content section's whole point is that these are controls now, not sentences: an author who
 * disagrees with what it says changes it here rather than closing the dialog and crossing the
 * workspace. So what is asserted is that the switches exist, carry the current setting, and go
 * read-only with the workspace - the three things a regression would silently take away.
 */
describe("ContentSection", () => {
    const desktopOnly = initialDialogState(null, "macos", "arm64");
    const noop = () => undefined;

    const render = (
        overrides: Partial<Parameters<typeof ContentSection>[0]> = {},
    ) => renderToStaticMarkup(
        <ContentSection
            info={info}
            state={desktopOnly}
            content={{ encryptAssets: false, allowHttp: false }}
            plugins={[]}
            saving={null}
            rescanning={false}
            findings={[]}
            onContentChange={noop}
            onRescanPlugins={noop}
            {...overrides}
        />,
    );

    beforeEach(() => {
        frozen = false;
    });

    it("offers a switch per setting, reporting what the project currently says", () => {
        const markup = render({ content: { encryptAssets: true, allowHttp: false } });

        expect(markup).toContain('aria-label="Asset protection"');
        expect(markup).toContain('aria-label="Network policy"');
        // The consequence line follows the switch, so the two never disagree.
        expect(markup).toContain("Assets and saves are encrypted in the packaged game.");
        expect(markup).toContain("Plain HTTP is blocked.");
    });

    it("switches off with the workspace rather than offering a write that cannot happen", () => {
        frozen = true;
        const markup = render();

        // Every control in the section, switches and Rescan alike.
        expect([...markup.matchAll(/disabled=""/g)]).toHaveLength(3);
    });

    it("says a plugin is unusable here, which the read-only version left out", () => {
        const plugins: BuildPluginEntry[] = [
            { id: "a.fine", label: "Fine", version: "1.0.0", status: "satisfied", suppressed: false },
            { id: "b.broken", label: "Broken", version: "1.0.0", status: "incompatible", suppressed: true },
        ];
        const markup = render({ plugins });

        expect(markup).toContain("Fine 1.0.0");
        expect(markup).toContain("Broken 1.0.0");
        // Suppression outranks the status word: "incompatible" is why, "Disabled" is what it costs.
        expect(markup).toContain(">Disabled<");
        // A word beside every row would hide the one row that needs it.
        expect(markup).not.toContain("Ready");
    });

    it("raises the web caveat only for a selection that includes the web export", () => {
        const notice = "Asset encryption and the HTTP restriction do not apply to it.";

        expect(render()).not.toContain(notice);
        expect(render({ state: togglePlatform(desktopOnly, "web", true) })).toContain(notice);
    });
});

/**
 * The page that picks the variant, and the one thing about it that is not visible from its own
 * markup: it is there at all only for a project that has something to pick.
 */
describe("the variant page", () => {
    const render = (dialogInfo: BuildDialogInfo, appTagId: string) => renderToStaticMarkup(
        <BuildDialogContent
            info={dialogInfo}
            initialState={{ ...initialDialogState(null, "macos", "arm64"), appTagId }}
            initialPage="variant"
            copyright=""
            signing={{}}
            initialContent={{ encryptAssets: false, allowHttp: false }}
            initialPlugins={[]}
            appTagService={null}
            loadStoryUsage={null}
            onChange={noop}
            onPersistContent={async () => undefined}
            onRescanPlugins={async () => []}
            onEditIdentity={noop}
            onEditSigning={noop}
            onCommit={noop}
            onCancel={noop}
            runPreflight={async () => []}
        />,
    );

    it("lists every variant, release first, and marks the selected one", () => {
        const markup = render(withVariant, "tag-demo");

        expect(markup).toContain('data-build-app-tag="tag-demo"');
        expect(markup).toContain('data-build-app-tag-option="release"');
        expect(markup).toContain('data-build-app-tag-option="tag-demo"');
        expect(markup.indexOf('data-build-app-tag-option="release"'))
            .toBeLessThan(markup.indexOf('data-build-app-tag-option="tag-demo"'));
    });

    it("says of each identity value whether the variant states it or reads the project's", () => {
        const stated: ProjectAppTag = { ...DEMO_TAG, overrides: { displayName: "My Game Demo" } };
        const markup = render({ ...info, appTags: [RELEASE_APP_TAG, stated] }, "tag-demo");

        expect(markup).toContain("My Game Demo");
        expect(markup).toContain("From the build variant");
        // The two values it does not state.
        expect([...markup.matchAll(/From the project/g)]).toHaveLength(2);
    });

    it("claims nothing about what is blocking until preflight has answered", () => {
        // Effects do not run under a static render, so this is the dialog before its first check.
        expect(render(withVariant, "")).not.toContain("Nothing is blocking this build.");
    });

    it("is absent for a project whose only variant is Release", () => {
        const markup = render(info, "");

        expect(markup).not.toContain("data-build-app-tag-option");
        // The rail falls back to the first page it does show.
        expect(markup).toContain("Targets");
    });

    it("is the only place the variant is picked", () => {
        // The Identity page reports what the selected variant ships; it no longer chooses it.
        expect(renderToStaticMarkup(
            <BuildDialogContent
                info={withVariant}
                initialState={initialDialogState(null, "macos", "arm64")}
                initialPage="identity"
                copyright=""
                signing={{}}
                initialContent={{ encryptAssets: false, allowHttp: false }}
                initialPlugins={[]}
                appTagService={null}
            loadStoryUsage={null}
                onChange={noop}
                onPersistContent={async () => undefined}
                onRescanPlugins={async () => []}
                onEditIdentity={noop}
                onEditSigning={noop}
                onCommit={noop}
                onCancel={noop}
                runPreflight={async () => []}
            />,
        )).not.toContain("<select");
    });
});

/**
 * The page that holds what plugins asked the author for.
 *
 * Two things about it are invisible from its own markup and are what a regression would take away:
 * it is there only where a plugin asks something of the platforms *currently* selected, and a value
 * the variant states itself is the only one that grows a Restore.
 */
describe("the plugins page", () => {
    const declaring = (fields: PluginBuildConfigFieldContribution[]): PluginBuildConfigDeclaringPlugin => ({
        pluginId: "acme.storefront",
        enabled: true,
        manifest: { name: "Acme Storefront", contributes: { buildConfig: fields } },
    });

    const appId: PluginBuildConfigFieldContribution = {
        key: "appId",
        label: "Storefront app id",
        type: "text",
        scope: "variant",
        required: true,
    };

    /**
     * Only what the page reads while rendering. The service's mutations are immediate and not
     * undoable, so nothing here may call one; a stub keeps the test honest about that.
     */
    const stubService = (stated?: string) => ({
        resolvePluginConfigValue: (id: string | null | undefined) => (stated !== undefined && id
            ? { value: stated, overridden: true }
            : { value: "inherited-id", overridden: false }),
        onTagsChanged: () => () => undefined,
    }) as unknown as AppTagService;

    const render = (
        plugins: PluginBuildConfigDeclaringPlugin[],
        options: { appTagId?: string; service?: AppTagService | null } = {},
    ) => renderToStaticMarkup(
        <BuildDialogContent
            info={{ ...withVariant, configurablePlugins: plugins }}
            initialState={{
                ...initialDialogState(null, "macos", "arm64"),
                appTagId: options.appTagId ?? "tag-demo",
            }}
            initialPage="plugins"
            copyright=""
            signing={{}}
            initialContent={{ encryptAssets: false, allowHttp: false }}
            initialPlugins={[]}
            appTagService={options.service ?? stubService()}
            loadStoryUsage={null}
            onChange={noop}
            onPersistContent={async () => undefined}
            onRescanPlugins={async () => []}
            onEditIdentity={noop}
            onEditSigning={noop}
            onCommit={noop}
            onCancel={noop}
            runPreflight={async () => []}
        />,
    );

    it("groups the fields under the plugin that declared them", () => {
        const markup = render([declaring([appId])]);

        expect(markup).toContain("Acme Storefront");
        expect(markup).toContain("Storefront app id");
        expect(markup).toContain('data-build-plugin-field="acme.storefront:appId"');
    });

    it("shows the inherited value as the placeholder, and no Restore, until the variant states one", () => {
        const markup = render([declaring([appId])]);

        expect(markup).toContain('placeholder="inherited-id"');
        expect(markup).not.toContain("data-build-plugin-restore");
    });

    it("grows a Restore exactly where the variant states its own value", () => {
        const markup = render([declaring([appId])], { service: stubService("demo-id") });

        expect(markup).toContain('value="demo-id"');
        expect(markup).toContain('data-build-plugin-restore="acme.storefront:appId"');
    });

    it("never shows a secret, and says which of the three states it is in", () => {
        const secret: PluginBuildConfigFieldContribution = {
            key: "uploadToken",
            label: "Upload token",
            type: "secret",
            scope: "global",
        };
        // A global field reads the project's record, which this stub answers nothing for.
        const empty = { resolvePluginConfigValue: () => ({ value: "", overridden: false }) } as unknown as AppTagService;
        const markup = render([declaring([secret])], { service: empty });

        expect(markup).toContain("Not set");
        expect(markup).toContain("Enter a new value");
        expect(markup).toContain('type="password"');
    });

    it("is absent when no installed plugin asks for anything", () => {
        // The rail falls back to the first page it does show, and the walk is what it always was.
        expect(render([])).not.toContain("data-build-plugin-field");
    });

    it("is absent when the only field belongs to a platform this build is not producing", () => {
        // The selection is macOS alone, so a Windows-only field is not a question about this build.
        const markup = render([declaring([{ ...appId, platforms: ["windows"] }])]);

        expect(markup).not.toContain("data-build-plugin-field");
        expect(markup).not.toContain("Storefront app id");
    });
});

/**
 * The predicted file names. They are a promise about what lands in the output folder, so what is
 * asserted is the promise a variant changes: two variants built into one folder must not name the
 * same file, and release must keep naming what it always named.
 */
describe("OutputSection's artifact prediction", () => {
    const windowsZip = { ...initialDialogState(null, "windows", "x64") };
    const render = (variant: ProjectAppTag) => renderToStaticMarkup(
        <OutputSection
            info={info}
            state={windowsZip}
            variant={variant}
            identity={resolveAppTagIdentity(variant, info.baseIdentity)}
            findings={[]}
            onChange={noop}
        />,
    );

    it("names release's artifacts from the project alone", () => {
        expect(render(RELEASE_APP_TAG)).toContain("My-Game-1.0.0-win-x64.zip");
    });

    it("carries the variant's name, even where the variant overrides nothing", () => {
        expect(render(DEMO_TAG)).toContain("My-Game-Demo-1.0.0-win-x64.zip");
    });

    it("names the project and the edition, not the application the variant renames to", () => {
        const renamed: ProjectAppTag = { ...DEMO_TAG, overrides: { displayName: "Something Else" } };
        const markup = render(renamed);

        expect(markup).toContain("My-Game-Demo-1.0.0-win-x64.zip");
        expect(markup).not.toContain("Something-Else");
    });
});

/**
 * The icon rows read the project's icons through the workspace context, which a static render has
 * none of. Stubbed so the Identity page can be rendered at all; what is asserted about that page is
 * what it no longer contains.
 */
vi.mock("./BuildIconRow", () => ({
    BuildIconRow: () => null,
}));

// The section reaches the vault through the app bridge, which does not exist
// outside Electron. Effects do not run under static rendering, so this only has
// to be importable.
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => {
        throw new Error("the build dialog must not reach the vault while rendering");
    },
}));

/**
 * The freeze is read through the workspace context, which no static render has. Mocked at the
 * context-reading hook rather than at `useFreezeGuard`, so the guard under test is the real one -
 * what is being checked is which controls it switches off, and a stubbed guard would only check
 * that the stub was called.
 */
let frozen = false;
vi.mock("../../hooks/useWorkspaceFrozen", () => ({
    useWorkspaceFrozen: () => frozen,
}));
