import { RELEASE_APP_TAG } from "@shared/types/appTag";
import { DEFAULT_LINTING_CONFIGURATION, DEFAULT_NETWORK_CONFIGURATION } from "../workspace/project/configuration";
import type { LintContext } from "./context";

/**
 * An empty-but-valid {@link LintContext} for rule tests.
 *
 * Exists so a rule test is one line of setup - `createTestLintContext({ stories: [...] })` - rather
 * than twelve lines of empty collections that every new rule file would copy and that would all
 * need editing the day the context grows a field. `io` refuses everything (`null` / `ok: false`),
 * which is the correct default: a test that cares about bytes says so by overriding it.
 */
export function createTestLintContext(overrides: Partial<LintContext> = {}): LintContext {
    return {
        config: { ...DEFAULT_LINTING_CONFIGURATION },
        // The secure default, same as a new project. A test about the network rule turns it on.
        network: { ...DEFAULT_NETWORK_CONFIGURATION },
        stories: [],
        // Same footing as `assetIndex` below: a rule test asserts on the rule, so what it is given
        // is the whole project unless the test is about what happens when it is not.
        storiesComplete: true,
        blueprintDocument: null,
        uiDocument: null,
        assets: [],
        referencedAssetIds: new Set<string>(),
        assetReferences: new Map(),
        // A rule test asserts on the rule, so the index it reads is complete unless the test is
        // about what happens when it is not.
        assetIndex: { complete: true, gaps: [] },
        characters: [],
        // The release variant, because every project has it and a rule that saw an empty list would
        // be reading a state no project can be in.
        appTags: [RELEASE_APP_TAG],
        declaredExternalLinks: [],
        variableRegistry: [],
        persistentNameCollisions: [],
        savedNameCollisions: [],
        localization: null,
        localizationKeyNames: null,
        voice: null,
        buildPlatforms: [],
        io: {
            exists: async () => false,
            readBytes: async () => null,
            probeImage: async () => ({ ok: false, reason: "test context has no io" }),
        },
        ...overrides,
    };
}
