export async function fetchJson<T>(url: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<T> {
  const { timeoutMs = 15_000, retries = 2 } = opts;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

export async function fetchText(url: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<string> {
  const { timeoutMs = 20_000, retries = 1 } = opts;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

/** Run async tasks with limited concurrency. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}