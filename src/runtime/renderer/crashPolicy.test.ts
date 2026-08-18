// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimAutomaticRestart,
  clearAutomaticRestarts,
  getRuntimeCrashPolicy,
  setRuntimeCrashPolicy
} from "./crashPolicy";

describe("setRuntimeCrashPolicy", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setRuntimeCrashPolicy(undefined);
  });

  it("shows the error until told otherwise, which is what every build did before this setting", () => {
    expect(getRuntimeCrashPolicy()).toBe("details");
  });

  it("takes the three policies", () => {
    for (const policy of ["details", "log", "restart"] as const) {
      setRuntimeCrashPolicy(policy);
      expect(getRuntimeCrashPolicy()).toBe(policy);
    }
  });

  it("refuses a value it does not recognize rather than carrying it", () => {
    // An older pack, or a marker from a build that knew a policy this one does not.
    setRuntimeCrashPolicy("shout");
    expect(getRuntimeCrashPolicy()).toBe("details");
  });
});

describe("claimAutomaticRestart", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearAutomaticRestarts();
  });

  it("allows restarts up to the limit and then stops", () => {
    expect(claimAutomaticRestart(3)).toBe(true);
    expect(claimAutomaticRestart(3)).toBe(true);
    expect(claimAutomaticRestart(3)).toBe(true);
    // A game that fails on the way up would otherwise reload forever, and the player would
    // never get to read what happened.
    expect(claimAutomaticRestart(3)).toBe(false);
  });

  it("counts across the reload it is counting, which is the whole point", () => {
    claimAutomaticRestart(3);

    // A reload keeps sessionStorage but nothing else; the module is evaluated afresh.
    expect(window.sessionStorage.getItem("nl.crash.autoRestarts")).toBe("1");
  });

  it("forgets the count once the game has come up", () => {
    claimAutomaticRestart(3);
    claimAutomaticRestart(3);
    clearAutomaticRestarts();

    // Otherwise a game that crashed once on Monday would refuse to restart itself on Tuesday.
    expect(claimAutomaticRestart(3)).toBe(true);
  });
});
