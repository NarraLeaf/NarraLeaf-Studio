import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetWorkspaceFreeze, reportWorkspaceFreeze } from "../../utils/workspaceFreeze";
import type { RevisionSnapshotResult } from "../vcs/revisionSnapshot";
import { resolveDevModeLaunchSource } from "./revisionLaunchSource";

/**
 * Which directory a launch compiles from.
 *
 * The whole point of the milestone is one branch: while the workspace shows a revision, Run must not
 * quietly compile the working tree. So every case below asserts on the RESULTING DIRECTORY - a test
 * that only checked "it threw" would still pass if the refusal were replaced by a fallback.
 */

const PROJECT = path.resolve("/tmp/nl-launch-source");
const REVISION = "abc123def456".padEnd(64, "0");

function snapshot(directory: string): RevisionSnapshotResult {
  return { directory, files: 1, bytes: 1, skippedFiles: 0, skippedBytes: 0, durationMs: 1 };
}

afterEach(() => {
  forgetWorkspaceFreeze(PROJECT);
});

describe("resolveDevModeLaunchSource", () => {
  it("compiles the working tree when nothing is frozen", async () => {
    const materialize = vi.fn();
    await expect(
      resolveDevModeLaunchSource({ projectPath: PROJECT, materialize })
    ).resolves.toEqual({ directory: PROJECT });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("compiles the working tree under a manual freeze, because that is what is on disk", async () => {
    // Not an oversight. Browsing history does not touch the working tree, so during a manual freeze
    // the files on disk ARE what the author is looking at - and the production build and Preview
    // refuse anyway, which is a consistency guard rather than this one.
    reportWorkspaceFreeze(PROJECT, "manual");
    const materialize = vi.fn();
    await expect(
      resolveDevModeLaunchSource({ projectPath: PROJECT, materialize })
    ).resolves.toEqual({ directory: PROJECT });
    expect(materialize).not.toHaveBeenCalled();
  });

  it("compiles the snapshot while a revision is shown", async () => {
    reportWorkspaceFreeze(PROJECT, "revision", REVISION);
    const directory = path.join(
      PROJECT,
      ".nlstudio",
      "devmode",
      "revisions",
      REVISION.slice(0, 16)
    );
    const materialize = vi.fn(async () => snapshot(directory));

    await expect(
      resolveDevModeLaunchSource({ projectPath: PROJECT, materialize })
    ).resolves.toEqual({ directory, revision: REVISION });
    expect(materialize).toHaveBeenCalledWith(REVISION);
  });

  it("refuses when the revision cannot be read, rather than falling back", async () => {
    reportWorkspaceFreeze(PROJECT, "revision", REVISION);
    const materialize = vi.fn(async () => {
      throw new Error("Revision is not in this repository");
    });

    const failure = await resolveDevModeLaunchSource({ projectPath: PROJECT, materialize }).catch(
      (error: unknown) => error
    );

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    // Written for the author, and it says nothing ran: an author who has seen other tools fall back
    // will otherwise assume that is what happened.
    expect(message).toContain("abc123def456");
    expect(message).toContain("Revision is not in this repository");
    expect(message).toContain("Nothing was run");
  });

  it("refuses a revision freeze that did not say which revision", async () => {
    // Reachable from a renderer older than the field, because the report crosses IPC. Guessing "the
    // tip" here would run the current game under a past version's name, which is the exact failure
    // this milestone exists to prevent - so the absent id is a refusal.
    reportWorkspaceFreeze(PROJECT, "revision");
    const materialize = vi.fn();

    await expect(resolveDevModeLaunchSource({ projectPath: PROJECT, materialize })).rejects.toThrow(
      /did not say which version/i
    );
    expect(materialize).not.toHaveBeenCalled();
  });

  it("forgets the revision when the workspace reports a manual freeze afterwards", async () => {
    reportWorkspaceFreeze(PROJECT, "revision", REVISION);
    reportWorkspaceFreeze(PROJECT, "manual");
    const materialize = vi.fn();

    await expect(
      resolveDevModeLaunchSource({ projectPath: PROJECT, materialize })
    ).resolves.toEqual({ directory: PROJECT });
    expect(materialize).not.toHaveBeenCalled();
  });
});
