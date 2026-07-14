export class HttpRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, cause?: unknown) {
    super("External HTTP request timed out.", { cause });
    this.name = "HttpRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export const isHttpRequestTimeoutError = (error: unknown): error is HttpRequestTimeoutError =>
  error instanceof HttpRequestTimeoutError;

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> => {
  const durationMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.trunc(timeoutMs)) : 1;
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let abortSource: "timeout" | "upstream" | null = null;

  const abortFromUpstream = () => {
    if (abortSource) return;
    abortSource = "upstream";
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  const timeoutId = setTimeout(() => {
    if (abortSource) return;
    abortSource = "timeout";
    controller.abort(new DOMException("HTTP request timed out.", "TimeoutError"));
  }, durationMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (abortSource === "timeout") {
      throw new HttpRequestTimeoutError(durationMs, error);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
};
