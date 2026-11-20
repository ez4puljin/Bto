// node --test tools/call-bridge/agent/push.test.mjs : push.mjs against a fake provider.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { agentBody, KEYWORDS_MAX, keywordList, loadAgent, push } from './push.mjs';

const KEY = 'test-key-not-real';

function fakeProvider({ existing = {} } = {}) {
  const calls = [];
  let next = 1;
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers['xi-api-key'], KEY);
    const { pathname, searchParams } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: pathname, body });
    const json = (value) => new Response(JSON.stringify(value), { status: 200 });
    if (init.method === 'GET' && pathname === '/v1/convai/tools') {
      const name = searchParams.get('search');
      const tools = existing[name]
        ? [{ id: existing[name], tool_config: { name, type: 'client' } }]
        : [];
      return json({ tools, has_more: false });
    }
    if (init.method === 'POST' && pathname === '/v1/convai/tools')
      return json({ id: `tool_${next++}` });
    if (init.method === 'PATCH') return json({ id: 'x' });
    if (init.method === 'POST' && pathname === '/v1/convai/agents/create') {
      return json({ agent_id: 'agent_new' });
    }
    return new Response(JSON.stringify({ detail: 'no' }), { status: 404 });
  };
  return { calls, fetchImpl };
}

test('creates the tools and the agent the first time and prints the id, never the key', async () => {
  const { calls, fetchImpl } = fakeProvider({ existing: { end_call: 'tool_old' } });
  const lines = [];
  const id = await push({ fetchImpl, env: { ELEVENLABS_API_KEY: KEY }, log: (l) => lines.push(l) });
  assert.equal(id, 'agent_new');
  assert.ok(lines.includes('ELEVENLABS_AGENT_ID=agent_new'));
  assert.ok(!lines.join('\n').includes(KEY));
  const created = calls.find((c) => c.path === '/v1/convai/agents/create');
  const prompt = created.body.conversation_config.agent.prompt;
  assert.equal(prompt.tool_ids.length, 8);
  assert.ok(prompt.tool_ids.includes('tool_old'));
  // Sonnet since the owner's decision of 2026-11-20, thinking off for the latency.
  assert.equal(prompt.llm, 'claude-sonnet-5-5');
  assert.equal(prompt.thinking_budget, 0);
  assert.ok(prompt.prompt.startsWith('# Үүрэг'));
  const asr = created.body.conversation_config.asr;
  assert.ok(asr.keywords.includes('Түмний'));
  assert.ok(asr.keywords.length > 0 && asr.keywords.length <= KEYWORDS_MAX);
  assert.equal(asr.provider, 'scribe_realtime');
  assert.equal(created.body.conversation_config.turn.turn_eagerness, 'patient');
  assert.equal(created.body._asr, undefined);
  assert.equal(created.body.conversation_config.tts.voice_id, undefined);
  assert.equal(created.body._llm, undefined);
  assert.equal(
    created.body.conversation_config.agent.first_message,
    'Сайн байна уу, Оргил бөөний төвийн захиалгын AI туслах байна. Яриа бичигдэж байгаа. Юугаар туслах вэ?',
  );
  assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1); // end_call existed
});

test('updates the agent in place when its id is set, with another LLM on request', async () => {
  const { calls, fetchImpl } = fakeProvider();
  await push({
    fetchImpl,
    env: { ELEVENLABS_API_KEY: KEY, ELEVENLABS_AGENT_ID: 'agent_1' },
    argv: ['--llm', 'claude-haiku-4-5', '--asr', 'scribe_v3_live'],
    log: () => {},
  });
  const patched = calls.find((c) => c.path === '/v1/convai/agents/agent_1');
  assert.equal(patched.method, 'PATCH');
  assert.equal(patched.body.conversation_config.agent.prompt.llm, 'claude-haiku-4-5');
  assert.equal(patched.body.conversation_config.asr.provider, 'scribe_v3_live');
  assert.ok(!calls.some((c) => c.path === '/v1/convai/agents/create'));
});

test('every tool is a client tool whose arguments are the api’s', async () => {
  const { tools } = await loadAgent();
  const shapes = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        type: tool.type,
        required: tool.parameters.required ?? [],
        properties: Object.keys(tool.parameters.properties).sort(),
      },
    ]),
  );
  // docs/modules/phone-agent.md §4 and the zod schemas of phone-tools.service.ts.
  assert.deepEqual(shapes, {
    search_products: { type: 'client', required: ['query'], properties: ['query'] },
    check_availability: {
      type: 'client',
      required: ['productId', 'unitId', 'qty'],
      properties: ['productId', 'qty', 'unitId'],
    },
    quote: { type: 'client', required: ['lines'], properties: ['lines'] },
    place_order: {
      type: 'client',
      required: ['quoteId'],
      properties: ['fulfilment', 'note', 'quoteId'],
    },
    order_status: { type: 'client', required: [], properties: ['number'] },
    new_products: { type: 'client', required: [], properties: ['limit'] },
    request_callback: { type: 'client', required: ['reason'], properties: ['reason'] },
    end_call: { type: 'client', required: [], properties: ['reason'] },
  });
  const service = await readFile(
    new URL('../../../apps/api/src/modules/phone-agent/phone-agent.rules.ts', import.meta.url),
    'utf8',
  );
  for (const name of Object.keys(shapes)) assert.ok(service.includes(`'${name}'`), name);
  const lines = tools.find((tool) => tool.name === 'quote').parameters.properties.lines.items;
  assert.deepEqual(Object.keys(lines.properties).sort(), ['qty', 'unitId']);
});

test('the dry run needs no key', async () => {
  const lines = [];
  await push({ env: {}, argv: ['--dry-run'], log: (l) => lines.push(l) });
  const shown = JSON.parse(lines[0]);
  assert.deepEqual(shown.agent.conversation_config.agent.prompt.tool_ids, ['<tool ids>']);
  assert.ok(agentBody(await loadAgent(), [], null).platform_settings.overrides);
});

test('the recogniser’s keywords stay within the provider’s limits', () => {
  assert.deepEqual(keywordList([' Түмний ', 'Түмний', '', 'Пепси']), ['Түмний', 'Пепси']);
  assert.throws(() => keywordList(['а'.repeat(21)]), /longer than 20/);
  assert.throws(
    () => keywordList(Array.from({ length: KEYWORDS_MAX + 1 }, (_, index) => `үг${index}`)),
    /at most 50/,
  );
});
