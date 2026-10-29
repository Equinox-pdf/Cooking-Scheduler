// GET /api/ai-status → { enabled, limit, remaining } for this visitor today.
import { corsHeaders, forbidden, getStatus, json } from '../lib/server.js';

export async function GET(request) {
  const cors = corsHeaders(request);
  if (!cors) return forbidden();
  try {
    return json(await getStatus(request), 200, cors);
  } catch (e) {
    console.error(e);
    return json({ enabled: false }, 200, cors);
  }
}

export function OPTIONS(request) {
  const cors = corsHeaders(request);
  return cors ? new Response(null, { status: 204, headers: cors }) : forbidden();
}
