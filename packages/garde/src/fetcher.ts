/**
 * Fetcher poli (§3.1) : user-agent identifié, rate-limit par hôte (1-2 req/s),
 * timeout par page, suivi manuel des redirections pour enregistrer la chaîne,
 * plafond de taille de réponse.
 */

export const VIGIE_USER_AGENT =
  "VigieBot/1.0 (+https://vigie.app/bot; surveillance SEO pour le proprietaire du site)";

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  redirectChain: string[];
  headers: Record<string, string>;
  body: string;
  sizeBytes: number;
  error: string | null;
}

export interface FetcherOptions {
  /** Intervalle minimal entre deux requêtes vers le même hôte (ms). */
  minIntervalMs?: number;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Injectable pour les tests. */
  fetchImpl?: typeof fetch;
}

export class PoliteFetcher {
  private lastRequestAt = new Map<string, number>();
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly maxRedirects: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FetcherOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 700; // ~1.4 req/s
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.maxBodyBytes = opts.maxBodyBytes ?? 3 * 1024 * 1024;
    this.maxRedirects = opts.maxRedirects ?? 8;
    this.userAgent = opts.userAgent ?? VIGIE_USER_AGENT;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt.set(host, Date.now());
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    const redirectChain: string[] = [];
    let currentUrl = url;

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(currentUrl);
      } catch {
        return this.errorResult(url, currentUrl, redirectChain, "URL invalide");
      }
      await this.throttle(parsed.host);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": this.userAgent,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
          },
        });

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) {
            return this.finish(url, currentUrl, res.status, redirectChain, res, "");
          }
          redirectChain.push(currentUrl);
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        const body = await this.readBody(res);
        return this.finish(url, currentUrl, res.status, redirectChain, res, body);
      } catch (err) {
        const message =
          err instanceof Error && err.name === "AbortError"
            ? `timeout après ${this.timeoutMs} ms`
            : err instanceof Error
              ? err.message
              : String(err);
        return this.errorResult(url, currentUrl, redirectChain, message);
      } finally {
        clearTimeout(timer);
      }
    }
    return this.errorResult(
      url,
      currentUrl,
      redirectChain,
      `plus de ${this.maxRedirects} redirections (boucle probable)`
    );
  }

  private async readBody(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBodyBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf-8");
  }

  private finish(
    requestedUrl: string,
    finalUrl: string,
    statusCode: number,
    redirectChain: string[],
    res: Response,
    body: string
  ): FetchedPage {
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return {
      requestedUrl,
      finalUrl,
      statusCode,
      redirectChain,
      headers,
      body,
      sizeBytes: Buffer.byteLength(body, "utf-8"),
      error: null,
    };
  }

  private errorResult(
    requestedUrl: string,
    finalUrl: string,
    redirectChain: string[],
    error: string
  ): FetchedPage {
    return {
      requestedUrl,
      finalUrl,
      statusCode: 0,
      redirectChain,
      headers: {},
      body: "",
      sizeBytes: 0,
      error,
    };
  }
}
