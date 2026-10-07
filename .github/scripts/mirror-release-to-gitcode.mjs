#!/usr/bin/env node
/**
 * Copy one release's files to the same-named release on GitCode.
 *
 *   node .github/scripts/mirror-release-to-gitcode.mjs --tag v1.4.3 --from <dir>
 *
 * GitHub is unreachable or crawls from much of mainland China, and a proxy in front of it does not
 * help: the Cloudflare one the download page used to offer has no node there, so its requests land
 * in Los Angeles and a few hundred megabytes arrive at tens of kilobytes a second. GitCode serves
 * release files from a CDN inside China. Studio's updater and the download page both read the copy
 * this puts there.
 *
 * Only the release's files go to GitCode - the installers, their blockmaps and the `latest*.yml`
 * feeds, exactly what the GitHub release already publishes. The GitCode repository holds a README
 * and nothing else; this never pushes code to it. The release is created against that README's
 * branch, so the source archives GitCode attaches to every release contain the README too.
 *
 * The URL layout is GitHub's (`/<owner>/<repo>/releases/download/<tag>/<file>`), which is what lets
 * the download page switch hosts by origin alone and lets the updater's blockmap lookup work
 * unchanged. Two things about GitCode shape the code below: a release file is only reachable by
 * GET (HEAD answers 401), and its listing carries no sizes, so each upload is confirmed by asking
 * for its first byte and reading the total from Content-Range.
 *
 * The feeds are uploaded last. GitCode lists a release as soon as it is created, so between that
 * and the last file the newest release is a partial one; an updater that finds no `latest.yml`
 * there treats GitCode as not having the version yet, which is true.
 *
 * Re-running is safe: a file already there at the right size is skipped.
 *
 * The token comes from GITCODE_TOKEN, or from --token-file (one line; lines starting with # are
 * ignored). It is sent only to api.gitcode.com and never printed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OWNER = "NarraLeaf";
const REPO = "NarraLeaf-Studio";
const API = process.env.GITCODE_API_URL || "https://api.gitcode.com/api/v5";
const SITE = "https://gitcode.com";
/** The branch the README-only repository was created with; releases are tagged against it. */
const TARGET_BRANCH = "main";
const GITHUB_RELEASE = `https://github.com/${OWNER}/${REPO}/releases/tag`;
const UPLOAD_ATTEMPTS = 3;

/** The same set release.yml attaches to the GitHub release. */
const RELEASE_FILE = /\.(exe|dmg|zip|blockmap)$|^latest.*\.yml$/;

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const key = argv[index];
        if (!key.startsWith("--")) {
            throw new Error(`Unexpected argument ${key}`);
        }
        args[key.slice(2)] = argv[index + 1];
        index += 1;
    }
    return args;
}

function readToken(args) {
    if (args["token-file"]) {
        const lines = fs.readFileSync(args["token-file"], "utf8")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#"));
        if (lines.length !== 1) {
            throw new Error(`${args["token-file"]} should hold exactly one token line.`);
        }
        return lines[0];
    }
    if (process.env.GITCODE_TOKEN) {
        return process.env.GITCODE_TOKEN.trim();
    }
    throw new Error("No GitCode token: set GITCODE_TOKEN or pass --token-file.");
}

function api(token) {
    return async (method, route, body) => {
        const response = await fetch(`${API}${route}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(60_000),
        });
        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            // Reported below with the status.
        }
        return { status: response.status, json, text };
    };
}

/** The total size GitCode serves for a release file, or null when it does not serve it. */
async function servedSize(tag, name) {
    const url = `${SITE}/${OWNER}/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    try {
        const response = await fetch(url, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(60_000) });
        await response.body?.cancel();
        if (response.status === 206) {
            const total = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
            return total ? Number(total[1]) : null;
        }
        if (response.status === 200) {
            const length = response.headers.get("content-length");
            return length === null ? null : Number(length);
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * PUT a file to the presigned URL GitCode hands out. curl rather than fetch: the storage behind it
 * wants a Content-Length, which a streamed fetch body does not send, and these files are too large
 * to hold in memory. The headers go through a config file because they carry signatures that the
 * shell has no business quoting.
 */
function putFile(file, url, headers) {
    const config = path.join(os.tmpdir(), `gitcode-upload-${process.pid}-${Date.now()}.txt`);
    const lines = Object.entries(headers ?? {}).map(([key, value]) => `header = "${key}: ${String(value).replace(/"/g, '\\"')}"`);
    fs.writeFileSync(config, `${lines.join("\n")}\n`);
    return new Promise(resolve => {
        const child = spawn("curl", [
            "-sS", "-X", "PUT", "-K", config, "--upload-file", file,
            "--retry", "2", "--connect-timeout", "30",
            "-o", process.platform === "win32" ? "NUL" : "/dev/null",
            "-w", "%{http_code}",
            url,
        ], { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", chunk => { out += chunk; });
        child.stderr.on("data", chunk => { err += chunk; });
        child.on("close", code => {
            fs.rmSync(config, { force: true });
            resolve({ ok: code === 0 && /^2\d\d$/.test(out.trim()), status: out.trim(), error: err.trim() });
        });
    });
}

function formatSize(bytes) {
    return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const tag = args.tag;
    const from = args.from;
    if (!tag || !/^v\d+\.\d+\.\d+/.test(tag) || !from) {
        throw new Error("Usage: --tag vX.Y.Z --from <directory holding the release's files> [--token-file <file>]");
    }
    const call = api(readToken(args));

    const files = fs.readdirSync(from, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && RELEASE_FILE.test(entry.name))
        .map(entry => path.join(entry.parentPath ?? entry.path, entry.name));
    const names = files.map(file => path.basename(file));
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) {
        throw new Error(`Two files are called ${duplicate}; a release file is identified by its name.`);
    }
    if (!names.some(name => name.startsWith("latest") && name.endsWith(".yml"))) {
        throw new Error(`No latest*.yml in ${from}: without it the copy is a release no updater can read.`);
    }
    // Feeds last, so a feed never points at a file that is not there yet; the rest smallest first, so
    // a refusal shows up before the installers have spent minutes uploading.
    const isFeed = file => path.basename(file).endsWith(".yml");
    files.sort((a, b) => Number(isFeed(a)) - Number(isFeed(b)) || fs.statSync(a).size - fs.statSync(b).size);

    let release = await call("GET", `/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`);
    if (release.status === 404 || (release.status === 400 && /release/i.test(release.text))) {
        console.log(`Creating the ${tag} release on GitCode.`);
        const created = await call("POST", `/repos/${OWNER}/${REPO}/releases`, {
            tag_name: tag,
            name: tag,
            body: `NarraLeaf Studio ${tag}\n\n与 GitHub 上的同名发行版是同一批文件，供无法顺畅访问 GitHub 时下载。更新说明见 ${GITHUB_RELEASE}/${tag}\n\nThe same files as the GitHub release of the same name. Release notes: ${GITHUB_RELEASE}/${tag}`,
            target_commitish: TARGET_BRANCH,
        });
        if (created.status < 200 || created.status >= 300) {
            throw new Error(`Creating the release answered ${created.status}: ${created.text.slice(0, 500)}`);
        }
    } else if (release.status !== 200) {
        throw new Error(`Reading the release answered ${release.status}: ${release.text.slice(0, 500)}`);
    }

    for (const file of files) {
        const name = path.basename(file);
        const size = fs.statSync(file).size;
        const already = await servedSize(tag, name);
        if (already === size) {
            console.log(`= ${name} (${formatSize(size)}) is already there.`);
            continue;
        }
        if (already !== null) {
            throw new Error(`${name} is already on GitCode at ${already} bytes, not ${size}. Delete it from the release page and run this again.`);
        }

        let done = false;
        for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS && !done; attempt += 1) {
            const target = await call("GET", `/repos/${OWNER}/${REPO}/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(name)}`);
            const url = target.json?.url;
            if (!url) {
                console.log(`  ${name}: no upload address (answered ${target.status}), attempt ${attempt}/${UPLOAD_ATTEMPTS}`);
                continue;
            }
            const started = Date.now();
            const put = await putFile(file, url, target.json.headers);
            const seconds = Math.max((Date.now() - started) / 1000, 0.001);
            if (!put.ok) {
                console.log(`  ${name}: upload answered ${put.status || "nothing"} ${put.error}, attempt ${attempt}/${UPLOAD_ATTEMPTS}`);
                continue;
            }
            const served = await servedSize(tag, name);
            if (served !== size) {
                console.log(`  ${name}: GitCode serves ${served ?? "nothing"} bytes after the upload, expected ${size}, attempt ${attempt}/${UPLOAD_ATTEMPTS}`);
                continue;
            }
            console.log(`+ ${name} (${formatSize(size)}, ${formatSize(size / seconds)}/s)`);
            done = true;
        }
        if (!done) {
            throw new Error(`${name} did not reach GitCode after ${UPLOAD_ATTEMPTS} attempts.`);
        }
    }
    console.log(`${tag} is on GitCode: ${SITE}/${OWNER}/${REPO}/releases/${tag}`);
}

main().catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
});
