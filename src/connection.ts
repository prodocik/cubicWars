import { DEFAULT_SERVER_PORT } from "./multiplayerProtocol";

export function getDefaultServerUrl() {
  const fallback = getPreferredServerUrl();
  const query = new URLSearchParams(window.location.search).get("server");
  if (query) return normalizeServerUrl(query, fallback);
  return fallback;
}

export function normalizeServerUrl(value: string, fallback = getPreferredServerUrl()) {
  let raw = value.trim();
  if (!raw) raw = fallback;
  if (raw.startsWith("/")) {
    return makeSameOriginServerUrl(raw);
  }
  if (/^https?:\/\//i.test(raw)) {
    raw = raw.replace(/^http/i, "ws");
  } else if (!/^wss?:\/\//i.test(raw)) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    raw = `${protocol}://${raw}`;
  }

  try {
    const url = new URL(raw);
    url.hostname = normalizeWsHost(url.hostname);
    if (!url.port) {
      url.port = String(DEFAULT_SERVER_PORT);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function normalizeWsHost(host: string) {
  if (!host || host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "localhost";
  }
  return host;
}

function makeServerUrlForHost(host: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${normalizeWsHost(host)}:${DEFAULT_SERVER_PORT}`;
}

function makeSameOriginServerUrl(path = "/ws") {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = normalizeWsHost(window.location.hostname || "localhost");
  const port = window.location.port ? `:${window.location.port}` : "";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${host}${port}${normalizedPath}`;
}

function isViteDevClient() {
  return window.location.port === "5174";
}

function getPreferredServerUrl() {
  if (isViteDevClient()) {
    return makeServerUrlForHost(window.location.hostname || "localhost");
  }
  return makeSameOriginServerUrl("/ws");
}

function isLocalhost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function buildServerCandidates(preferredUrl: string) {
  const candidates = new Set<string>();
  const preferred = normalizeServerUrl(preferredUrl);
  candidates.add(preferred);

  if (!isViteDevClient()) {
    candidates.add(makeSameOriginServerUrl("/ws"));
  }

  const currentHost = normalizeWsHost(window.location.hostname || "localhost");
  candidates.add(makeServerUrlForHost(currentHost));

  if (isLocalhost(currentHost)) {
    candidates.add(makeServerUrlForHost("localhost"));
  }

  return Array.from(candidates);
}
