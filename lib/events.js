/* Saved events: each holds a menu (recipes), the kitchen + schedule settings, the generated plan
   and checklist progress. Stored per user in two Redis hashes:
     ks:events:<userId>  eventId → full event        ks:evlist:<userId>  eventId → summary for the list */
import { randomUUID } from 'node:crypto';

const MAX_EVENTS = 50;
const MAX_EVENT_BYTES = 900_000;   // Upstash's free tier accepts up to 1 MB per request
const ID_RE = /^[0-9a-f-]{36}$/;
const dataKey = (user) => `ks:events:${user.id}`;
const listKey = (user) => `ks:evlist:${user.id}`;

export const validId = (id) => typeof id === 'string' && ID_RE.test(id);

export async function listEvents(db, user) {
  const all = (await db.hgetall(listKey(user))) || {};
  return Object.values(all).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export const getEvent = (db, user, id) => db.hget(dataKey(user), id);

export async function saveEvent(db, user, body) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  if (!name) return { status: 400, body: { error: 'Give your event a name.' } };
  if (!Array.isArray(body.recipes) || body.recipes.length > 100) return { status: 400, body: { error: 'Invalid recipe list.' } };
  if (!body.settings || typeof body.settings !== 'object') return { status: 400, body: { error: 'Invalid settings.' } };

  let id = body.id;
  const updating = validId(id) && (await db.hexists(dataKey(user), id));
  if (!updating) {
    if ((await db.hlen(listKey(user))) >= MAX_EVENTS) {
      return { status: 400, body: { error: `You can save up to ${MAX_EVENTS} events – delete an old one first.` } };
    }
    id = randomUUID();
  }
  const now = new Date().toISOString();
  const previous = updating ? await getEvent(db, user, id) : null;
  const event = {
    id, name, recipes: body.recipes, settings: body.settings,
    plan: body.plan && typeof body.plan === 'object' ? body.plan : null,
    planKey: typeof body.planKey === 'string' ? body.planKey : '',   // lets the page tell whether the saved plan matches the saved recipes
    checked: body.checked && typeof body.checked === 'object' ? body.checked : {},
    createdAt: previous?.createdAt || now, updatedAt: now,
  };
  if (JSON.stringify(event).length > MAX_EVENT_BYTES) return { status: 413, body: { error: 'This event is too large to save – try fewer recipes or shorter notes.' } };
  const summary = { id, name, updatedAt: now, recipeCount: event.recipes.length, when: event.settings.time || null, hasPlan: !!event.plan };
  await db.hset(dataKey(user), { [id]: event });
  await db.hset(listKey(user), { [id]: summary });
  return { status: 200, body: { event: summary } };
}

export async function deleteEvent(db, user, id) {
  await db.hdel(dataKey(user), id);
  await db.hdel(listKey(user), id);
}
