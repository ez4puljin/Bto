#!/usr/bin/env node
// Pushes the phone AI order line's agent (agent.json, prompt.mn.md, tools.json) to ElevenLabs
// (ADR-0232 #15). Run ON THE SERVER, where the key lives, from the repository's root:
//
//   set -a; . deploy/store/.env; set +a; node tools/call-bridge/agent/push.mjs
//
// The first time (no ELEVENLABS_AGENT_ID in the environment) it creates the agent and prints its
// id: put it in deploy/store/.env as ELEVENLABS_AGENT_ID. Afterwards the same command updates that
// agent in place. Options:
//   --llm <model>   another LLM for this push (agent.json has claude-sonnet-5-5; claude-haiku-4-5
//                   is the faster one to switch back to)
//   --asr <id>      another speech recogniser for this push (agent.json has scribe_realtime; the
//                   provider also lists scribe_v3_live)
//   --dry-run       print what would be sent (no key needed, nothing sent)
//
// The tools are workspace tools (POST/PATCH /v1/convai/tools), found again by their name; the agent
// lists their ids in prompt.tool_ids (the inline prompt.tools is deprecated). The key is read from
// ELEVENLABS_API_KEY and never printed. Plain fetch, no package.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE = 'https://api.elevenlabs.io';
/** Scribe realtime's keyterm limits (the provider's keyterm prompting page). */
export const KEYWORDS_MAX = 50;
export const KEYWORD_LENGTH_MAX = 20;

/** Leaves out the `_comment` keys and the nulls (a null voice keeps the provider's default). */
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, inner]) => !key.startsWith('_') && inner !== null)
        .map(([key, inner]) => [key, clean(inner)]),
    );
  }
  return value;
}

export async function loadAgent(dir = HERE) {
  const agent = JSON.parse(await readFile(join(dir, 'agent.json'), 'utf8'));
  const prompt = await readFile(join(dir, 'prompt.mn.md'), 'utf8');
  const tools = JSON.parse(await readFile(join(dir, 'tools.json'), 'utf8'));
  const keywords = JSON.parse(await readFile(join(dir, 'keywords.json'), 'utf8')).keywords ?? [];
  return { agent, prompt, tools, keywords };
}

/** The recogniser's keywords: trimmed, each once, within the provider's limits (refused beyond). */
export function keywordList(keywords) {
  const kept = [...new Set(keywords.map((word) => String(word).trim()).filter(Boolean))];
  const long = kept.filter((word) => [...word].length > KEYWORD_LENGTH_MAX);
  if (long.length > 0) {
    throw new Error(
      `keywords.json: longer than ${KEYWORD_LENGTH_MAX} characters: ${long.join(', ')}`,
    );
  }
  if (kept.length > KEYWORDS_MAX) {
    throw new Error(`keywords.json: ${kept.length} keywords, at most ${KEYWORDS_MAX}`);
  }
  return kept;
}

export function agentBody({ agent, prompt, keywords = [] }, toolIds, llm, asr) {
  const body = clean(structuredClone(agent));
  const settings = body.conversation_config.agent.prompt;
  settings.prompt = prompt.trim();
  settings.tool_ids = toolIds;
  if (llm) settings.llm = llm;
  body.conversation_config.asr.keywords = keywordList(keywords);
  if (asr) body.conversation_config.asr.provider = asr;
  return body;
}

function parseArgs(argv) {
  const options = { llm: null, asr: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--llm') options.llm = argv[(index += 1)] ?? null;
    else if (arg === '--asr') options.asr = argv[(index += 1)] ?? null;
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

class ProviderError extends Error {
  constructor(what, status, detail) {
    super(`${what}: HTTP ${status}${detail ? ` ${detail}` : ''}`);
    this.status = status;
  }
}

function client(fetchImpl, base, key) {
  return async (method, path, body) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      // The provider's validation detail names the field; it never echoes the key.
      const detail = json?.detail ? JSON.stringify(json.detail).slice(0, 600) : '';
      throw new ProviderError(`${method} ${path}`, response.status, detail);
    }
    return json;
  };
}

async function findTool(call, name) {
  let cursor = null;
  do {
    const query = new URLSearchParams({ search: name, page_size: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await call('GET', `/v1/convai/tools?${query}`);
    const found = (page?.tools ?? []).find(
      (tool) => tool?.tool_config?.name === name && tool?.tool_config?.type === 'client',
    );
    if (found) return found.id;
    cursor = page?.has_more ? page.next_cursor : null;
  } while (cursor);
  return null;
}

export async function push({ fetchImpl = fetch, env = process.env, argv = [], log = console.log }) {
  const options = parseArgs(argv);
  const loaded = await loadAgent();
  if (options.dryRun) {
    log(
      JSON.stringify(
        { tools: loaded.tools, agent: agentBody(loaded, ['<tool ids>'], options.llm, options.asr) },
        null,
        2,
      ),
    );
    return null;
  }
  const key = env.ELEVENLABS_API_KEY;
  if (!key)
    throw new Error('ELEVENLABS_API_KEY is not set (run: set -a; . deploy/store/.env; set +a)');
  const call = client(fetchImpl, env.ELEVENLABS_BASE_URL || DEFAULT_BASE, key);

  const toolIds = [];
  for (const tool of loaded.tools) {
    const existing = await findTool(call, tool.name);
    if (existing) {
      await call('PATCH', `/v1/convai/tools/${encodeURIComponent(existing)}`, {
        tool_config: tool,
      });
      log(`tool ${tool.name}: updated`);
      toolIds.push(existing);
    } else {
      const created = await call('POST', '/v1/convai/tools', { tool_config: tool });
      if (!created?.id) throw new Error(`tool ${tool.name}: no id in the answer`);
      log(`tool ${tool.name}: created`);
      toolIds.push(created.id);
    }
  }

  const body = agentBody(loaded, toolIds, options.llm, options.asr);
  const agentId = env.ELEVENLABS_AGENT_ID;
  if (agentId) {
    await call('PATCH', `/v1/convai/agents/${encodeURIComponent(agentId)}`, body);
    log(`agent ${agentId}: updated (llm ${body.conversation_config.agent.prompt.llm})`);
    return agentId;
  }
  const created = await call('POST', '/v1/convai/agents/create', body);
  if (!created?.agent_id) throw new Error('agent: no agent_id in the answer');
  log(
    `agent created (llm ${body.conversation_config.agent.prompt.llm}). Put this line in deploy/store/.env:`,
  );
  log(`ELEVENLABS_AGENT_ID=${created.agent_id}`);
  return created.agent_id;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  push({ argv: process.argv.slice(2) }).catch((error) => {
    console.error(`push failed: ${error.message}`);
    process.exitCode = 1;
  });
}
