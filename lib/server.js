/* Shared server logic for the Vercel functions in /api.
   The Anthropic API key lives only in the ANTHROPIC_API_KEY environment variable; the browser never sees it.
   The server owns the model, prompt and schema, so the endpoint can't be used as a general-purpose Claude proxy. */
import Anthropic from '@anthropic-ai/sdk';
import { Redis } from '@upstash/redis';
import { AI_MODEL, AI_SCHEMA, AI_SYSTEM } from './extraction.js';

const MAX_BODY_BYTES = 4_400_000;   // Vercel rejects request bodies over 4.5 MB
const MAX_BLOCKS = 5;
const MAX_TEXT_CHARS = 400_000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const DAY_SECONDS = 60 * 60 * 48;

const env = (name, fallback) => process.env[name] ?? fallback;

/* Upstash Redis, connected through Vercel's Storage tab (it sets one of these env-var pairs). */
let redis = null;
function getRedis() {
  const url = env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL');
  const token = env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN');
  if (!url || !token) return null;
  return (redis ||= new Redis({ url, token }));
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

/* Same-origin requests are always fine; other sites only if listed in ALLOWED_ORIGINS (comma-separated). */
export function corsHeaders(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin === new URL(request.url).origin) return {};
  const allowed = env('ALLOWED_ORIGINS', '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
}
export const forbidden = () => json({ error: 'This website is not allowed to use Kitchen Sync AI.' }, 403);

/* Who is asking, and how many AI imports they get per day.
   PAYWALL HOOK: when you add accounts or subscriptions, verify the signed-in user here
   (e.g. a session token in the Authorization header), and return their id and their plan's limit.
   Everything else (quota counting, the 429 message) keeps working unchanged. */
async function authorize(request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return { id: 'ip-' + (await sha256(ip + env('QUOTA_SALT', ''))).slice(0, 32), dailyLimit: Number(env('FREE_DAILY_LIMIT', 10)) };
}
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const keys = (who) => {
  const day = new Date().toISOString().slice(0, 10);
  return { mine: `ks:u:${day}:${who.id}`, all: `ks:all:${day}` };
};

export async function getStatus(request) {
  const db = getRedis();
  if (!env('ANTHROPIC_API_KEY') || !db) return { enabled: false };
  const who = await authorize(request);
  const used = Number(await db.get(keys(who).mine)) || 0;
  return { enabled: true, limit: who.dailyLimit, remaining: Math.max(0, who.dailyLimit - used) };
}

/* Reserve one import atomically; returns a refund function, or a 429 Response if over a limit. */
async function reserve(db, who) {
  const k = keys(who);
  const bump = async (key) => { const n = await db.incr(key); if (n === 1) await db.expire(key, DAY_SECONDS); return n; };
  const mine = await bump(k.mine);
  if (mine > who.dailyLimit) {
    await db.decr(k.mine);
    return { denied: json({ error: `You've used all ${who.dailyLimit} AI imports for today. Try again tomorrow.`, code: 'quota' }, 429) };
  }
  const all = await bump(k.all);
  if (all > Number(env('GLOBAL_DAILY_LIMIT', 300))) {
    await Promise.all([db.decr(k.mine), db.decr(k.all)]);
    return { denied: json({ error: 'AI reading is very busy today. Try again tomorrow.', code: 'busy' }, 429) };
  }
  return { remaining: who.dailyLimit - mine, refund: () => Promise.all([db.decr(k.mine), db.decr(k.all)]) };
}

export async function extractRecipes(request) {
  const db = getRedis();
  if (!env('ANTHROPIC_API_KEY') || !db) return json({ error: 'AI reading is not set up on this server.' }, 503);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json({ error: 'That file is too large for AI reading (about 3 MB max) – split the PDF or use a smaller photo.' }, 413);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const blocks = sanitizeBlocks(body && body.blocks);
  if (!blocks) return json({ error: 'Unsupported file content.' }, 400);

  const who = await authorize(request);
  const slot = await reserve(db, who);
  if (slot.denied) return slot.denied;
  try {
    const result = await callClaude(blocks);
    if (result.error) { await slot.refund(); return json({ error: result.error }, result.status); }
    return json({ recipes: result.recipes, remaining: slot.remaining });
  } catch (e) {
    await slot.refund();
    throw e;
  }
}

async function callClaude(blocks) {
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  let res;
  try {
    res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: AI_SCHEMA } },
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text: 'Extract every recipe in this input for the Kitchen Sync scheduler.' }] }],
    });
  } catch (e) {
    console.error('Anthropic API error', e);
    if (e instanceof Anthropic.BadRequestError) return { status: 400, error: `Claude couldn't accept this file: ${e.message}` };
    if (e instanceof Anthropic.RateLimitError) return { status: 503, error: 'AI reading is busy right now – try again in a minute.' };
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { status: 503, error: 'AI reading is temporarily unavailable.' };  // the owner's key needs attention – see the logs
    }
    if (e instanceof Anthropic.APIError) return { status: 502, error: 'AI reading had a problem – try again shortly.' };
    throw e;
  }
  if (res.stop_reason === 'refusal') return { status: 422, error: 'Claude declined to read this file.' };
  if (res.stop_reason === 'max_tokens') return { status: 422, error: 'The file has too many recipes for one pass – split it up.' };
  try {
    const data = JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    return { recipes: data.recipes || [] };
  } catch {
    return { status: 502, error: 'Claude returned an unreadable answer – try again.' };
  }
}

/* Rebuild content blocks from validated fields only, so callers can't smuggle in other options. */
function sanitizeBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > MAX_BLOCKS) return null;
  const out = [];
  for (const b of blocks) {
    const src = b && b.source;
    if (b?.type === 'text' && typeof b.text === 'string' && b.text.length <= MAX_TEXT_CHARS) {
      out.push({ type: 'text', text: b.text });
    } else if (b?.type === 'image' && src?.type === 'base64' && IMAGE_TYPES.includes(src.media_type) && typeof src.data === 'string') {
      out.push({ type: 'image', source: { type: 'base64', media_type: src.media_type, data: src.data } });
    } else if (b?.type === 'document' && src?.type === 'base64' && src.media_type === 'application/pdf' && typeof src.data === 'string') {
      out.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: src.data } });
    } else return null;
  }
  return out;
}
