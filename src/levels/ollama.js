// A local model as the level designer, through Ollama's chat API: free, and
// nothing leaves this machine. generateLevel() (generate.js) calls the
// function this returns once per turn.
//
// Ollama constrains the answer to the level's JSON schema (`format`), the
// same schema the Claude designer uses, so the validator reads both alike.
//
// No Three.js, no SDK: plain fetch, so the tests can pass a fake one.

export const OLLAMA_HOST = 'http://127.0.0.1:11434';
export const OLLAMA_MODEL = 'qwen3.5:9b';

/**
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @param {string} [opts.host]
 * @param {boolean} [opts.think]      let a thinking model reason before it answers (slower, better rooms)
 * @param {number} [opts.thinkBudget] characters of reasoning before it is told to answer (about 4 per token)
 * @param {number} [opts.numCtx]      context window: the prompt, the examples and every fix round
 * @param {number} [opts.temperature]
 * @param {number} [opts.seed]
 * @param {(progress: {thinking: number, answer: number}) => void} [opts.onProgress]  characters so far, as they stream in
 * @param {typeof fetch} [opts.fetch]
 * @returns {(turn: {system: string, messages: object[], schema: object}) => Promise<object>}
 */
export function ollamaDesigner(opts = {}) {
  const { model = OLLAMA_MODEL, host = OLLAMA_HOST, think = true, thinkBudget = 8000, numCtx = 32768, temperature = 0.6, seed, onProgress, fetch = globalThis.fetch } = opts;

  /**
   * One request, streamed: a thinking model can take many minutes over one
   * answer, and fetch gives up on a response whose headers take more than 5
   * minutes. Stops early (cut: true) once the reasoning passes `budget`
   * characters with no answer begun.
   */
  async function chat({ system, messages, schema }, { thinking: withThinking, budget }) {
    const controller = new AbortController();
    const res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        format: schema,
        stream: true,
        think: withThinking,
        options: { num_ctx: numCtx, temperature, ...(seed !== undefined && { seed }) },
      }),
    });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    // One JSON object per line: pieces of the reasoning and the answer, then a last one with the totals.
    let text = '', thinking = '', data = {}, buffer = '', cut = false;
    const decoder = new TextDecoder();
    const take = (line) => {
      if (!line.trim()) return;
      const part = JSON.parse(line);
      if (part.error) throw new Error(`Ollama: ${part.error}`);
      text += part.message?.content ?? '';
      thinking += part.message?.thinking ?? '';
      if (part.done) data = part;
    };
    for await (const chunk of res.body) {
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        take(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      onProgress?.({ thinking: thinking.length, answer: text.length });
      if (thinking.length > budget && !text) { cut = true; break; }
    }
    if (cut) controller.abort();
    else take(buffer);
    return { text, thinking, data, cut };
  }

  return async (turn) => {
    const started = Date.now();
    let reply = await chat(turn, { thinking: think, budget: think ? thinkBudget : Infinity });
    const thought = reply.thinking.length;
    if (reply.cut) {
      // It has thought long enough: give it its notes and have it answer now, without thinking more.
      const messages = [...turn.messages];
      const last = messages.at(-1);
      messages[messages.length - 1] = {
        ...last,
        content: `${last.content}\n\nYour notes so far (cut short to save time):\n${reply.thinking.slice(-12000)}\n\nNow give the room as JSON, following your notes.`,
      };
      reply = await chat({ ...turn, messages }, { thinking: false, budget: Infinity });
    }
    const { text, data } = reply;
    return {
      text,
      model: data.model ?? model,
      stop: data.done_reason === 'length' ? 'truncated' : 'done',
      // Only the answer goes back into the conversation, not the reasoning.
      assistant: { role: 'assistant', content: text },
      stats: {
        promptTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        thinkingChars: thought,
        thinkingCut: thought > thinkBudget,
        seconds: (Date.now() - started) / 1000,
      },
    };
  };
}

/** Is Ollama running here, and does it have the model? Says what to do if not. */
export async function checkOllama({ model = OLLAMA_MODEL, host = OLLAMA_HOST, fetch = globalThis.fetch } = {}) {
  let tags;
  try {
    tags = await (await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) })).json();
  } catch {
    return { ok: false, problem: `Ollama is not answering at ${host}. Start the Ollama app (or run \`ollama serve\`) and try again.` };
  }
  const names = (tags.models ?? []).map((m) => m.name);
  if (!names.includes(model) && !names.includes(`${model}:latest`)) {
    return { ok: false, problem: `Ollama does not have ${model} (it has: ${names.join(', ') || 'no models'}). Run \`ollama pull ${model}\`, or pick one with --model.` };
  }
  return { ok: true, models: names };
}
