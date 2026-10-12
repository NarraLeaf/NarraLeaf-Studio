import { describe, expect, it, vi } from "vitest";
import type { StoryBlock } from "@shared/types/story";
import type { StoryPluginActionParamDef } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import {
    editableStoryPluginActionParams,
    storyPluginActionParamsProblem,
    storyPluginParamSelectOptions,
    withStoryPluginParam,
} from "./pluginActionParams";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

const ACHIEVEMENT: StoryPluginActionParamDef = {
    key: "achievementId",
    label: "Achievement",
    kind: "select",
    dynamicOptionsSource: "acme.steam.achievements",
};

const missing = (value: string) => `${value} (missing)`;

describe("storyPluginActionParamsProblem", () => {
    it("accepts no params, an empty list, and a well-formed list", () => {
        expect(storyPluginActionParamsProblem(undefined)).toBeNull();
        expect(storyPluginActionParamsProblem([])).toBeNull();
        expect(storyPluginActionParamsProblem([ACHIEVEMENT, { key: "count", label: "Count", kind: "number" }])).toBeNull();
    });

    it("accepts a kind this Studio does not draw, so a plugin for a later Studio still registers", () => {
        expect(storyPluginActionParamsProblem([{ key: "cover", label: "Cover", kind: "imageAsset" }])).toBeNull();
    });

    it("refuses a list that is not an array, an entry without a key, and a key declared twice", () => {
        expect(storyPluginActionParamsProblem({ key: "a" })).toMatch(/array/);
        expect(storyPluginActionParamsProblem([{ label: "A", kind: "string" }])).toMatch(/key/);
        expect(storyPluginActionParamsProblem([{ key: " ", label: "A", kind: "string" }])).toMatch(/key/);
        expect(storyPluginActionParamsProblem([{ key: "a", kind: "string" }])).toMatch(/label/);
        expect(storyPluginActionParamsProblem([
            { key: "a", label: "A", kind: "string" },
            { key: "a", label: "Again", kind: "number" },
        ])).toMatch(/twice/);
    });
});

describe("editableStoryPluginActionParams", () => {
    it("keeps the kinds this Studio draws, in declaration order", () => {
        const params = [
            { key: "cover", label: "Cover", kind: "imageAsset" } as unknown as StoryPluginActionParamDef,
            ACHIEVEMENT,
            { key: "note", label: "Note", kind: "string" } as const,
        ];
        expect(editableStoryPluginActionParams(params).map(param => param.key)).toEqual(["achievementId", "note"]);
        expect(editableStoryPluginActionParams(undefined)).toEqual([]);
    });
});

describe("storyPluginParamSelectOptions", () => {
    const dynamic = {
        "acme.steam.achievements": [
            { value: "ACH_WIN", label: "ACH_WIN" },
            { value: "ACH_LOSE", label: "ACH_LOSE" },
        ],
    };

    it("lists the plugin's dynamic options after an empty entry", () => {
        expect(storyPluginParamSelectOptions(ACHIEVEMENT, dynamic, "ACH_WIN", missing)).toEqual([
            { value: "", label: "-" },
            { value: "ACH_WIN", label: "ACH_WIN" },
            { value: "ACH_LOSE", label: "ACH_LOSE" },
        ]);
    });

    it("lists a stored value no option answers to, under the missing label", () => {
        const options = storyPluginParamSelectOptions(ACHIEVEMENT, dynamic, "ACH_GONE", missing);
        expect(options.at(-1)).toEqual({ value: "ACH_GONE", label: "ACH_GONE (missing)" });
    });

    it("prefers static options, and keeps a list's own empty entry instead of adding one", () => {
        const param: StoryPluginActionParamDef = {
            key: "mode",
            label: "Mode",
            kind: "select",
            options: [{ value: "", label: "Default" }, { value: "fast", label: "Fast" }],
            dynamicOptionsSource: "acme.steam.achievements",
        };
        expect(storyPluginParamSelectOptions(param, dynamic, undefined, missing)).toEqual([
            { value: "", label: "Default" },
            { value: "fast", label: "Fast" },
        ]);
    });

    it("lists only the empty entry when the source is not registered", () => {
        expect(storyPluginParamSelectOptions({ ...ACHIEVEMENT, emptyOptionLabel: "None" }, {}, undefined, missing))
            .toEqual([{ value: "", label: "None" }]);
    });
});

describe("withStoryPluginParam", () => {
    it("sets a value and leaves the other params alone", () => {
        expect(withStoryPluginParam({ other: true }, "achievementId", "ACH_WIN")).toEqual({ other: true, achievementId: "ACH_WIN" });
        expect(withStoryPluginParam({}, "count", 0)).toEqual({ count: 0 });
    });

    it("drops the key when the field is cleared, without touching the input", () => {
        const params = { achievementId: "ACH_WIN" };
        expect(withStoryPluginParam(params, "achievementId", "")).toEqual({});
        expect(withStoryPluginParam(params, "achievementId", undefined)).toEqual({});
        expect(params).toEqual({ achievementId: "ACH_WIN" });
    });
});

describe("StoryService.registerPluginAction params", () => {
    const createBlock = (): StoryBlock => ({
        id: "row",
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload: { action: "plugin", pluginId: "acme.steam", actionId: "acme.steam.unlock", params: {} },
    });

    it("keeps the declared fields on the registration", () => {
        const service = new StoryService();
        service.registerPluginAction({ id: "acme.steam.unlock", label: "Unlock", createBlock, params: [ACHIEVEMENT] }, "acme.steam");
        expect(service.getPluginAction("acme.steam.unlock")?.params).toEqual([ACHIEVEMENT]);
    });

    it("refuses a malformed field list at registration", () => {
        const service = new StoryService();
        expect(() => service.registerPluginAction({
            id: "acme.steam.unlock",
            label: "Unlock",
            createBlock,
            params: [{ key: "", label: "Achievement", kind: "select" }],
        }, "acme.steam")).toThrow(/acme\.steam\.unlock: params\[0\]\.key/);
        expect(service.getPluginAction("acme.steam.unlock")).toBeUndefined();
    });
});
