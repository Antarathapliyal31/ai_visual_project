// Claude as the level designer, through the Anthropic API (paid; needs a key).
// Optional: the default designer is a local model through Ollama (ollama.js).
//
// Structured outputs keep the answer to the level's JSON schema; server-side
// fallback is on, so a declined request is re-run on Anthropic's recommended
// fallback model and the level records which model served it.
//
// No SDK import here: scripts/generate-level.mjs passes the client in.

export const CLAUDE_MODEL = 'claude-opus-5-5';

/** The request for one turn. */
export function claudeRequest({ system, messages, schema }, { model = CLAUDE_MODEL, effort = 'high' } = {}) {
  return {
    model,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
}

/**
 * @param {{beta: {messages: {stream: (req: object) => {finalMessage: () => Promise<object>}}}}} client  an Anthropic SDK client
 * @param {{model?: string, effort?: string}} [opts]
 */
export function claudeDesigner(client, opts = {}) {
  return async (turn) => {
    const message = await client.beta.messages.stream(claudeRequest(turn, opts)).finalMessage();
    return {
      text: message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      model: message.model ?? opts.model ?? CLAUDE_MODEL,
      stop: message.stop_reason === 'refusal' ? 'refused' : message.stop_reason === 'max_tokens' ? 'truncated' : 'done',
      detail: message.stop_details ?? null,
      // The answer goes back as it came, thinking included.
      assistant: { role: 'assistant', content: message.content },
    };
  };
}
