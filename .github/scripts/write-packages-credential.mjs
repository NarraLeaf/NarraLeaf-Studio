/**
 * Write the GitHub Packages credential Yarn needs to install the @narraleaf scope.
 *
 * The scope resolves from npm.pkg.github.com (see .yarnrc.yml), and that registry
 * demands a credential for every package it serves - including the ones whose
 * repositories are public. The checkout deliberately carries only the address, so
 * the credential has to arrive at install time, from the environment.
 *
 * It is written to the home directory rather than into the checkout: a file under
 * the workspace can be swept up by an artifact upload or a coverage tarball, and
 * this one would carry a token. Written from an environment variable rather than
 * an argument, so it never appears in a process listing either.
 *
 * Node rather than a shell line because the release workflow runs this on Windows
 * and macOS runners too, where $HOME and the quoting rules are not the same.
 */
import {existsSync, writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

const token = process.env.GITHUB_PACKAGES_TOKEN;
if (!token) {
    // Failing here rather than writing an empty token: an empty credential reads
    // to Yarn as "anonymous", and GitHub Packages answers anonymous requests with
    // 404 rather than 401 - which would send whoever debugs it looking for a
    // package that was never missing.
    console.error("GITHUB_PACKAGES_TOKEN is not set; nothing to write.");
    process.exit(1);
}

const path = join(homedir(), ".yarnrc.yml");
if (existsSync(path)) {
    // A runner starts without this file, so finding one means this is somebody's
    // own machine - where the file already holds their credential and this script
    // would overwrite it with a token meant for a CI job. Refuse rather than
    // silently cost them the one they had.
    console.error(`${path} already exists; refusing to overwrite it. This script is for CI runners.`);
    process.exit(1);
}
writeFileSync(
    path,
    `npmRegistries:\n  "https://npm.pkg.github.com":\n    npmAuthToken: "${token}"\n`,
    {mode: 0o600},
);
console.log(`Wrote the GitHub Packages credential to ${path}.`);
