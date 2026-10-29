// POST /api/extract-recipes  { blocks: [...] } → { recipes: [...], remaining }
import { corsHeaders, extractRecipes, forbidden, json } from '../lib/server.js';

export const maxDuration = 120; // seconds – reading a multi-page PDF can take a while

export async function POST(request) {
  const cors = corsHeaders(request);
  if (!cors) return forbidden();
  let res;
  try {
    res = await extractRecipes(request);
  } catch (e) {
    console.error(e);
    res = json({ error: 'Something went wrong on the server.' }, 500);
  }
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

export function OPTIONS(request) {
  const cors = corsHeaders(request);
  return cors ? new Response(null, { status: 204, headers: cors }) : forbidden();
}
