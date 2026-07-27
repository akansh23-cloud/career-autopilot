# AI Cost Setup — run Career Autopilot cheaply (or free)

## TL;DR: verification is already free
The verification system — the live comprehension **viva**, credential signing,
authorship checks, skill scoring — uses **no AI at runtime**. It's deterministic
crypto + logic. Verify a million candidates: **₹0 in AI calls**. So the only AI
spend on the platform is the **Innovation / Patent discovery** feature, and that
now runs on whatever cheap or free provider you point it at.

## Pick a provider with ONE env var (`AI_PROVIDER`)
If you don't set `AI_PROVIDER`, the app auto-picks the **cheapest key present**
in this order: gemini → groq → openrouter → together → openai → ollama →
anthropic → deterministic fallback. So just setting a key is usually enough.

### Cheapest paid / generous free tier — Gemini Flash (recommended)
```
GEMINI_API_KEY=your_key
# optional: AI_MODEL=gemini-1.5-flash   (default; set gemini-2.0-flash etc. if you have access)
```
Get a key at aistudio.google.com. Flash is ~10–20× cheaper than frontier models
and has a free tier that covers a lot of discovery runs.

### Free, fast, open-source models — Groq
```
AI_PROVIDER=groq
GROQ_API_KEY=your_key
# default model: llama-3.3-70b-versatile
```
Groq has a free tier and is extremely fast (open Llama models).

### Free open-source models — OpenRouter
```
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key
# default model: meta-llama/llama-3.3-70b-instruct:free  (a ':free' model)
```

### Truly $0 / offline / fully open-source — Ollama (local)
```
AI_PROVIDER=ollama
# no key needed; run `ollama serve` and `ollama pull llama3.1`
# optional: OLLAMA_BASE_URL=http://localhost:11434/v1   AI_MODEL=llama3.1
```
Runs on your own machine/VM. No per-call cost, no data leaves your box.

### Together AI (cheap hosted open-source)
```
AI_PROVIDER=together
TOGETHER_API_KEY=your_key
```

### No key at all
The app falls back to the **deterministic provider** — discovery still works
(keyword/heuristic), just without LLM enrichment, and clearly labels lower
confidence. Cost: ₹0.

### Anthropic (only if you specifically want it)
```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
# AI_MODEL=claude-3-5-haiku-latest   # use Haiku, not Sonnet/Opus, to cut cost ~10×
```

## Extra cost controls (on by default)
- **Response cache** — identical prompts within `AI_CACHE_TTL_MS` (default 1h)
  reuse the previous result instead of re-billing. Disable with `AI_CACHE_ENABLED=0`.
- **Token caps** — discovery calls already cap `max_tokens`; keep `AI_MODEL` on a
  small/flash model.
- **Discovery limits** — `PROBLEM_DISCOVERY_MAX_SIGNALS`, `*_TIMEOUT_MS`,
  `*_CACHE_TTL_MS` bound how much work each run does.

## What to do for your case
For Bharat Radar / Career Autopilot at student-pilot scale: set
`GEMINI_API_KEY` (Flash) and leave everything else default. If you want zero
cost during development, run **Ollama** locally. Verification — the thing
recruiters pay attention to — costs nothing either way.
