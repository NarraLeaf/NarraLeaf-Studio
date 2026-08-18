import path from "path";
import { utilityProcess } from "electron";
import type { App } from "@/app/app";
import type { PsdBakeJob, PsdBakedLayer, PsdDocument } from "@shared/types/psdImport";
import type {
  PsdWorkerInboundMessage,
  PsdWorkerOutboundMessage
} from "@/buildWorker/psdWorkerProtocol";

type PsdWorkerHostApp = Pick<App, "getDistDir">;

/**
 * Run one PSD job in a forked utility process and tear it down again.
 *
 * A fresh worker per message rather than a long-lived one: a PSD read holds every decompressed layer
 * of a large sheet in memory, and letting that process exit is the simplest way to give it all back.
 * The file is re-read for the bake, which costs a second parse and buys not holding hundreds of
 * megabytes between the author opening the wizard and pressing import.
 */
function runPsdWorker<T extends PsdWorkerOutboundMessage["type"]>(
  app: PsdWorkerHostApp,
  message: PsdWorkerInboundMessage,
  expect: T
): Promise<Extract<PsdWorkerOutboundMessage, { type: T }>> {
  const workerPath = path.join(app.getDistDir(), "main", "psdWorker.js");
  return new Promise((resolve, reject) => {
    const worker = utilityProcess.fork(workerPath, [], {
      serviceName: "narraleaf-psd-import",
      stdio: "pipe",
      env: process.env
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    worker.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    worker.on("message", (reply: PsdWorkerOutboundMessage) => {
      if (reply.type === expect) {
        worker.kill();
        settle(() => resolve(reply as Extract<PsdWorkerOutboundMessage, { type: T }>));
        return;
      }
      if (reply.type === "error") {
        worker.kill();
        settle(() => reject(new Error(reply.message)));
      }
    });
    worker.on("exit", () => settle(() => reject(new Error("PSD worker exited before answering"))));
    worker.postMessage(message);
  });
}

export function readPsdDocument(app: PsdWorkerHostApp, filePath: string): Promise<PsdDocument> {
  return runPsdWorker(app, { type: "read", filePath }, "read-done").then((reply) => reply.document);
}

export function bakePsdLayers(
  app: PsdWorkerHostApp,
  request: PsdBakeJob
): Promise<PsdBakedLayer[]> {
  return runPsdWorker(app, { type: "bake", request }, "bake-done").then((reply) => reply.layers);
}
