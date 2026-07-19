#!/usr/bin/env node

/*
 * Stops the dev session started by `yarn dev`.
 *
 * A session is two kinds of process: the dev server (dev-electron.js, holding
 * the reload port) and the Electron app it spawns. Either can outlive the other
 * — a failed initial build leaves the server holding the port with no app, and
 * killing the server does not reap Electron on POSIX — so both are discovered
 * independently rather than by walking the process tree.
 *
 * Discovery is by command line, matched against THIS checkout, so a dev session
 * for a sibling clone (or an unrelated Electron app) is never touched.
 *
 * Examples:
 *   node project/app/stop-dev.js
 *   node project/app/stop-dev.js --dry-run
 *   node project/app/stop-dev.js --force
 */

const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');
const { rootDir, distRoot, DEV_RELOAD_PORT } = require('../build/utils');
const { DEFAULT_CDP_PORT } = require('./cdp');

const IS_WINDOWS = process.platform === 'win32';
const TERM_GRACE_MS = 3000;
const TERM_POLL_MS = 100;

/** Compare paths case-insensitively on Windows, and ignore separator flavour. */
function normalizeForMatch(value) {
    const slashed = String(value ?? '').replace(/\\/g, '/');
    return IS_WINDOWS ? slashed.toLowerCase() : slashed;
}

const DEV_SERVER_ENTRY = normalizeForMatch(path.join(rootDir, 'project', 'app', 'dev-electron.js'));
const ELECTRON_ENTRY = normalizeForMatch(path.join(distRoot, 'main', 'index.js'));
const SELF_ENTRY = normalizeForMatch(__filename);
// `yarn dev` runs the entry relative to the package root, so the absolute form
// above is not what shows up in the command line of the process we most need to
// find. See classify() for why a relative hit alone is not proof of ownership.
const DEV_SERVER_RELATIVE = normalizeForMatch(path.join('project', 'app', 'dev-electron.js'));

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(file, args) {
    try {
        return execFileSync(file, args, {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
    } catch {
        // Non-zero exit is the normal "nothing matched" answer for netstat/lsof.
        return '';
    }
}

/**
 * Every node/electron process on the machine, as {pid, ppid, command}. The list
 * is filtered down to this checkout by the caller.
 */
function listCandidateProcesses() {
    if (IS_WINDOWS) {
        const script = "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='electron.exe'\" |"
            + ' Select-Object ProcessId,ParentProcessId,CommandLine) | ConvertTo-Json -Compress -Depth 3';
        const raw = runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).trim();
        if (!raw) return [];

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return [];
        }
        // ConvertTo-Json emits a bare object, not an array, for a single match.
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        return rows
            .filter((row) => row && row.ProcessId)
            .map((row) => ({
                pid: Number(row.ProcessId),
                ppid: Number(row.ParentProcessId),
                command: String(row.CommandLine ?? ''),
            }));
    }

    const raw = runCommand('ps', ['-Ao', 'pid=,ppid=,args=']);
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line);
            if (!match) return null;
            return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] };
        })
        .filter(Boolean);
}

/** PIDs listening on a TCP port, for the ports a session is expected to hold. */
function findListenerPids(port) {
    const pids = new Set();

    if (IS_WINDOWS) {
        const raw = runCommand('netstat.exe', ['-ano', '-p', 'tcp']);
        for (const line of raw.split('\n')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
            // Matches both 0.0.0.0:PORT and [::]:PORT, but not a PORT-suffixed
            // local address such as 15588.
            if (!new RegExp(`[:.]${port}$`).test(parts[1])) continue;
            const pid = Number(parts[4]);
            if (Number.isInteger(pid) && pid > 0) pids.add(pid);
        }
        return pids;
    }

    const raw = runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    for (const line of raw.split('\n')) {
        const pid = Number(line.trim());
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return pids;
}

function isPortFree(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, '0.0.0.0');
    });
}

function classify(command, pid, portHolders) {
    const normalized = normalizeForMatch(command);
    // This script itself runs from the checkout and would otherwise match.
    if (normalized.includes(SELF_ENTRY)) return null;
    // Electron's helper processes (renderer, GPU, utility) repeat the entry path
    // in their command line. Killing the main process reaps them.
    if (/\s--type=/.test(normalized)) return null;
    if (normalized.includes(ELECTRON_ENTRY)) return 'electron app';
    if (normalized.includes(DEV_SERVER_ENTRY)) return 'dev server';
    // A relative hit proves only that *some* checkout's dev server is running —
    // a sibling clone looks identical. Requiring it to hold a session port keeps
    // us to the one actually blocking this checkout, which is the one to stop.
    if (normalized.includes(DEV_SERVER_RELATIVE) && portHolders.has(pid)) return 'dev server';
    return null;
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
}

function terminate(pid) {
    if (IS_WINDOWS) {
        // /T takes the tree with it, so an Electron child dies with its server.
        runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        /* already gone */
    }
}

function forceKill(pid) {
    if (IS_WINDOWS) return;
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        /* already gone */
    }
}

async function waitForExit(pids) {
    const deadline = Date.now() + TERM_GRACE_MS;
    let remaining = pids.filter(isAlive);
    while (remaining.length && Date.now() < deadline) {
        await delay(TERM_POLL_MS);
        remaining = remaining.filter(isAlive);
    }
    return remaining;
}

/**
 * Collects this checkout's dev processes, then annotates anything holding a
 * session port that does NOT belong to us so the caller can report it.
 */
function discover() {
    const portHolders = new Map();
    for (const port of [DEV_RELOAD_PORT, DEFAULT_CDP_PORT]) {
        for (const pid of findListenerPids(port)) {
            if (!portHolders.has(pid)) portHolders.set(pid, port);
        }
    }

    const own = [];
    const byPid = new Map();

    for (const proc of listCandidateProcesses()) {
        byPid.set(proc.pid, proc);
        if (proc.pid === process.pid) continue;
        const role = classify(proc.command, proc.pid, portHolders);
        if (role) own.push({ ...proc, role });
    }

    const ownPids = new Set(own.map((p) => p.pid));
    const foreignPorts = [];

    for (const [pid, port] of portHolders) {
        if (ownPids.has(pid) || pid === process.pid) continue;
        foreignPorts.push({ port, pid, command: byPid.get(pid)?.command ?? '' });
    }

    return { own, foreignPorts };
}

function printHelp() {
    console.log(`Usage:
  node project/app/stop-dev.js [options]

Stops this checkout's \`yarn dev\` session: the dev server on port ${DEV_RELOAD_PORT}
and the Electron app it spawned.

Options:
  --dry-run    List what would be stopped, then exit without killing anything.
  --force      Also stop a process holding port ${DEV_RELOAD_PORT} or ${DEFAULT_CDP_PORT} that does not
               look like this checkout. Off by default so an unrelated program
               on the same port is reported rather than killed.
  -h, --help   Show this message.`);
}

async function runCli(argv = process.argv.slice(2)) {
    if (argv.includes('--help') || argv.includes('-h')) {
        printHelp();
        return;
    }

    const dryRun = argv.includes('--dry-run');
    const force = argv.includes('--force');
    const unknown = argv.find((arg) => arg.startsWith('-') && !['--dry-run', '--force'].includes(arg));
    if (unknown) throw new Error(`Unknown option: ${unknown}. Try --help.`);

    const { own, foreignPorts } = discover();

    for (const { port, pid, command } of foreignPorts) {
        const label = command ? ` (${command.slice(0, 80)})` : '';
        if (force) {
            console.log(`[stop] port ${port} held by PID ${pid}${label} — stopping (--force)`);
        } else {
            console.warn(`[stop] port ${port} is held by PID ${pid}${label}, which is not from this checkout.`);
            console.warn('[stop] left running. Pass --force to stop it anyway.');
        }
    }

    const targets = force ? [...own, ...foreignPorts.map((f) => ({ ...f, role: `port ${f.port} holder` }))] : own;

    if (!targets.length) {
        console.log('[stop] no dev session found.');
        return;
    }

    for (const { pid, role } of targets) {
        console.log(`[stop] ${dryRun ? 'would stop' : 'stopping'} ${role} (PID ${pid})`);
    }
    if (dryRun) return;

    // Server first: it owns the file watchers, and a rebuild landing mid-shutdown
    // would otherwise respawn the Electron process we are about to kill.
    const ordered = [...targets].sort((a, b) => Number(b.role === 'dev server') - Number(a.role === 'dev server'));
    for (const { pid } of ordered) {
        terminate(pid);
    }

    const survivors = await waitForExit(ordered.map((t) => t.pid));
    if (survivors.length) {
        for (const pid of survivors) {
            console.warn(`[stop] PID ${pid} ignored the term signal — forcing.`);
            forceKill(pid);
        }
        await waitForExit(survivors);
    }

    const stillHeld = !(await isPortFree(DEV_RELOAD_PORT));
    if (stillHeld) {
        // Not fatal: a foreign holder we deliberately skipped also lands here.
        console.warn(`[stop] port ${DEV_RELOAD_PORT} is still in use.`);
        return;
    }
    console.log(`[stop] stopped ${ordered.length} process(es); port ${DEV_RELOAD_PORT} is free.`);
}

if (require.main === module) {
    runCli().catch((error) => {
        console.error(`[stop] ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    discover,
    findListenerPids,
    isPortFree,
    runCli,
};
