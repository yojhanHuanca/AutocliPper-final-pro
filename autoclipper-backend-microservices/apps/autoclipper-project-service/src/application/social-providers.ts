import { createHash } from 'node:crypto';
import { z } from 'zod';

export type SocialProvider = 'youtube' | 'tiktok';
export type SocialTokens = { accessToken: string; refreshToken: string; expiresAt: number; accountId: string };
export class SocialProviderError extends Error {
  constructor(readonly code: string, readonly uncertain = false) { super(code); }
}
const tokens = z.object({ access_token: z.string().min(1).max(8192), refresh_token: z.string().max(8192).optional(), expires_in: z.number().positive(), scope: z.string().optional(), open_id: z.string().max(256).optional() });
const scopes = { youtube: 'https://www.googleapis.com/auth/youtube.upload', tiktok: 'video.upload' };
export class SocialProviders {
  constructor(readonly transport: typeof fetch = fetch) {}
  settings(provider: SocialProvider) {
    const prefix = provider.toUpperCase();
    const clientId = process.env[`${prefix}_CLIENT_ID`] ?? '';
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`] ?? '';
    const redirectUri = process.env[`${prefix}_REDIRECT_URI`] ?? '';
    let validRedirect = false;
    try { const url = new URL(redirectUri); validRedirect = (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) && !url.username && !url.password && !url.hash; } catch { /* Missing configuration. */ }
    return { clientId, clientSecret, redirectUri, configured: Boolean(clientId && clientSecret && validRedirect) };
  }
  authorizationUrl(provider: SocialProvider, state: string, verifier: string) {
    const config = this.settings(provider);
    if (!config.configured) throw new SocialProviderError('SOCIAL_OAUTH_NOT_CONFIGURED');
    const url = new URL(provider === 'youtube' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://www.tiktok.com/v2/auth/authorize/');
    url.search = new URLSearchParams({ [provider === 'youtube' ? 'client_id' : 'client_key']: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: scopes[provider], state }).toString();
    if (provider === 'youtube') {
      url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent');
      url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    }
    return url.toString();
  }
  async request(url: string, init: RequestInit, uncertain = false): Promise<unknown> {
    let response: Response;
    try { response = await this.transport(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000) }); }
    catch { throw new SocialProviderError('SOCIAL_PROVIDER_UNREACHABLE', uncertain); }
    if (!response.ok) throw new SocialProviderError(response.status === 401 ? 'SOCIAL_RECONNECT_REQUIRED' : response.status === 429 ? 'SOCIAL_RATE_LIMITED' : 'SOCIAL_PROVIDER_REJECTED', uncertain && response.status >= 500);
    const text = await response.text();
    if (text.length > 65536) throw new SocialProviderError('SOCIAL_INVALID_RESPONSE', uncertain);
    try { return JSON.parse(text) as unknown; } catch { throw new SocialProviderError('SOCIAL_INVALID_RESPONSE', uncertain); }
  }
  async exchange(provider: SocialProvider, code: string, verifier: string) {
    return this.tokenRequest(provider, { grant_type: 'authorization_code', code, redirect_uri: this.settings(provider).redirectUri, ...(provider === 'youtube' ? { code_verifier: verifier } : {}) });
  }
  async refresh(provider: SocialProvider, token: SocialTokens) {
    const refreshed = await this.tokenRequest(provider, { grant_type: 'refresh_token', refresh_token: token.refreshToken });
    return { ...refreshed, refreshToken: refreshed.refreshToken || token.refreshToken, accountId: refreshed.accountId || token.accountId };
  }
  private async tokenRequest(provider: SocialProvider, fields: Record<string, string>): Promise<SocialTokens> {
    const config = this.settings(provider);
    const value = await this.request(provider === 'youtube' ? 'https://oauth2.googleapis.com/token' : 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...fields, [provider === 'youtube' ? 'client_id' : 'client_key']: config.clientId, client_secret: config.clientSecret }) });
    const parsed = tokens.safeParse(value);
    if (!parsed.success) throw new SocialProviderError('SOCIAL_OAUTH_TOKEN_INVALID');
    if (parsed.data.scope && !parsed.data.scope.split(/[ ,]/u).includes(scopes[provider])) throw new SocialProviderError('SOCIAL_SCOPE_MISSING');
    return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token ?? '', expiresAt: Date.now() + parsed.data.expires_in * 1000, accountId: parsed.data.open_id ?? '' };
  }
  async youtubeInit(token: string, input: { title: string; description: string; privacy: 'private' | 'unlisted' | 'public'; bytes: number; madeForKids: boolean }) {
    let response: Response;
    try { response = await this.transport('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(input.bytes) }, body: JSON.stringify({ snippet: { title: input.title, description: input.description, categoryId: '22' }, status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.madeForKids } }), signal: AbortSignal.timeout(30_000), redirect: 'error' }); }
    catch { throw new SocialProviderError('SOCIAL_PROVIDER_UNREACHABLE', true); }
    if (!response.ok) throw new SocialProviderError('SOCIAL_PROVIDER_REJECTED', response.status >= 500);
    const location = response.headers.get('location');
    if (!location) throw new SocialProviderError('SOCIAL_INVALID_RESPONSE', true);
    const url = new URL(location);
    if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || url.username || url.password || url.port || !url.pathname.startsWith('/upload/youtube/')) throw new SocialProviderError('SOCIAL_UPLOAD_URL_INVALID', true);
    return location;
  }
  async tiktokInit(token: string, bytes: number) {
    // Inbox upload intentionally leaves the final post for the creator to approve in TikTok.
    const chunkSize = Math.min(bytes, 10 * 1024 * 1024);
    const totalChunks = Math.max(1, Math.floor(bytes / chunkSize));
    const value = await this.request('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: bytes, chunk_size: chunkSize, total_chunk_count: totalChunks } }) }, true);
    const result = z.object({ data: z.object({ publish_id: z.string().min(1).max(256), upload_url: z.string().url() }), error: z.object({ code: z.literal('ok') }) }).safeParse(value);
    if (!result.success) throw new SocialProviderError('SOCIAL_PROVIDER_REJECTED', true);
    const url = new URL(result.data.data.upload_url);
    if (url.protocol !== 'https:' || !/(^|\.)tiktokapis\.com$/u.test(url.hostname) || url.username || url.password || url.port) throw new SocialProviderError('SOCIAL_UPLOAD_URL_INVALID', true);
    return { uploadUrl: result.data.data.upload_url, remoteId: result.data.data.publish_id, chunkSize, totalChunks };
  }
  async tiktokStatus(token: string, remoteId: string) {
    const value = await this.request('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ publish_id: remoteId }) });
    const parsed = z.object({ data: z.object({ status: z.enum(['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED']), fail_reason: z.string().optional() }), error: z.object({ code: z.literal('ok') }) }).safeParse(value);
    if (!parsed.success) throw new SocialProviderError('SOCIAL_INVALID_RESPONSE');
    return parsed.data.data.status;
  }
}
