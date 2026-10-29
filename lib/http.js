/* Small helpers shared by the Vercel functions in /api. */
import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';

export const env = (name, fallback) => process.env[name] ?? fallback;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}
export const fail = (status, error, extra = {}) => json({ error, ...extra }, status);

/* The app and its API share one domain. Requests from other websites are refused, which (with SameSite cookies)
   stops other sites from acting on a signed-in visitor's behalf. */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
export const crossSite = () => fail(403, 'This website is not allowed to use Kitchen Sync.');

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/* Upstash Redis, connected through Vercel's Storage tab (it sets one of these env-var pairs). */
let redis = null;
export function getRedis() {
  const url = env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
  if (!url || !token) return null;
  return (redis ||= new Redis({ url, token }));
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const clientIp = (request) => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';

/* Fixed-window counter: returns true while `key` has been hit at most `limit` times in `seconds`. */
export async function underLimit(db, key, limit, seconds) {
  const n = await db.incr(key);
  if (n === 1) await db.expire(key, seconds);
  return n <= limit;
}

/* Wrap a handler so unexpected errors become a clean 500 instead of a crash page. */
export const safe = (handler) => async (request) => {
  try { return await handler(request); } catch (e) { console.error(e); return fail(500, 'Something went wrong on the server.'); }
};
