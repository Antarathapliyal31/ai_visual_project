import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateLevel, catalogEntry, addToCatalog, freeId, setDifficulty } from '../../src/levels/generate.js';
import { claudeDesigner, CLAUDE_MODEL } from '../../src/levels/claude.js';
import { ollamaDesigner, checkOllama, OLLAMA_MODEL } from '../../src/levels/ollama.js';
import { geminiDesigner, checkGemini, GEMINI_MODEL } from '../../src/levels/gemini.js';
import { LEVEL_SCHEMA, asExample, parseLevel, inventoryTable, systemPrompt, designPrompt } from '../../src/levels/prompt.js';
import { INVENTORY } from '../../src/levels/inventory.js';
import { LEVELS, EXAMPLE_LEVELS } from '../../src/levels/index.js';
import { DESIGNED_LEVELS } from '../../src/levels/catalog.js';

const EXAMPLES = [...LEVELS, ...EXAMPLE_LEVELS];
const MODEL = CLAUDE_MODEL;

/** A stand-in for the Anthropic SDK client: answers from a list, keeps every request. */
function fakeClient(answers) {
  const requests = [];
  return {
    requests,
    beta: { messages: { stream(req) { requests.push(structuredClone(req)); const a = answers.shift(); return { finalMessage: async () => a }; } } },
  };
}
const answer = (room, extra = {}) => ({
  model: MODEL, stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: typeof room === 'string' ? room : JSON.stringify(room) }],
  ...extra,
});

const moving = EXAMPLE_LEVELS.find((l) => l.id === 'moving-day');
const claude = (answers) => { const client = fakeClient(answers); return { client, ask: claudeDesigner(client) }; };
const good = { ...asExample(moving), id: 'test-room', name: 'Test room' };
// The desk chair on the spot where he crouches to look under the desk.
const blocked = { ...good, pieces: good.pieces.map((p) => (p.item === 'chair' ? { ...p, x: -0.3 } : p)) };

describe('generating a level with Claude', () => {
  it('asks Opus 5.5 for the schema, with fallback on, and feeds a rejection back until the room passes', async () => {
    const { client, ask } = claude([answer(blocked), answer(good)]);
    const out = await generateLevel({ ask, theme: 'a test', examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.rounds).toHaveLength(2);
    expect(out.rounds[0].errors.map((e) => e.code)).toContain('owner-cant-reach');
    expect(out.spec.id).toBe('test-room');

    const [first, second] = client.requests;
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.fallbacks).toBe('default');
    expect(first.betas).toContain('server-side-fallback-2026-07-01');
    expect(first.output_config.format).toEqual({ type: 'json_schema', schema: LEVEL_SCHEMA });
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0].content).toContain('a test');
    // The second turn: the first answer back as it came (thinking included), then the validator's words.
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1]).toEqual({ role: 'assistant', content: answer(blocked).content });
    expect(second.messages[2].role).toBe('user');
    expect(second.messages[2].content).toContain('owner-cant-reach');
    expect(second.messages.at(-1).role).toBe('user'); // never ends on an assistant turn (no prefill)
  });

  it('stops at a refusal and gives up after the last round', async () => {
    const refused = await generateLevel({ ask: claude([answer('', { stop_reason: 'refusal', stop_details: { category: 'general_harms' } })]).ask, examples: EXAMPLES });
    expect(refused.ok).toBe(false);
    expect(refused.rounds[0].refused).toBe(true);

    const stubborn = await generateLevel({ ask: claude([answer(blocked), answer(blocked)]).ask, examples: EXAMPLES, maxRounds: 2 });
    expect(stubborn.ok).toBe(false);
    expect(stubborn.rounds).toHaveLength(2);
  });

  it('asks again when the answer is not JSON or was cut off', async () => {
    const { client, ask } = claude([answer('not json'), answer(good, { stop_reason: 'max_tokens' }), answer(good)]);
    const out = await generateLevel({ ask, examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.rounds.map((r) => r.errors[0]?.code ?? 'ok')).toEqual(['unreadable', 'unreadable', 'ok']);
    expect(client.requests[1].messages.at(-1).content).toMatch(/could not be read/);
  });

  it('writes a level into catalog.js that reads back the same', async () => {
    const spec = { ...good, id: 'written-room', blurb: "The owner's \"new\" room", designedBy: 'Claude (claude-opus-5-5) through scripts/generate-level.mjs; checked by validate.js', difficulty: 3 };
    const entry = catalogEntry(spec, { model: MODEL, theme: 'a test', target: 'medium', date: '2026-11-20', rounds: 2, metrics: { hidingSpots: 4, freeFloor: 22.5, difficulty: 3 } });
    expect(entry).toContain('(asked for medium)');
    const source = addToCatalog(readFileSync(new URL('../../src/levels/catalog.js', import.meta.url), 'utf8'), entry);
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    expect(mod.DESIGNED_LEVELS.at(-1)).toEqual(spec);
    expect(mod.DESIGNED_LEVELS.slice(0, -1)).toEqual(DESIGNED_LEVELS);
    expect(freeId('moving-day', EXAMPLES.map((l) => l.id))).toBe('moving-day-2');

    // Rescoring rewrites the stored difficulty, or adds it to an entry without one.
    const rescored = setDifficulty(source, 'written-room', 5);
    expect(rescored).toContain("designedBy: 'Claude (claude-opus-5-5) through scripts/generate-level.mjs; checked by validate.js',\n    difficulty: 5,");
    const added = setDifficulty(source.replace(/\n {4}difficulty: 3,/, ''), 'written-room', 2);
    expect((await import(`data:text/javascript;base64,${Buffer.from(added).toString('base64')}`)).DESIGNED_LEVELS.at(-1).difficulty).toBe(2);
  });
});

/**
 * A stand-in for fetch against Ollama: answers /api/chat from a list, streamed
 * as Ollama streams (one JSON object per line, split across chunks), and
 * keeps every request body.
 */
function fakeOllama(answers, models = [OLLAMA_MODEL]) {
  const bodies = [];
  const encoder = new TextEncoder();
  const fetch = async (url, init = {}) => {
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: models.map((name) => ({ name })) }) };
    bodies.push(JSON.parse(init.body));
    const ndjson = answers.shift().map((part) => JSON.stringify(part)).join('\n') + '\n';
    const cut = Math.floor(ndjson.length / 3);
    return { ok: true, body: (async function* () { yield encoder.encode(ndjson.slice(0, cut)); yield encoder.encode(ndjson.slice(cut)); })() };
  };
  return { fetch, bodies };
}
/** An answer as Ollama streams it: reasoning, then the room in two pieces, then the totals. */
const local = (room, extra = {}) => {
  const text = typeof room === 'string' ? room : JSON.stringify(room);
  const half = Math.floor(text.length / 2);
  return [
    { model: OLLAMA_MODEL, done: false, message: { role: 'assistant', content: '', thinking: 'where the bed goes...' } },
    { model: OLLAMA_MODEL, done: false, message: { role: 'assistant', content: text.slice(0, half) } },
    { model: OLLAMA_MODEL, done: false, message: { role: 'assistant', content: text.slice(half) } },
    { model: OLLAMA_MODEL, done: true, done_reason: 'stop', message: { role: 'assistant', content: '' }, prompt_eval_count: 4000, eval_count: 900, total_duration: 42e9, ...extra },
  ];
};

describe('generating a level with a local model (Ollama)', () => {
  it('sends the schema as the format, the instructions as the system message, and fixes a rejection', async () => {
    const { fetch, bodies } = fakeOllama([local(blocked), local(good)]);
    const out = await generateLevel({ ask: ollamaDesigner({ fetch }), theme: 'a test', examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.model).toBe(OLLAMA_MODEL);
    expect(out.rounds[0].errors.map((e) => e.code)).toContain('owner-cant-reach');
    expect(out.rounds[0].stats).toMatchObject({ promptTokens: 4000, outputTokens: 900, thinkingChars: 21, thinkingCut: false });
    expect(out.rounds[0].stats.seconds).toBeGreaterThanOrEqual(0);

    const [first, second] = bodies;
    expect(first.model).toBe('qwen3.5:9b');
    expect(first.format).toEqual(LEVEL_SCHEMA);
    expect(first.stream).toBe(true);
    expect(first.think).toBe(true);
    expect(first.options.num_ctx).toBeGreaterThanOrEqual(16384);
    expect(first.messages[0]).toEqual({ role: 'system', content: systemPrompt() });
    expect(first.messages[1].content).toContain('a test');
    // The second turn carries the first answer (not its reasoning) and the validator's words.
    expect(second.messages).toHaveLength(4);
    expect(second.messages[2]).toEqual({ role: 'assistant', content: JSON.stringify(blocked) });
    expect(second.messages[3].content).toContain('owner-cant-reach');
  });

  it('cuts a long think short and has the model answer from its notes', async () => {
    const { fetch, bodies } = fakeOllama([local(blocked), local(good)]);
    const ask = ollamaDesigner({ fetch, thinkBudget: 10 }); // 'where the bed goes...' is 21 characters
    const reply = await ask({ system: 'sys', messages: [{ role: 'user', content: 'design a room' }], schema: LEVEL_SCHEMA });
    expect(bodies).toHaveLength(2);
    expect(bodies[0].think).toBe(true);
    expect(bodies[1].think).toBe(false);
    expect(bodies[1].messages.at(-1).content).toMatch(/^design a room\n\nYour notes so far \(cut short to save time\):\nwhere the bed goes\.\.\./);
    expect(JSON.parse(reply.text)).toEqual(good); // the answer comes from the second request
    expect(reply.assistant).toEqual({ role: 'assistant', content: JSON.stringify(good) });
    expect(reply.stats).toMatchObject({ thinkingChars: 21, thinkingCut: true });
  });

  it('can show the model only its latest answers, to keep a local prompt short', async () => {
    const { fetch, bodies } = fakeOllama([local(blocked), local(blocked), local(blocked), local(good)]);
    const out = await generateLevel({ ask: ollamaDesigner({ fetch }), examples: EXAMPLES, keepRounds: 1 });
    expect(out.ok).toBe(true);
    expect(bodies.map((b) => b.messages.length)).toEqual([2, 4, 4, 4]); // system, design, then only the last answer and its feedback
    expect(bodies[3].messages[1].content).toContain('These rooms pass the validator');
  });

  it('asks again when the answer ran out of room', async () => {
    const { fetch } = fakeOllama([local('{"id": "cut', { done_reason: 'length' }), local(good)]);
    const out = await generateLevel({ ask: ollamaDesigner({ fetch }), examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.rounds[0].errors[0].code).toBe('unreadable');
  });

  it('says what to do when Ollama is not running or lacks the model', async () => {
    const down = await checkOllama({ fetch: async () => { throw new Error('ECONNREFUSED'); } });
    expect(down.ok).toBe(false);
    expect(down.problem).toMatch(/not answering/);
    const missing = await checkOllama({ fetch: fakeOllama([], ['llama3.2:3b']).fetch });
    expect(missing.problem).toMatch(/ollama pull qwen3\.5:9b/);
    expect((await checkOllama({ fetch: fakeOllama([]).fetch })).ok).toBe(true);
  });
});

/** A stand-in for fetch against the Gemini API: answers from a list (status and body), keeps every request. */
function fakeGemini(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    const { status = 200, body } = answers.shift();
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status < 300, status, json: async () => JSON.parse(text), text: async () => text };
  };
  return { fetch, calls };
}
/** A generateContent answer: a thought part (not returned by default, but skipped if it is), then the room. */
const gemini = (room, { finishReason = 'STOP', ...extra } = {}) => ({
  body: {
    candidates: [{
      content: { role: 'model', parts: [{ text: 'planning the room', thought: true }, { text: typeof room === 'string' ? room : JSON.stringify(room), thoughtSignature: 'sig-1' }] },
      finishReason,
    }],
    usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 700, thoughtsTokenCount: 1200, totalTokenCount: 6900 },
    modelVersion: 'gemini-3.8-flash-001',
    ...extra,
  },
});
const noWait = { sleep: async () => {} };

describe('generating a level with Gemini', () => {
  it('sends the key in a header, the schema as JSON output, its own turn back as it came, and fixes a rejection', async () => {
    const { fetch, calls } = fakeGemini([gemini(blocked), gemini(good)]);
    const out = await generateLevel({ ask: geminiDesigner({ apiKey: 'test-key', fetch }), theme: 'a test', examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.model).toBe('gemini-3.8-flash-001');
    expect(out.rounds[0].errors.map((e) => e.code)).toContain('owner-cant-reach');
    expect(out.rounds[0].stats).toMatchObject({ promptTokens: 5000, outputTokens: 1900, thinkingTokens: 1200 });

    const [first, second] = calls;
    expect(first.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    expect(first.url).not.toContain('test-key');
    expect(first.headers['x-goog-api-key']).toBe('test-key');
    expect(first.body.systemInstruction).toEqual({ parts: [{ text: systemPrompt() }] });
    expect(first.body.contents).toHaveLength(1);
    expect(first.body.contents[0].role).toBe('user');
    expect(first.body.contents[0].parts[0].text).toContain('a test');
    expect(first.body.generationConfig).toEqual({ responseMimeType: 'application/json', responseJsonSchema: LEVEL_SCHEMA });
    // Its answer goes back exactly as it came, then the validator's words.
    expect(second.body.contents).toHaveLength(3);
    expect(second.body.contents[1]).toEqual(gemini(blocked).body.candidates[0].content);
    expect(second.body.contents[2].role).toBe('user');
    expect(second.body.contents[2].parts[0].text).toContain('owner-cant-reach');
  });

  it('asks for a thinking level only when one is given', async () => {
    const { fetch, calls } = fakeGemini([gemini(good)]);
    await generateLevel({ ask: geminiDesigner({ apiKey: 'k', fetch, thinking: 'high' }), examples: EXAMPLES });
    expect(calls[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  });

  it('moves on to the next free model when one is busy, and stays with the one that answered', async () => {
    const { fetch, calls } = fakeGemini([
      { status: 503, body: { error: { code: 503, message: 'This model is currently experiencing high demand.' } } },
      { status: 429, body: { error: { code: 429, message: 'Resource exhausted' } } },
      gemini(blocked, { modelVersion: 'gemini-3.6-flash' }),
      gemini(good, { modelVersion: 'gemini-3.6-flash' }),
    ]);
    const tried = [];
    const ask = geminiDesigner({ apiKey: 'k', fetch, ...noWait, onRetry: (r) => tried.push(r) });
    const out = await generateLevel({ ask, examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.model).toBe('gemini-3.6-flash');
    const model = (c) => c.url.match(/models\/([^:]+):/)[1];
    expect(calls.map(model)).toEqual(['gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-3.6-flash', 'gemini-3.6-flash']);
    expect(tried).toEqual([{ model: 'gemini-3.8-flash', status: 503 }, { model: 'gemini-4-hydrogen', status: 429 }]);
  });

  it('waits and goes round again when every model is busy, and gives up in the end', async () => {
    const busy = { status: 503, body: 'busy' };
    const waits = [];
    const { fetch, calls } = fakeGemini([busy, busy, busy, gemini(good)]);
    const ask = geminiDesigner({ apiKey: 'k', fetch, sleep: async (ms) => { waits.push(ms); } });
    expect((await generateLevel({ ask, examples: EXAMPLES })).ok).toBe(true);
    expect(calls).toHaveLength(4);
    expect(waits).toHaveLength(1);

    const never = fakeGemini(Array(20).fill(busy));
    const hopeless = geminiDesigner({ apiKey: 'k', fetch: never.fetch, retries: 1, ...noWait });
    await expect(hopeless({ system: 's', messages: [{ role: 'user', content: 'x' }], schema: LEVEL_SCHEMA })).rejects.toThrow(/Every Gemini model tried/);
    expect(never.calls).toHaveLength(6); // three models, twice
  });

  it('keeps the rounds done when every model has run out, so they can be written down', async () => {
    const busy = { status: 429, body: 'quota' };
    const { fetch } = fakeGemini([gemini(blocked), ...Array(12).fill(busy)]);
    const ask = geminiDesigner({ apiKey: 'k', fetch, retries: 1, ...noWait });
    const err = await generateLevel({ ask, examples: EXAMPLES }).catch((e) => e);
    expect(err.message).toMatch(/busy or rate-limited/);
    expect(err.rounds).toHaveLength(1);
    expect(err.rounds[0].errors.map((e) => e.code)).toContain('owner-cant-reach');
  });

  it('counts a request with no answer in time as busy', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push(url);
      if (calls.length === 1) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      const { body } = gemini(good);
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    };
    const tried = [];
    const out = await generateLevel({ ask: geminiDesigner({ apiKey: 'k', fetch, timeoutMs: 1000, ...noWait, onRetry: (r) => tried.push(r) }), examples: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(tried[0]).toEqual({ model: 'gemini-3.8-flash', reason: 'no answer in 1 s' });
  });

  it('treats a cut-off answer as unreadable, a blocked one as declined', async () => {
    const cut = await generateLevel({ ask: geminiDesigner({ apiKey: 'k', ...noWait, fetch: fakeGemini([gemini('{"id": "cu', { finishReason: 'MAX_TOKENS' }), gemini(good)]).fetch }), examples: EXAMPLES });
    expect(cut.ok).toBe(true);
    expect(cut.rounds[0].errors[0].code).toBe('unreadable');

    const declined = await generateLevel({ ask: geminiDesigner({ apiKey: 'k', ...noWait, fetch: fakeGemini([gemini('', { finishReason: 'SAFETY' })]).fetch }), examples: EXAMPLES });
    expect(declined.ok).toBe(false);
    expect(declined.rounds[0]).toMatchObject({ refused: true, detail: { finishReason: 'SAFETY' } });

    const blockedPrompt = await generateLevel({ ask: geminiDesigner({ apiKey: 'k', ...noWait, fetch: fakeGemini([{ body: { promptFeedback: { blockReason: 'OTHER' } } }]).fetch }), examples: EXAMPLES });
    expect(blockedPrompt.rounds[0]).toMatchObject({ refused: true, detail: { blockReason: 'OTHER' } });
  });

  it('says plainly what is wrong with the key or the model, never repeating the key', async () => {
    const badKey = geminiDesigner({ apiKey: 'secret-123', ...noWait, fetch: fakeGemini([{ status: 400, body: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } } }]).fetch });
    await expect(badKey({ system: 's', messages: [{ role: 'user', content: 'x' }], schema: LEVEL_SCHEMA })).rejects.toThrow(/did not accept the API key/);

    expect((await checkGemini({ apiKey: '' })).problem).toMatch(/aistudio\.google\.com\/apikey/);
    const missing = await checkGemini({ apiKey: 'secret-123', model: 'gemini-nope', fetch: fakeGemini([{ status: 404, body: { error: { code: 404, message: 'models/gemini-nope is not found' } } }]).fetch });
    expect(missing.problem).toMatch(/no model "gemini-nope"/);
    expect(missing.problem).not.toContain('secret-123');
    expect((await checkGemini({ apiKey: 'k', fetch: fakeGemini([{ body: { name: `models/${GEMINI_MODEL}` } }]).fetch })).ok).toBe(true);
  });
});

describe('the prompt', () => {
  it('offers every inventory piece, in the schema and in the table', () => {
    const [wall, floor] = LEVEL_SCHEMA.properties.pieces.items.anyOf;
    expect([...wall.properties.item.enum, ...floor.properties.item.enum].sort()).toEqual(Object.keys(INVENTORY).sort());
    const table = inventoryTable();
    for (const id of Object.keys(INVENTORY)) expect(table).toContain(`- ${id} (`);
    expect(systemPrompt()).toContain('north or west wall');
    expect(designPrompt({ examples: EXAMPLES })).toContain('Moving day');
    // A target says how to make it easy or hard; rooms already made are listed by name.
    const hard = designPrompt({ examples: EXAMPLES, others: [{ name: 'Late-night Kitchen', blurb: 'dishes', difficulty: 3 }], target: 'hard' });
    expect(hard).toMatch(/Make it HARD \(difficulty 4 or 5\)/);
    expect(hard).toContain('- Late-night Kitchen (difficulty 3): dishes');
    expect(systemPrompt()).toContain('How hard a room plays');
  });

  it('every object in the schema is closed, and the shipped levels fit it', () => {
    const closed = (s) => (s.type !== 'object' || s.additionalProperties === false)
      && Object.values(s.properties ?? {}).every(closed) && (!s.items || closed(s.items)) && (s.anyOf ?? []).every(closed);
    expect(closed(LEVEL_SCHEMA)).toBe(true);
    const [wall, floor] = LEVEL_SCHEMA.properties.pieces.items.anyOf;
    for (const spec of EXAMPLES) {
      for (const p of asExample(spec).pieces) {
        const shape = wall.properties.item.enum.includes(p.item) ? wall : floor;
        expect(Object.keys(p).sort(), `${spec.id} ${p.item}`).toEqual([...shape.required].sort());
      }
    }
  });

  it('reads an answer into a level, to the centimetre', () => {
    const spec = parseLevel(JSON.stringify({ id: 'Big Room!', name: 'Big', blurb: 'b', pieces: [{ item: 'bed', wall: 'west', at: 0.123 }, { item: 'chair', x: 1.006, z: -1.7149, turn: 1 }], cat: { x: 0.5, z: 1 } }));
    expect(spec.id).toBe('big-room');
    expect(spec.pieces).toEqual([{ item: 'bed', wall: 'west', at: 0.12 }, { item: 'chair', x: 1.01, z: -1.71, turn: 1 }]);
  });
});
