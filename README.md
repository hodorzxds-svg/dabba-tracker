# Dabba — standalone build

A personal Indian/vegetarian nutrition, fat-loss and fitness tracker, running
as a normal static site + one serverless function. AI parsing (meals,
exercise, sleep, weekly insights, chat, screenshot scanning) is powered by
Google's **Gemini API free tier** instead of Claude.

## What changed from the Claude-artifact version

- **Storage**: `window.storage` (Claude-artifact-only) → `localStorage`
  (`src/storage.js`). Data now lives on one device/browser, not synced.
- **AI calls**: requests go to `/.netlify/functions/gemini` instead of
  directly to `api.anthropic.com`. That function holds your Gemini API key
  server-side and translates requests/responses so the rest of the app code
  didn't need to change.

## 1. Get a free Gemini API key

Go to https://aistudio.google.com/apikey — no credit card required. Copy the
key.

## 2. Install dependencies

```bash
npm install
```

## 3. Local development

```bash
npm install -g netlify-cli   # once
netlify dev
```

`netlify dev` runs the Vite dev server *and* the serverless function together,
so `/.netlify/functions/gemini` resolves correctly. Create a `.env` file
(copy `.env.example`) with your real `GEMINI_API_KEY` before running this —
Netlify CLI loads it automatically.

## 4. Deploy

**Via CLI:**
```bash
netlify deploy --prod
```

**Or via the Netlify dashboard:** push this folder to a GitHub repo, then
"Add new site → Import an existing project" and point it at the repo. Netlify
will read `netlify.toml` automatically.

## 5. Set your API key on Netlify

Site settings → Environment variables → add:
- `GEMINI_API_KEY` = your key from step 1
- `GEMINI_MODEL` (optional) = a specific model ID if you don't want the default

Redeploy after adding env vars (Netlify doesn't hot-reload functions on env
var changes).

## Notes

- **Model choice**: the function defaults to `gemini-2.5-flash`, which
  supports vision (needed for the screenshot-scanning feature) and JSON
  output, and is well within Gemini's free-tier limits for personal use.
  Google updates its free-tier model lineup fairly often — check
  https://aistudio.google.com before relying on this long-term.
- **Data portability**: since storage is per-browser localStorage, clearing
  your browser data or switching devices loses your history. If you want
  cross-device sync later, that's a bigger change (a real backend + auth).
- **Rate limits**: Gemini's free tier caps requests per minute/day. Fine for
  one person's daily logging; you'll hit limits if you hammer the chat coach
  or scan many screenshots back-to-back.
