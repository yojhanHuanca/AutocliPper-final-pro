const API_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const MAX_RESPONSE_BYTES = 64 * 1024;
const CACHE_TTL_MS = 5 * 60_000;
const WINDOW_MS = 60_000;

export type YoutubeVideoMetadata = {
  state: "available";
  title: string;
  channelTitle: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  uploadStatus: string | null;
  privacyStatus: string | null;
  embeddable: boolean | null;
} | {
  state: "unavailable";
  reasonCode: "YOUTUBE_METADATA_NOT_CONFIGURED" | "YOUTUBE_METADATA_NOT_FOUND" | "YOUTUBE_METADATA_RATE_LIMITED" | "YOUTUBE_METADATA_UNAVAILABLE";
};

type YoutubeMetadataOptions = {
  apiKey?: string | (() => string | undefined);
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxGlobalRequestsPerMinute?: number;
  maxUserRequestsPerMinute?: number;
};

type CacheItem = { expiresAt: number; value: YoutubeVideoMetadata };
type RateBucket = { startedAt: number; count: number; touchedAt: number };

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/u.exec(value);
  if (!match || value === "P" || value === "PT") return null;
  const seconds = Number(match[1] ?? 0) * 86_400
    + Number(match[2] ?? 0) * 3_600
    + Number(match[3] ?? 0) * 60
    + Number(match[4] ?? 0);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= Number.MAX_SAFE_INTEGER ? Math.ceil(seconds) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function thumbnailUrl(value: unknown): string | null {
  const candidate = boundedText(value, 2048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.hostname === "i.ytimg.com" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function readMetadata(value: unknown, expectedVideoId: string): YoutubeVideoMetadata | null {
  const root = record(value);
  const items = root?.items;
  if (!Array.isArray(items)) return null;
  if (items.length === 0) return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_NOT_FOUND" };
  const item = record(items[0]);
  if (item?.id !== expectedVideoId) return null;
  const snippet = record(item?.snippet);
  const contentDetails = record(item?.contentDetails);
  const status = record(item?.status);
  const title = boundedText(snippet?.title, 500);
  const channelTitle = boundedText(snippet?.channelTitle, 200);
  const durationSeconds = parseDurationSeconds(contentDetails?.duration);
  if (!title || !channelTitle || durationSeconds === null) return null;

  const thumbnails = record(snippet?.thumbnails);
  let image: string | null = null;
  for (const name of ["maxres", "standard", "high", "medium", "default"]) {
    const candidate = thumbnailUrl(record(thumbnails?.[name])?.url);
    if (candidate) { image = candidate; break; }
  }
  const uploadStatus = boundedText(status?.uploadStatus, 40);
  const privacyStatus = boundedText(status?.privacyStatus, 20);
  return {
    state: "available",
    title,
    channelTitle,
    durationSeconds,
    thumbnailUrl: image,
    uploadStatus,
    privacyStatus,
    embeddable: typeof status?.embeddable === "boolean" ? status.embeddable : null,
  };
}

async function boundedJson(response: Response): Promise<unknown | null> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES) return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export class YoutubeMetadataClient {
  private readonly cache = new Map<string, CacheItem>();
  private readonly userBuckets = new Map<string, RateBucket>();
  private globalBucket: RateBucket | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxGlobalRequestsPerMinute: number;
  private readonly maxUserRequestsPerMinute: number;
  private readonly apiKey: () => string | undefined;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(options: YoutubeMetadataOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.maxGlobalRequestsPerMinute = options.maxGlobalRequestsPerMinute ?? 60;
    this.maxUserRequestsPerMinute = options.maxUserRequestsPerMinute ?? 20;
    const configuredKey = options.apiKey;
    this.apiKey = typeof configuredKey === "function" ? configuredKey : () => configuredKey ?? process.env["YOUTUBE_DATA_API_KEY"];
    this.cleanupTimer = setInterval(() => this.expireState(this.now()), 60_000);
    this.cleanupTimer.unref();
  }

  async lookup(videoId: string, userId: string): Promise<YoutubeVideoMetadata> {
    if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId) || !userId) {
      return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_UNAVAILABLE" };
    }
    const now = this.now();
    this.expireState(now);
    const cached = this.cache.get(videoId);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.cache.delete(videoId);

    const key = this.apiKey()?.trim();
    if (!key) return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_NOT_CONFIGURED" };
    if (!this.takeRateLimit(userId, now)) return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_RATE_LIMITED" };

    try {
      const url = new URL(API_ENDPOINT);
      url.searchParams.set("part", "snippet,contentDetails,status");
      url.searchParams.set("id", videoId);
      url.searchParams.set("maxResults", "1");
      url.searchParams.set("key", key);
      const response = await this.fetcher(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.url && new URL(response.url).origin !== "https://www.googleapis.com") {
        return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_UNAVAILABLE" };
      }
      if (!response.ok) {
        return { state: "unavailable", reasonCode: response.status === 429
          ? "YOUTUBE_METADATA_RATE_LIMITED" : "YOUTUBE_METADATA_UNAVAILABLE" };
      }
      const metadata = readMetadata(await boundedJson(response), videoId);
      if (!metadata) return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_UNAVAILABLE" };
      this.remember(videoId, metadata, now);
      return metadata;
    } catch {
      return { state: "unavailable", reasonCode: "YOUTUBE_METADATA_UNAVAILABLE" };
    }
  }

  close(): void {
    clearInterval(this.cleanupTimer);
    this.cache.clear();
    this.userBuckets.clear();
  }

  private expireState(now: number): void {
    for (const [id, item] of this.cache) if (item.expiresAt <= now) this.cache.delete(id);
    for (const [id, bucket] of this.userBuckets) {
      if (now - bucket.touchedAt >= WINDOW_MS * 2 || now < bucket.touchedAt) this.userBuckets.delete(id);
    }
  }

  private takeRateLimit(userId: string, now: number): boolean {
    const advance = (bucket: RateBucket | null, limit: number): RateBucket | null => {
      if (!bucket || now - bucket.startedAt >= WINDOW_MS || now < bucket.startedAt) return { startedAt: now, count: 1, touchedAt: now };
      if (bucket.count >= limit) return null;
      bucket.count += 1;
      bucket.touchedAt = now;
      return bucket;
    };
    const nextGlobal = advance(this.globalBucket, this.maxGlobalRequestsPerMinute);
    if (!nextGlobal) return false;
    const existing = this.userBuckets.get(userId);
    const nextUser = advance(existing ?? null, this.maxUserRequestsPerMinute);
    if (!nextUser) return false;
    this.globalBucket = nextGlobal;
    this.userBuckets.set(userId, nextUser);
    this.expireState(now);
    if (this.userBuckets.size > 2_048) {
      const oldest = [...this.userBuckets.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt).slice(0, this.userBuckets.size - 2_048);
      for (const [id] of oldest) this.userBuckets.delete(id);
    }
    return true;
  }

  private remember(videoId: string, value: YoutubeVideoMetadata, now: number): void {
    this.cache.delete(videoId);
    this.cache.set(videoId, { value, expiresAt: now + this.cacheTtlMs });
    this.expireState(now);
    while (this.cache.size > 1_000) this.cache.delete(this.cache.keys().next().value as string);
  }
}
