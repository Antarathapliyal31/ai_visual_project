// Gemini as the level designer, through Google's Gemini API: fast, and the
// free tier is plenty (a room takes a handful of requests). On the free tier
// Google may use what is sent to improve its products, and people may read
// it; here that is furniture, coordinates and the game's rules, nothing
// private.
//
// One generateContent request per turn with the whole conversation, which is
// how generateLevel() (generate.js) works. Google recommends its newer
// Interactions API for new projects, but generateContent stays fully
// supported, and this stateless form needs nothing kept on Google's side.
// Gemini keeps the answer to the level's JSON schema (responseJsonSchema),
// the same schema the other designers use.
//
// Plain fetch, no SDK: nothing to install, and the tests can pass a fake.
// The key goes in a header, never in a URL, a log or an error message.

export const GEMINI_HOST = 'https://generativelanguage.googleapis.com';
export const GEMINI_MODEL = 'gemini-3.8-flash';
// Free models to move on to when the one in use is busy or rate-limited.
export const GEMINI_FALLBACKS = ['gemini-4-hydrogen', 'gemini-3.6-flash'];
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'];

// Finish reasons that mean the model will not give this answer.
const DECLINED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE']);
// Busy, rate-limited or failing: worth asking another model, or again later.
const AGAIN = new Set([429, 500, 503]);

/** What went wrong, in words, from an error response (without the key). */
export function geminiProblem(status, bodyText, model) {
  let message = bodyText;
  try { message = JSON.parse(bodyText).error?.message ?? bodyText; } catch {}
  message = String(message).slice(0, 300);
  if (status === 400 && /api key/i.test(message)) return 'Google did not accept the API key in GEMINI_API_KEY. Check it in AI Studio (https://aistudio.google.com/apikey).';
  if (status === 403) return `This key cannot use ${model} (or the Gemini API is not offered where you are): ${message}`;
  if (status === 404) return `There is no model "${model}" for this key. Pick another with --model (for example ${GEMINI_MODEL}).`;
  if (status === 429) return `The free tier's limit for ${model} is used up for now. Wait a minute (or, for the daily limit, until midnight Pacific time) and run it again. ${message}`;
  return `Gemini answered ${status}: ${message}`;
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.model]        the model to ask first
 * @param {string[]} [opts.fallbacks]  models to move on to while it is busy (then it stays with the one that answered)
 * @param {string} [opts.host]
 * @param {string} [opts.thinking]     one of THINKING_LEVELS; left out, each model's own default
 * @param {number} [opts.retries]      rounds of waiting and asking again once every model was busy
 * @param {number} [opts.timeoutMs]    longest wait for one answer before counting the model busy
 * @param {(retry: {model?: string, status?: number, reason?: string, wait?: number}) => void} [opts.onRetry]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {typeof fetch} [opts.fetch]
 * @returns {(turn: {system: string, messages: object[], schema: object}) => Promise<object>}
 */
export function geminiDesigner(opts) {
  const { apiKey, model = GEMINI_MODEL, fallbacks = GEMINI_FALLBACKS, host = GEMINI_HOST, thinking, retries = 4, timeoutMs = 180000, onRetry, fetch = globalThis.fetch } = opts;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (!apiKey) throw new Error('geminiDesigner needs an API key');
  const models = [model, ...fallbacks.filter((m) => m !== model)];
  let current = 0; // the model in use: the first one, until it is busy

  /** One request to one model: the response, or null when it is busy, limited or too slow. */
  async function ask(name, body) {
    let res;
    try {
      res = await fetch(`${host}/v1beta/models/${name}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // No answer in time, or the connection dropped: count it as busy.
      onRetry?.({ model: name, reason: e.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)} s` : `connection failed (${e.cause?.code ?? e.message})` });
      return null;
    }
    if (AGAIN.has(res.status)) {
      onRetry?.({ model: name, status: res.status });
      return null;
    }
    if (!res.ok) throw new Error(geminiProblem(res.status, await res.text(), name));
    return res;
  }

  return async ({ system, messages, schema }) => {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      // Its own earlier turns go back exactly as they came (thought signatures included).
      contents: messages.map((m) => m.gemini ?? { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }),
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        ...(thinking && { thinkingConfig: { thinkingLevel: thinking.toUpperCase() } }),
      },
    };
    const started = Date.now();
    let res = null, used = null;
    for (let attempt = 0; !res; attempt++) {
      // The model in use first, then the others in turn.
      for (let k = 0; k < models.length && !res; k++) {
        const i = (current + k) % models.length;
        res = await ask(models[i], body);
        if (res) { current = i; used = models[i]; }
      }
      if (res) break;
      if (attempt >= retries) throw new Error(`Every Gemini model tried (${models.join(', ')}) was busy or rate-limited. Try again in a few minutes.`);
      // All busy: wait longer each time (4, 8, 16, 32 s), give or take a quarter.
      const wait = Math.round(Math.min(60000, 4000 * 2 ** attempt) * (0.75 + Math.random() * 0.5));
      onRetry?.({ wait });
      await sleep(wait);
    }
    const data = await res.json();
    const usage = data.usageMetadata ?? {};
    const stats = {
      promptTokens: usage.promptTokenCount ?? 0,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      thinkingTokens: usage.thoughtsTokenCount ?? 0,
      seconds: (Date.now() - started) / 1000,
    };
    const served = data.modelVersion ?? used;
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return { text: '', model: served, stop: 'refused', detail: { blockReason: data.promptFeedback?.blockReason ?? 'no answer' }, assistant: null, stats };
    }
    const parts = candidate.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const reason = candidate.finishReason;
    const stop = DECLINED.has(reason) ? 'refused' : reason === 'MAX_TOKENS' ? 'truncated' : 'done';
    return {
      text,
      model: served,
      stop,
      detail: stop === 'refused' ? { finishReason: reason } : null,
      assistant: { role: 'assistant', content: text, gemini: { role: 'model', parts } },
      stats,
    };
  };
}

/** Is the key good, and does it reach the model? Says what to do if not. */
export async function checkGemini({ apiKey, model = GEMINI_MODEL, host = GEMINI_HOST, fetch = globalThis.fetch } = {}) {
  if (!apiKey) {
    return { ok: false, problem: 'No Gemini API key. Make a free one at https://aistudio.google.com/apikey, then run `export GEMINI_API_KEY=...` in this terminal (or add that line to ~/.zshrc). It is read from there and never written anywhere.' };
  }
  let res;
  try {
    res = await fetch(`${host}/v1beta/models/${model}`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { ok: false, problem: `Could not reach Google's Gemini API (${e.message}). Check the internet connection.` };
  }
  if (!res.ok) return { ok: false, problem: geminiProblem(res.status, await res.text(), model) };
  return { ok: true };
}
