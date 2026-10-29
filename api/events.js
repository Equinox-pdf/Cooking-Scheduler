// GET    /api/events            → { events: [summaries] }
// GET    /api/events?id=…       → { event }
// POST   /api/events            { id?, name, recipes, settings, plan, checked } → { event: summary }  (id = update)
// DELETE /api/events?id=…
import { currentUser } from '../lib/auth.js';
import { deleteEvent, getEvent, listEvents, saveEvent, validId } from '../lib/events.js';
import { crossSite, fail, getRedis, json, readJson, safe, sameOrigin } from '../lib/http.js';

/* Every request needs a signed-in user; events are always read and written under that user's id. */
const withUser = (handler) => safe(async (request) => {
  if (!sameOrigin(request)) return crossSite();
  const db = getRedis();
  if (!db) return fail(503, 'Saving is not set up on this server yet.');
  const user = await currentUser(request, db);
  if (!user) return fail(401, 'Sign in to save events.', { code: 'signin' });
  return handler(request, db, user, new URL(request.url).searchParams.get('id'));
});

export const GET = withUser(async (request, db, user, id) => {
  if (!id) return json({ events: await listEvents(db, user) });
  const event = validId(id) ? await getEvent(db, user, id) : null;
  return event ? json({ event }) : fail(404, 'That event no longer exists.');
});

export const POST = withUser(async (request, db, user) => {
  const result = await saveEvent(db, user, await readJson(request));
  return json(result.body, result.status);
});

export const DELETE = withUser(async (request, db, user, id) => {
  if (!validId(id)) return fail(400, 'Invalid event.');
  await deleteEvent(db, user, id);
  return json({ deleted: true });
});
