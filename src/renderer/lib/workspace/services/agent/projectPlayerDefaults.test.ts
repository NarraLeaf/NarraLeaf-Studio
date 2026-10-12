import { describe, expect, it, vi } from "vitest";
import { AGENT_TOOLS } from "@shared/agent/tools";
import { DEFAULT_PLAYER_PREFERENCES, PLAYER_PREFERENCE_KEYS, normalizePlayerPreferences, type PlayerPreferences } from "@shared/types/preference";
import { Services } from "../services";
import type { AgentCallResult } from "@shared/agent/protocol";
import type { AgentToolContext } from "./agentCall";
import { projectSettingsSet, readPlayerDefaults } from "./tools/projectTools";

/**
 * `project_settings_set { playerDefaults }`: the project's starting preferences, checked against the
 * preference table and written through ProjectService like Studio's Project → Game page.
 */

describe("readPlayerDefaults", () => {
    it("accepts known keys in range", () => {
        expect(readPlayerDefaults({ playerDefaults: { cps: 200, autoForwardDelay: 1500, bgmVolume: 0.6, skipReadText: true, voiceEndMode: "fade" } }))
            .toEqual({ cps: 200, autoForwardDelay: 1500, bgmVolume: 0.6, skipReadText: true, voiceEndMode: "fade" });
        expect(readPlayerDefaults({})).toBeUndefined();
    });

    it("refuses unknown keys, out-of-range numbers and wrong kinds instead of clamping", () => {
        expect(() => readPlayerDefaults({ playerDefaults: { textSpeed: 40 } })).toThrow(/not a player preference/);
        expect(() => readPlayerDefaults({ playerDefaults: { cps: 1000 } })).toThrow(/from 1 to 200/);
        expect(() => readPlayerDefaults({ playerDefaults: { bgmVolume: 60 } })).toThrow(/0-1 = 0-100%/);
        expect(() => readPlayerDefaults({ playerDefaults: { skip: "yes" } })).toThrow(/true or false/);
        expect(() => readPlayerDefaults({ playerDefaults: { voiceEndMode: "loud" } })).toThrow(/one of stop, fade, none/);
        expect(() => readPlayerDefaults({ playerDefaults: [] })).toThrow(/must be an object/);
    });

    it("the tool schema lists every preference key", () => {
        const row = AGENT_TOOLS.find(tool => tool.name === "project_settings_set")!;
        const schema = (row.inputSchema.properties as Record<string, { properties?: Record<string, unknown> }>).playerDefaults;
        expect(Object.keys(schema.properties ?? {}).sort()).toEqual([...PLAYER_PREFERENCE_KEYS].sort());
    });
});

describe("project_settings_set playerDefaults", () => {
    it("merges the patch into the project's defaults and reports what changed", async () => {
        let stored: PlayerPreferences = { ...DEFAULT_PLAYER_PREFERENCES };
        const project = {
            getProjectConfig: () => ({ name: "Demo", metadata: { resolution: { width: 1920, height: 1080 } } }),
            getPlayerPreferences: () => stored,
            updatePlayerPreferences: vi.fn(async (patch: Partial<PlayerPreferences>) => { stored = normalizePlayerPreferences({ ...stored, ...patch }); }),
        };
        const tool = {
            ctx: { services: { get: (name: string) => (name === Services.Project ? project : undefined) } },
            request: { callId: "call" },
            follow: { describeCall: vi.fn() },
            log: vi.fn(),
        } as unknown as AgentToolContext;
        const result = await projectSettingsSet({ playerDefaults: { cps: 60, autoForwardDelay: 1200 } }, tool) as AgentCallResult & { structured?: Record<string, any> };
        expect(project.updatePlayerPreferences).toHaveBeenCalledWith({ cps: 60, autoForwardDelay: 1200 });
        expect(result.structured?.changed).toEqual(["player defaults"]);
        expect(result.structured?.playerDefaults).toMatchObject({ cps: 60, autoForwardDelay: 1200, bgmVolume: 1 });

        const again = await projectSettingsSet({ playerDefaults: { cps: 60 } }, tool) as AgentCallResult & { structured?: Record<string, any> };
        expect(again.structured?.changed).toEqual([]);
        expect(project.updatePlayerPreferences).toHaveBeenCalledTimes(1);
    });
});
