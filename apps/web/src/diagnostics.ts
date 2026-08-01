/**
 * Crash breadcrumbs.
 *
 * When iOS kills the tab there is no event to listen for and nothing in memory
 * survives, so every step writes to localStorage synchronously. The last entry
 * before a session that never ended cleanly tells us where the tab died.
 */

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  /** Epoch ms */
  t: number;
  /** Session id, so entries from different page loads stay distinguishable */
  s: string;
  level: LogLevel;
  msg: string;
  data?: Record<string, unknown>;
};

type SessionState = {
  id: string;
  startedAt: number;
  /** Set on pagehide; a false value after a reload means the tab went down hard. */
  clean: boolean;
  /** Last breadcrumb, duplicated here so a crash report needs one read. */
  lastMsg: string;
  lastAt: number;
  /** True while an analysis is running. */
  analyzing: boolean;
};

export type PreviousSessionReport = {
  crashed: boolean;
  analyzing: boolean;
  lastMsg: string;
  lastAt: number;
  ageMs: number;
};

const LOG_KEY = "vision.diag.log.v2";
const SESSION_KEY = "vision.diag.session.v2";
const MAX_ENTRIES = 260;
const MAX_MSG_CHARS = 400;
const MAX_SERIALIZED = 128 * 1024;

let entries: LogEntry[] = [];
let session: SessionState | null = null;
let storageWorks = true;
let installed = false;
let listeners: Array<() => void> = [];

function store(): Storage | null {
  if (!storageWorks) return null;
  try {
    return window.localStorage;
  } catch {
    storageWorks = false;
    return null;
  }
}

function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`;
}

function persist(): void {
  const s = store();
  if (!s) return;
  try {
    let payload = JSON.stringify(entries);
    while (payload.length > MAX_SERIALIZED && entries.length > 20) {
      entries = entries.slice(Math.ceil(entries.length / 4));
      payload = JSON.stringify(entries);
    }
    s.setItem(LOG_KEY, payload);
    if (session) s.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quota or private mode: keep logging in memory only.
    storageWorks = false;
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // a broken subscriber must not break logging
    }
  }
}

function readEntries(): LogEntry[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function readSession(): SessionState | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    return parsed && typeof parsed.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Strings only, bounded, so a log write can never be the expensive part. */
function sanitize(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = typeof value === "number" ? Math.round(value * 100) / 100 : value;
      continue;
    }
    const text = typeof value === "string" ? value : safeStringify(value);
    out[key] = text.length > MAX_MSG_CHARS ? `${text.slice(0, MAX_MSG_CHARS)}…` : text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function append(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const trimmed = msg.length > MAX_MSG_CHARS ? `${msg.slice(0, MAX_MSG_CHARS)}…` : msg;
  const entry: LogEntry = {
    t: Date.now(),
    s: session?.id ?? "pre-init",
    level,
    msg: trimmed,
    data: sanitize(data),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  if (session) {
    session.lastMsg = trimmed;
    session.lastAt = entry.t;
  }
  persist();
  notify();
}

export function logInfo(msg: string, data?: Record<string, unknown>): void {
  append("info", msg, data);
}

export function logWarn(msg: string, data?: Record<string, unknown>): void {
  append("warn", msg, data);
}

export function logError(msg: string, data?: Record<string, unknown>): void {
  append("error", msg, data);
}

export function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 4).join(" | "),
    };
  }
  return { message: safeStringify(err) };
}

/**
 * Marks the analysis window. A session that ends while this is true almost
 * certainly ran out of memory rather than being closed by the user.
 */
export function markAnalyzing(analyzing: boolean): void {
  if (!session) return;
  session.analyzing = analyzing;
  persist();
}

export function subscribeToLog(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function getLogEntries(): LogEntry[] {
  return entries;
}

export function clearLog(): void {
  entries = [];
  const s = store();
  try {
    s?.removeItem(LOG_KEY);
  } catch {
    // ignore
  }
  notify();
}

export function formatLogText(): string {
  const head = [
    `vision diagnostics`,
    `exported: ${new Date().toISOString()}`,
    `session: ${session?.id ?? "unknown"}`,
    `ua: ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    "",
  ].join("\n");
  const body = entries
    .map((e) => {
      const time = new Date(e.t).toISOString().slice(11, 23);
      const data = e.data ? ` ${safeStringify(e.data)}` : "";
      return `${time} [${e.level}] (${e.s}) ${e.msg}${data}`;
    })
    .join("\n");
  return `${head}${body}\n`;
}

let previousReport: PreviousSessionReport | null = null;

/** Report on the session before this page load, if it never ended cleanly. */
export function getPreviousSessionReport(): PreviousSessionReport | null {
  return previousReport;
}

function environmentSnapshot(): Record<string, unknown> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ua: nav.userAgent,
    deviceMemoryGb: nav.deviceMemory ?? null,
    cores: nav.hardwareConcurrency ?? null,
    crossOriginIsolated:
      typeof crossOriginIsolated === "boolean" ? crossOriginIsolated : null,
    opfs: !!nav.storage?.getDirectory,
    lang: nav.language,
    screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}@${window.devicePixelRatio ?? 1}`,
  };
}

/**
 * Install once at startup: carries over the previous session's verdict, records
 * the environment, and routes uncaught errors into the log.
 */
export function installDiagnostics(): void {
  if (installed) return;
  installed = true;

  const prior = readSession();
  entries = readEntries();
  if (prior && !prior.clean) {
    previousReport = {
      crashed: true,
      analyzing: !!prior.analyzing,
      lastMsg: prior.lastMsg ?? "",
      lastAt: prior.lastAt ?? prior.startedAt,
      ageMs: Date.now() - (prior.lastAt ?? prior.startedAt),
    };
  }

  session = {
    id: newSessionId(),
    startedAt: Date.now(),
    clean: false,
    lastMsg: "session start",
    lastAt: Date.now(),
    analyzing: false,
  };
  persist();

  if (previousReport) {
    logWarn("前回のセッションが正常終了していません（クラッシュ疑い）", {
      lastMsg: previousReport.lastMsg,
      duringAnalysis: previousReport.analyzing,
      secondsAgo: Math.round(previousReport.ageMs / 1000),
    });
  }
  logInfo("session start", environmentSnapshot());

  void storageSnapshot().then((snapshot) => {
    if (snapshot) logInfo("storage", snapshot);
  });

  window.addEventListener("error", (ev) => {
    logError("uncaught error", {
      message: ev.message,
      source: `${ev.filename}:${ev.lineno}:${ev.colno}`,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    logError("unhandled rejection", describeError(ev.reason));
  });

  const markClean = () => {
    if (!session) return;
    session.clean = true;
    session.analyzing = false;
    persist();
  };
  // pagehide fires on iOS where unload does not.
  window.addEventListener("pagehide", markClean);
  window.addEventListener("beforeunload", markClean);
  window.addEventListener("pageshow", () => {
    if (!session) return;
    session.clean = false;
    persist();
  });
}

async function storageSnapshot(): Promise<Record<string, unknown> | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return {
      usageMb: est.usage != null ? Math.round(est.usage / 1e6) : null,
      quotaMb: est.quota != null ? Math.round(est.quota / 1e6) : null,
      persisted: navigator.storage.persisted
        ? await navigator.storage.persisted()
        : null,
    };
  } catch {
    return null;
  }
}

/** JS heap where the browser exposes it (Chromium); null on Safari. */
export function jsHeapMb(): number | null {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize: number };
  };
  const used = perf.memory?.usedJSHeapSize;
  return typeof used === "number" ? Math.round(used / 1e6) : null;
}
