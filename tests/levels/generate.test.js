import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateLevel, catalogEntry, addToCatalog, freeId } from '../../src/levels/generate.js';
import { claudeDesigner, CLAUDE_MODEL } from '../../src/levels/claude.js';
import { ollamaDesigner, checkOllama, OLLAMA_MODEL } from '../../src/levels/ollama.js';
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
    const out = await generateLevel({ ask, theme: 'a test', existing: EXAMPLES });
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
    const refused = await generateLevel({ ask: claude([answer('', { stop_reason: 'refusal', stop_details: { category: 'general_harms' } })]).ask, existing: EXAMPLES });
    expect(refused.ok).toBe(false);
    expect(refused.rounds[0].refused).toBe(true);

    const stubborn = await generateLevel({ ask: claude([answer(blocked), answer(blocked)]).ask, existing: EXAMPLES, maxRounds: 2 });
    expect(stubborn.ok).toBe(false);
    expect(stubborn.rounds).toHaveLength(2);
  });

  it('asks again when the answer is not JSON or was cut off', async () => {
    const { client, ask } = claude([answer('not json'), answer(good, { stop_reason: 'max_tokens' }), answer(good)]);
    const out = await generateLevel({ ask, existing: EXAMPLES });
    expect(out.ok).toBe(true);
    expect(out.rounds.map((r) => r.errors[0]?.code ?? 'ok')).toEqual(['unreadable', 'unreadable', 'ok']);
    expect(client.requests[1].messages.at(-1).content).toMatch(/could not be read/);
  });

  it('writes a level into catalog.js that reads back the same', async () => {
    const spec = { ...good, id: 'written-room', blurb: "The owner's \"new\" room", designedBy: 'Claude (claude-opus-5-5) through scripts/generate-level.mjs; checked by validate.js' };
    const entry = catalogEntry(spec, { model: MODEL, theme: 'a test', date: '2026-11-20', rounds: 2, metrics: { hidingSpots: 4, freeFloor: 22.5, difficulty: 3 } });
    const source = addToCatalog(readFileSync(new URL('../../src/levels/catalog.js', import.meta.url), 'utf8'), entry);
    const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    expect(mod.DESIGNED_LEVELS.at(-1)).toEqual(spec);
    expect(mod.DESIGNED_LEVELS.slice(0, -1)).toEqual(DESIGNED_LEVELS);
    expect(freeId('moving-day', EXAMPLES.map((l) => l.id))).toBe('moving-day-2');
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
    const out = await generateLevel({ ask: ollamaDesigner({ fetch }), theme: 'a test', existing: EXAMPLES });
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
    const out = await generateLevel({ ask: ollamaDesigner({ fetch }), existing: EXAMPLES, keepRounds: 1 });
    expect(out.ok).toBe(true);
    expect(bodies.map((b) => b.messages.length)).toEqual([2, 4, 4, 4]); // system, design, then only the last answer and its feedback
    expect(bodies[3].messages[1].content).toContain('These rooms pass the validator');
  });

  it('asks again when the answer ran out of room', async () => {
    const { fetch } = fakeOllama([local('{"id": "cut', { done_reason: 'length' }), local(good)]);
    const out = await generateLevel({ ask: ollamaDesigner({ fetch }), existing: EXAMPLES });
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

describe('the prompt', () => {
  it('offers every inventory piece, in the schema and in the table', () => {
    const [wall, floor] = LEVEL_SCHEMA.properties.pieces.items.anyOf;
    expect([...wall.properties.item.enum, ...floor.properties.item.enum].sort()).toEqual(Object.keys(INVENTORY).sort());
    const table = inventoryTable();
    for (const id of Object.keys(INVENTORY)) expect(table).toContain(`- ${id} (`);
    expect(systemPrompt()).toContain('north or west wall');
    expect(designPrompt({ existing: EXAMPLES })).toContain('Moving day');
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
