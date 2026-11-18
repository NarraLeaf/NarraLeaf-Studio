// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { STORY_COMMENTS_SCHEMA_VERSION } from "@shared/types/storyComments";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryCommentsService } from "@/lib/workspace/services/storyComments/StoryCommentsService";

const workspace = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/apps/workspace/context", () => ({ useOptionalWorkspace: () => workspace.value }));

import { useStoryCommentThreads } from "./storyCommentsState";

function document(id: string): string {
    return JSON.stringify({
        schemaVersion: STORY_COMMENTS_SCHEMA_VERSION,
        threads: {
            [id]: {
                id, storyId: "story", sceneId: "scene", blockId: "block", todo: false,
                resolved: false, createdAt: 1,
                comments: [{ id: "comment", body: id, author: { name: "Ada" }, createdAt: 1 }],
            },
        },
    });
}

describe("story comment threads", () => {
    it("updates the panel snapshot when the service reloads a different document", async () => {
        let contents = document("first");
        const service = new StoryCommentsService();
        const context = {
            project: { getConfig: () => ({ projectPath: "/project" }) },
            services: { get: (id: string) => {
                if (id === Services.StoryComments) return service;
                if (id === Services.FileSystem) return { read: async () => ({ ok: true, data: contents }) };
                throw new Error(`Unexpected service: ${id}`);
            } },
        } as unknown as WorkspaceContext;
        service.setContext(context);
        await service.load();
        workspace.value = { context };

        function Threads() {
            return <output>{useStoryCommentThreads().map(thread => thread.id).join(",")}</output>;
        }
        render(<Threads />);
        expect(screen.getByText("first")).toBeTruthy();

        contents = document("second");
        await act(async () => service.load());
        expect(screen.getByText("second")).toBeTruthy();
    });
});
