import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported } from "@shared/types/vcs";
import type { LoreGlobals } from "./lore";
import {
  VcsSignInError,
  diagnoseEndpoint,
  readServerSessions,
  signInToServer
} from "./serverSession";

/**
 * Signing in, against a REAL server that verifies who is calling.
 *
 * Skipped unless `LORE_TEST_AUTH_URL` names one, on the same argument
 * `remote.integration.test.ts` makes about `LORE_TEST_REMOTE`: every behaviour worth
 * asserting here is a property of the backend and of a TLS stack, and a mock would assert
 * Studio's idea of both. This file exists because that idea was wrong twice.
 *
 * ```bash
 * # A server that issues tokens, e.g. one supervised by NarraLeaf Team:
 * LORE_TEST_AUTH_URL="https://127.0.0.1:41402" \
 * LORE_TEST_REMOTE="lore://127.0.0.1:41337" \
 *   yarn vitest run src/main/app/application/managers/vcs/serverSession.integration.test.ts
 * ```
 *
 * **The certificate expectations assume the authority is NOT trusted on this machine**,
 * which is the state every machine starts in and the one this file is most useful in. A
 * machine that has trusted it makes the third test's diagnosis wrong and it says so.
 */

const AUTH_URL = (process.env.LORE_TEST_AUTH_URL ?? "").trim();
const REMOTE = (process.env.LORE_TEST_REMOTE ?? "lore://127.0.0.1:41337").trim();
const TOKEN = (process.env.LORE_TEST_TOKEN ?? "").trim();
const enabled = AUTH_URL !== "" && (isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH));

/** A port nothing listens on, for the difference the backend refuses to draw. */
const DEAD_ENDPOINT = "https://127.0.0.1:41999";

const roots: string[] = [];

function tmp(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-signin-")));
  roots.push(root);
  return root;
}

function globalsIn(root: string): LoreGlobals {
  return { repositoryPath: root, offline: false, cache: true };
}

/** Shaped like a token, signed by nothing. Enough to get past the decode and no further. */
function fakeToken(): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
  return [
    segment({ alg: "RS256", typ: "JWT" }),
    segment({ sub: "00000000-0000-4000-8000-000000000000", name: "Nobody", exp: 4102444800 }),
    "c".repeat(16)
  ].join(".");
}

afterAll(() => {
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // A leftover temp directory is not a test failure.
    }
  }
});

describe.skipIf(!enabled)("signing in to a real server", () => {
  it("refuses an address the backend has no implementation for, before opening a socket", async () => {
    const globals = globalsIn(tmp());
    for (const scheme of ["http", "grpc"]) {
      const started = Date.now();
      const attempt = signInToServer(globals, {
        remoteUrl: REMOTE,
        authUrl: AUTH_URL.replace(/^https/, scheme),
        token: fakeToken(),
        userDataDir: tmp()
      });
      await expect(attempt).rejects.toBeInstanceOf(VcsSignInError);
      await attempt.catch((error: VcsSignInError) => {
        expect(error.problem.kind, scheme).toBe("scheme");
      });
      // Refused here, not there: nothing was dialled, so it cannot have taken a
      // round trip. Generous because the assertion is "instant", not a benchmark.
      expect(Date.now() - started).toBeLessThan(1_000);
    }
  });

  it("tells an untrusted authority from a port nothing answers on", async () => {
    // The whole reason this module exists. The backend answers both of these with
    // `failed to connect to auth endpoint: transport error` and nothing else, so
    // without this diagnosis an author is told the same thing whether they need to
    // trust a certificate or to check they typed the right port.
    const listening = await diagnoseEndpoint(AUTH_URL);
    expect(
      listening.kind,
      "nothing answered at the sign-in address, so this machine cannot exercise the" +
        " certificate path - see this file's header"
    ).toBe("authority");
    if (listening.kind === "authority") {
      // Named so it can be compared - by Studio against the token's claim, or by a
      // person against what their server printed. An unnamed "trust something" is
      // not a step anybody can take safely.
      expect(listening.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
      // The certificate itself, which is what gets written and installed. The
      // fingerprint above is computed from these bytes rather than reported
      // alongside them.
      expect(listening.pem).toContain("BEGIN CERTIFICATE");
    }

    const absent = await diagnoseEndpoint(DEAD_ENDPOINT);
    expect(absent.kind).toBe("unreachable");
  });

  it("says the certificate is the problem when the sign-in fails on the transport", async () => {
    const globals = globalsIn(tmp());
    const userDataDir = tmp();
    const attempt = signInToServer(globals, {
      remoteUrl: REMOTE,
      authUrl: AUTH_URL,
      token: fakeToken(),
      userDataDir
    });
    await expect(attempt).rejects.toBeInstanceOf(VcsSignInError);
    await attempt.catch((error: VcsSignInError) => {
      // Not "unknown", and not the backend's sentence passed through: this is the
      // one failure in the whole flow whose remedy changes the machine.
      expect(error.problem.kind).toBe("certificate");
      if (error.problem.kind !== "certificate") return;
      const { authority } = error.problem;
      // The certificate is on this machine by the time the author is asked about
      // it. That is the half that used to be impossible: the command they were
      // given named a file that only existed on the server.
      expect(fs.existsSync(authority.path)).toBe(true);
      expect(fs.readFileSync(authority.path, "utf-8")).toContain("BEGIN CERTIFICATE");
      expect(authority.command).toContain(authority.path);
      // This token vouches for nothing, so there is nothing to compare against and
      // the interface must fall back to asking a person.
      expect(authority.expected).toBe("");
    });
  });

  it("reads the sessions the backend is holding without opening a socket", async () => {
    const started = Date.now();
    const sessions = await readServerSessions({ ...globalsIn(tmp()), offline: true });
    expect(Array.isArray(sessions)).toBe(true);
    // Local by construction. A network read here would put a wait on opening a panel.
    expect(Date.now() - started).toBeLessThan(2_000);
    for (const session of sessions) {
      expect(typeof session.userId).toBe("string");
      expect(typeof session.authUrl).toBe("string");
    }
  });

  it.skipIf(TOKEN === "")(
    "signs in with a real token and finds the account in the store",
    async () => {
      // Needs `LORE_TEST_TOKEN` AND an authority this machine has been told to trust.
      // Both are deliberate manual steps; see the header.
      const globals = globalsIn(tmp());
      const session = await signInToServer(globals, {
        remoteUrl: REMOTE,
        authUrl: AUTH_URL,
        token: TOKEN,
        userDataDir: tmp()
      });
      expect(session.account.userId).not.toBe("");
      expect(session.remoteOrigin).toBe(REMOTE);

      const stored = await readServerSessions({ ...globals, offline: true });
      expect(stored.some((entry) => entry.userId === session.account.userId)).toBe(true);
    }
  );
});
