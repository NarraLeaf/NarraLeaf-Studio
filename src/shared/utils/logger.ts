type MessageContent = string | number | null | undefined | Array<any> | object | unknown;

export type LogLevel = "info" | "error" | "warn" | "debug" | "trace";

export type LogEntry = {
  level: LogLevel;
  /** The logger's name, i.e. the `[MainProcess]` prefix on the console line. */
  name: string;
  /** The already-formatted message, without the prefix. */
  message: string;
  timestamp: number;
};

/**
 * Extra destinations for every log line, on top of the console.
 *
 * A sink rather than a hard-coded file writer because this module is shared by the main process,
 * the renderer and the game runtime: `node:fs` cannot be imported here, and a browser bundle that
 * tried would fail to build. The main process installs the file sink itself
 * (`main/app/application/logging/fileLogSink.ts`).
 */
export type LogSink = (entry: LogEntry) => void;

const sinks = new Set<LogSink>();

export class Logger {
  constructor(private readonly name: string) {}

  /**
   * Send every log line to `sink` as well as the console. Returns an unsubscribe.
   *
   * A throwing sink is dropped rather than allowed to propagate: logging is what code does on the
   * way to reporting a problem, and it must never become the problem.
   */
  public static addSink(sink: LogSink): () => void {
    sinks.add(sink);
    return () => {
      sinks.delete(sink);
    };
  }

  public info(...content: MessageContent[]) {
    const message = this.formatMessage(content);
    console.log(`[${this.name}] ${message}`);
    this.emit("info", message);
  }

  public error(...content: MessageContent[]) {
    const message = this.formatMessage(content);
    console.error(`[${this.name}] ${message}`);
    this.emit("error", message);
  }

  public warn(...content: MessageContent[]) {
    const message = this.formatMessage(content);
    console.warn(`[${this.name}] ${message}`);
    this.emit("warn", message);
  }

  public debug(...content: MessageContent[]) {
    const message = this.formatMessage(content);
    console.debug(`[${this.name}] ${message}`);
    this.emit("debug", message);
  }

  public trace(...content: MessageContent[]) {
    const message = this.formatMessage(content);
    console.trace(`[${this.name}] ${message}`);
    this.emit("trace", message);
  }

  private emit(level: LogLevel, message: string): void {
    if (sinks.size === 0) {
      return;
    }
    const entry: LogEntry = { level, name: this.name, message, timestamp: Date.now() };
    for (const sink of sinks) {
      try {
        sink(entry);
      } catch {
        // See addSink.
      }
    }
  }

  private formatMessage(content: MessageContent[]): string {
    return content.map((c) => this.messageToString(c)).join(" ");
  }

  private messageToString(content: MessageContent): string {
    if (Array.isArray(content)) {
      return JSON.stringify(content);
    }

    if (content instanceof Error) {
      return content.stack ?? `${content.name}: ${content.message}`;
    }

    if (typeof content === "object" && content !== null) {
      return JSON.stringify(content, null, 2);
    }

    return String(content);
  }
}
