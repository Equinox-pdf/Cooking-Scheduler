# Kitchen Sync

A planner for multi-recipe cooking sessions (Thanksgiving dinner, cookie marathons, brunch). Enter your ovens,
burners and recipes, pick a serving or start time, and Kitchen Sync builds a step-by-step master timeline that
never double-books an oven rack, a burner, a piece of equipment or the cook's hands.

## Features
- Recipe import from photos (in-browser OCR), PDFs, text, saved web pages and JSON, plus three sample menus
- Backward ("ready by") and forward ("start at") scheduling, Express and Chill Baking modes
- Oven temperature conflict detection with preheat / cool-down modelling and one-click fixes
- Gantt timeline, interactive checklist, CSV / Excel / PNG / print exports
- Email + password accounts with saved events (recipes, settings, plan and checklist progress)

## Project layout
| Path | What it is |
|---|---|
| `public/index.html` | The whole front end: React + Tailwind in one file, including the scheduling algorithm |
| `api/auth.js` | Sign up, sign in, sign out, "who am I" |
| `api/events.js` | List, open, save and delete saved events |
| `lib/auth.js` | Password hashing (scrypt), sessions in HttpOnly cookies, sign-in rate limits |
| `lib/events.js` | Event storage, always scoped to the signed-in user |
| `lib/http.js` | Shared helpers: JSON responses, same-origin check, Redis connection |

## Running it
- **Front end only:** open `public/index.html` in a browser. Everything works except sign-in and saving.
- **Full app locally:** `npm install`, then `npx vercel dev` (needs the Upstash variables below in `.env.local`, or run `npx vercel env pull`).
- **Deploy:** `npx vercel --prod`.

## Configuration (Vercel → Settings → Environment Variables)
Connect **Upstash for Redis** under the project's **Storage** tab; it sets the database variables automatically.
Optionally add `QUOTA_SALT` (any random text) so the sign-up rate limiter doesn't store raw IP addresses.
