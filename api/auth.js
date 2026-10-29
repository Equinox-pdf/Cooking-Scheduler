// GET  /api/auth?action=me                         → { user, accounts }
// POST /api/auth?action=signup|signin|signout      { email, password }
import { currentUser, publicUser, signIn, signOut, signUp } from '../lib/auth.js';
import { crossSite, fail, getRedis, json, readJson, safe, sameOrigin } from '../lib/http.js';

const ACTIONS = { signup: signUp, signin: signIn, signout: signOut };

export const GET = safe(async (request) => {
  if (!sameOrigin(request)) return crossSite();
  const db = getRedis();
  if (!db) return json({ user: null, accounts: false });
  return json({ user: publicUser(await currentUser(request, db)), accounts: true });
});

export const POST = safe(async (request) => {
  if (!sameOrigin(request)) return crossSite();
  const db = getRedis();
  if (!db) return fail(503, 'Accounts are not set up on this server yet.');
  const action = ACTIONS[new URL(request.url).searchParams.get('action')];
  if (!action) return fail(404, 'Not found');
  const result = await action(request, db, await readJson(request));
  return json(result.body, result.status, result.cookie ? { 'Set-Cookie': result.cookie } : {});
});
