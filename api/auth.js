// Accounts.
//   GET  /api/auth                  → { user }  who is signed in (user is null if nobody)
//   POST /api/auth?action=signup    { email, password }
//   POST /api/auth?action=signin    { email, password }
//   POST /api/auth?action=signout
//
// Users are stored as  ks:user:<email> → { id, email, passwordHash, createdAt }.
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { SESSION_DAYS, currentUser, db, fromOtherSite, hash, reply, sessionCookie, sessionKey, sessionToken, withinLimit } from './_shared.js';

// Passwords are never stored. We store a salted scrypt hash: "scrypt$<salt>$<hash>".
function hashPassword(password, salt = randomBytes(16)) {
  const hashed = scryptSync(password.normalize('NFKC'), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hashed.toString('hex')}`;
}
function passwordMatches(password, stored) {
  const salt = Buffer.from(stored.split('$')[1], 'hex');
  return timingSafeEqual(Buffer.from(hashPassword(password, salt)), Buffer.from(stored));
}

// Read and check { email, password } from the request body.
async function readForm(request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Please enter a valid email address.' };
  if (password.length < 6) return { error: 'Your password needs at least 6 characters.' };
  if (password.length > 200) return { error: 'That password is too long.' };
  return { email, password };
}

// Create a session and reply with the user plus the cookie that keeps them signed in.
async function signedIn(user) {
  const token = randomBytes(32).toString('base64url');
  await db.set(sessionKey(token), user.email, { ex: SESSION_DAYS * 24 * 60 * 60 });
  return reply({ user: { email: user.email } }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS) });
}

async function signUp(request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  if (!(await withinLimit('ks:limit:signup:' + hash(ip), 10, 60 * 60))) {
    return reply({ error: 'Too many new accounts from this network – try again later.' }, 429);
  }
  const form = await readForm(request);
  if (form.error) return reply({ error: form.error }, 400);

  const user = { id: randomUUID(), email: form.email, passwordHash: hashPassword(form.password), createdAt: new Date().toISOString() };
  // nx: only save if no account with this email exists yet.
  const created = await db.set('ks:user:' + user.email, user, { nx: true });
  if (!created) return reply({ error: 'An account with this email already exists – sign in instead.' }, 409);
  return signedIn(user);
}

async function signIn(request) {
  const form = await readForm(request);
  if (form.error) return reply({ error: 'Email or password is incorrect.' }, 401);
  if (!(await withinLimit('ks:limit:signin:' + hash(form.email), 10, 15 * 60))) {
    return reply({ error: 'Too many sign-in attempts – wait 15 minutes and try again.' }, 429);
  }
  const user = await db.get('ks:user:' + form.email);
  // Same message whether the email or the password is wrong, so nobody can find out who has an account.
  if (!user || !passwordMatches(form.password, user.passwordHash)) {
    return reply({ error: 'Email or password is incorrect.' }, 401);
  }
  return signedIn(user);
}

async function signOut(request) {
  const token = sessionToken(request);
  if (token) await db.del(sessionKey(token));
  return reply({ user: null }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

export async function GET(request) {
  if (fromOtherSite(request)) return reply({ error: 'Not allowed.' }, 403);
  const user = await currentUser(request);
  return reply({ user: user ? { email: user.email } : null, accounts: true });
}

export async function POST(request) {
  if (fromOtherSite(request)) return reply({ error: 'Not allowed.' }, 403);
  const action = new URL(request.url).searchParams.get('action');
  if (action === 'signup') return signUp(request);
  if (action === 'signin') return signIn(request);
  if (action === 'signout') return signOut(request);
  return reply({ error: 'Unknown action.' }, 404);
}
