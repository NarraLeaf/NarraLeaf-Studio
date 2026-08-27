import { describe, expect, it } from "vitest";
import type { DownloadProgressEvent } from "@shared/types/downloadProgress";
import { BuilderDownloadWatcher, readBuilderDownloadLine } from "./builderDownloadLog";

/**
 * The lines are electron-builder's and app-builder's own, transcribed from a real run rather than
 * invented: an assertion against a shape nobody has seen would pass while matching nothing.
 */
const APP_BUILDER_START = "  • downloading     url=https://ziglang.org/download/index.json size=18 EB parts=1";
const APP_BUILDER_END = "  • downloaded      url=https://ziglang.org/download/index.json duration=1.77s";
const NODE_START = "  • downloading     release=winCodeSign-2.6.0 file=winCodeSign-2.6.0.7z";

describe("reading electron-builder's log for downloads", () => {
    it("opens and closes a transfer on the pair of lines that describe it", () => {
        expect(readBuilderDownloadLine(APP_BUILDER_START)).toEqual({
            phase: "start",
            id: "https://ziglang.org/download/index.json",
            kind: "toolchainDownload",
        });
        expect(readBuilderDownloadLine(APP_BUILDER_END)).toEqual({
            phase: "end",
            id: "https://ziglang.org/download/index.json",
        });
    });

    it("names the transfer by its file when the line carries no url", () => {
        expect(readBuilderDownloadLine(NODE_START)).toEqual({
            phase: "start",
            id: "winCodeSign-2.6.0.7z",
            kind: "toolchainDownload",
        });
    });

    it("reads a line the child coloured for a terminal it thought was watching", () => {
        const coloured = "  [34m•[39m downloading     [34murl[39m=https://example.test/a.7z";
        expect(readBuilderDownloadLine(coloured)).toEqual({
            phase: "start",
            id: "https://example.test/a.7z",
            kind: "toolchainDownload",
        });
    });

    it("says nothing about a line that merely mentions downloading", () => {
        // The readout can go quiet when electron-builder rewords its log; it must never invent a
        // download out of a build's own prose, which is the failure that would be visible.
        expect(readBuilderDownloadLine("  • packaging  file=my-downloading-game.exe")).toBeNull();
        expect(readBuilderDownloadLine("nlplugin: downloading https://example.test/dep.zip")).toBeNull();
        expect(readBuilderDownloadLine("  • building        target=nsis")).toBeNull();
        expect(readBuilderDownloadLine("")).toBeNull();
    });
});

describe("BuilderDownloadWatcher", () => {
    it("holds back a line the pipe split in half", () => {
        const seen: DownloadProgressEvent[] = [];
        const watcher = new BuilderDownloadWatcher(event => seen.push(event));

        watcher.read("  • downloa");
        expect(seen).toEqual([]);
        watcher.read("ding     url=https://example.test/a.7z size=7 MB\n");

        expect(seen).toEqual([
            { phase: "start", id: "https://example.test/a.7z", kind: "toolchainDownload" },
        ]);
    });

    it("reads several lines out of one chunk, whatever the host's line endings are", () => {
        const seen: DownloadProgressEvent[] = [];
        const watcher = new BuilderDownloadWatcher(event => seen.push(event));

        watcher.read([
            "  • packaging       platform=windows",
            "  • downloading     url=https://example.test/a.7z",
            "  • downloaded      url=https://example.test/a.7z duration=3s",
            "",
        ].join("\r\n"));

        expect(seen.map(event => event.phase)).toEqual(["start", "end"]);
    });
});
