// Helpers used by both api/auth.js and api/events.js.
// (Vercel turns every file in api/ into a web address, except files starting with "_" like this one.)
import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';

// The database. Connects using the settings Vercel adds when you link Upstash Redis to the project.
export const db = Redis.fromEnv();

// Send a JSON reply to the browser.
export function reply(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

// True if the request came from a different website. We refuse those, so other sites
// can't use a visitor's login to read or change their events.
export function fromOtherSite(request) {
  const origin = request.headers.get('origin');
  return origin && origin !== new URL(request.url).origin;
}

// A one-way scramble, used so the database never holds raw session tokens or IP addresses.
export const hash = (text) => createHash('sha256').update(text).digest('hex');

// ---- Sessions -------------------------------------------------------------
// When you sign in, the browser gets a random token in a cookie that page scripts can't read (HttpOnly).
// The database stores  ks:session:<hash of token> → email  for 30 days.
export const SESSION_DAYS = 30;
export const sessionKey = (token) => 'ks:session:' + hash(token);

export function sessionCookie(token, days) {
  return `ks_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 24 * 60 * 60}`;
}

export function sessionToken(request) {
  const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ks_session=([^;]+)/);
  return match ? match[1] : null;
}

// The signed-in user making this request, or null if nobody is signed in.
export async function currentUser(request) {
  const token = sessionToken(request);
  const email = token ? await db.get(sessionKey(token)) : null;
  return email ? db.get('ks:user:' + email) : null;
}

// Simple rate limit: returns false once `key` has been used more than `limit` times within `seconds`.
export async function withinLimit(key, limit, seconds) {
  const count = await db.incr(key);
  if (count === 1) await db.expire(key, seconds);
  return count <= limit;
}
