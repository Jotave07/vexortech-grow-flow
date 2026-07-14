export const EXTERNAL_REQUEST_TIMEOUT_MS = 8_000;

export const fetchExternal = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = EXTERNAL_REQUEST_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  const timeoutId = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
};
