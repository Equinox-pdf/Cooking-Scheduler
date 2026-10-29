/* Email + password accounts stored in Upstash Redis.
   - Passwords are hashed with scrypt and a random salt; the plain password is never stored.
   - Sessions are random tokens in an HttpOnly cookie; Redis stores only a hash of each token.
   Keys:  ks:user:<email> → user JSON   ks:sess:<sha256(token)> → email */
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { clientIp, sha256, underLimit } from './http.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'ks_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const MIN_PASSWORD = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const userKey = (email) => `ks:user:${email}`;
const sessionKey = (token) => `ks:sess:${sha256(token)}`;

export const getUser = (db, email) => db.get(userKey(email));
export const publicUser = (user) => (user ? { email: user.email } : null);

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password.normalize('NFKC'), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}
// Used when the email doesn't exist, so a failed sign-in takes the same time either way.
const DUMMY_HASH = await hashPassword('not-a-real-password');

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
const cookieHeader = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function startSession(db, email) {
  const token = randomBytes(32).toString('base64url');
  await db.set(sessionKey(token), email, { ex: SESSION_SECONDS });
  return cookieHeader(token, SESSION_SECONDS);
}

export async function currentUser(request, db) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const email = await db.get(sessionKey(token));
  return email ? getUser(db, email) : null;
}

function validate(body) {
  const email = normalizeEmail(body && body.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: 'Please enter a valid email address.' };
  if (password.length < MIN_PASSWORD) return { error: `Your password needs at least ${MIN_PASSWORD} characters.` };
  if (password.length > 200) return { error: 'That password is too long.' };
  return { email, password };
}

/* Each returns { status, body, cookie? } so the route can build the response. */
export async function signUp(request, db, body) {
  if (!(await underLimit(db, `ks:rl:signup:${sha256(clientIp(request))}`, 10, 3600))) {
    return { status: 429, body: { error: 'Too many new accounts from this network – try again later.' } };
  }
  const v = validate(body);
  if (v.error) return { status: 400, body: { error: v.error } };
  const user = { id: randomUUID(), email: v.email, passwordHash: await hashPassword(v.password), createdAt: new Date().toISOString() };
  const created = await db.set(userKey(v.email), user, { nx: true });
  if (!created) return { status: 409, body: { error: 'An account with this email already exists – sign in instead.' } };
  return { status: 200, body: { user: publicUser(user) }, cookie: await startSession(db, v.email) };
}

export async function signIn(request, db, body) {
  const v = validate(body);
  if (v.error) return { status: 400, body: { error: 'Email or password is incorrect.' } };
  const ipOk = await underLimit(db, `ks:rl:login-ip:${sha256(clientIp(request))}`, 30, 900);
  const emailOk = await underLimit(db, `ks:rl:login:${sha256(v.email)}`, 10, 900);
  if (!ipOk || !emailOk) return { status: 429, body: { error: 'Too many sign-in attempts – wait 15 minutes and try again.' } };
  const user = await getUser(db, v.email);
  const ok = await verifyPassword(v.password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) return { status: 401, body: { error: 'Email or password is incorrect.' } };
  return { status: 200, body: { user: publicUser(user) }, cookie: await startSession(db, v.email) };
}

export async function signOut(request, db) {
  const token = readCookie(request, COOKIE);
  if (token) await db.del(sessionKey(token));
  return { status: 200, body: { user: null }, cookie: cookieHeader('', 0) };
}
