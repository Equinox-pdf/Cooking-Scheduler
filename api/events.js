// Saved events (recipes + settings + plan + checklist progress). You must be signed in.
//   GET    /api/events          → { events: [...] }  the list (name, date, recipe count)
//   GET    /api/events?id=…     → { event }          one full event
//   POST   /api/events          { id?, name, recipes, settings, plan, planKey, checked }
//                                 saves a new event, or updates it when `id` is one of yours
//   DELETE /api/events?id=…
//
// Each user has two lists in the database (Redis "hashes", like a dictionary per user):
//   ks:events:<userId>  event id → the full event
//   ks:evlist:<userId>  event id → a short summary for the "My events" list
// Every lookup goes through the signed-in user's id, so nobody can reach someone else's events.
import { randomUUID } from 'node:crypto';
import { currentUser, db, fromOtherSite, reply } from './_shared.js';

const MAX_EVENTS = 50;
const MAX_SIZE = 900_000; // characters – Upstash's free plan allows up to 1 MB per request

export async function GET(request) {
  const user = await checkUser(request);
  if (user instanceof Response) return user;
  const id = new URL(request.url).searchParams.get('id');

  if (!id) {
    const summaries = Object.values((await db.hgetall('ks:evlist:' + user.id)) || {});
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); // newest first
    return reply({ events: summaries });
  }
  const event = await db.hget('ks:events:' + user.id, id);
  return event ? reply({ event }) : reply({ error: 'That event no longer exists.' }, 404);
}

export async function POST(request) {
  const user = await checkUser(request);
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => ({}));

  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return reply({ error: 'Give your event a name.' }, 400);
  if (!Array.isArray(body.recipes) || !body.settings || typeof body.settings !== 'object') return reply({ error: 'Invalid event.' }, 400);

  // Update the event if this id is already one of the user's events; otherwise create a new one.
  const existing = body.id ? await db.hget('ks:events:' + user.id, String(body.id)) : null;
  if (!existing && (await db.hlen('ks:evlist:' + user.id)) >= MAX_EVENTS) {
    return reply({ error: `You can save up to ${MAX_EVENTS} events – delete an old one first.` }, 400);
  }
  const now = new Date().toISOString();
  const event = {
    id: existing ? existing.id : randomUUID(),
    name,
    recipes: body.recipes,
    settings: body.settings,
    plan: body.plan || null,
    planKey: body.planKey || '',   // lets the page tell whether the saved plan still matches the recipes
    checked: body.checked || {},
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
  };
  if (JSON.stringify(event).length > MAX_SIZE) {
    return reply({ error: 'This event is too large to save – try fewer recipes or shorter notes.' }, 413);
  }
  const summary = { id: event.id, name, updatedAt: now, recipeCount: event.recipes.length, when: event.settings.time || null, hasPlan: !!event.plan };
  await db.hset('ks:events:' + user.id, { [event.id]: event });
  await db.hset('ks:evlist:' + user.id, { [event.id]: summary });
  return reply({ event: summary });
}

export async function DELETE(request) {
  const user = await checkUser(request);
  if (user instanceof Response) return user;
  const id = String(new URL(request.url).searchParams.get('id') || '');
  await db.hdel('ks:events:' + user.id, id);
  await db.hdel('ks:evlist:' + user.id, id);
  return reply({ deleted: true });
}

// Returns the signed-in user, or an error reply to send back instead.
async function checkUser(request) {
  if (fromOtherSite(request)) return reply({ error: 'Not allowed.' }, 403);
  const user = await currentUser(request);
  return user || reply({ error: 'Sign in to save events.', code: 'signin' }, 401);
}
