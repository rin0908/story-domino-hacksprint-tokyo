import test from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../src/services.mjs';
import { STORY } from '../src/story.mjs';

// Unit tests replace global fetch explicitly. They never contact Nosana and do not
// establish that the configured model or endpoint is available or compatible.
const OLLAMA_CONFIG = {
  NOSANA_API_STYLE: 'ollama',
  NOSANA_ENDPOINT: 'https://nosana.test/api/generate',
  NOSANA_MODEL: 'fixture-model',
  NOSANA_ALLOW_UNAUTHENTICATED: 'true',
};
const SELECTION = { affectedIds: [3, 4, 5], preservedIds: [1, 2] };
const fixtureProposal = () => ({
  scenes: STORY.scenes.map(scene => ({ ...scene })),
  reason: 'スタブ応答の形式確認用です。',
  ending: 'これはテスト用の文章です。',
});
const responseJson = data => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
});
function servicesFor(t, config = OLLAMA_CONFIG) {
  const services = createServices(config);
  t.after(() => services.close());
  return services;
}

test('Ollama short check requests final text without imposing JSON output (fetch stub)', async t => {
  const services = servicesFor(t);
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return responseJson({ done: true, done_reason: 'stop', response: '接続できました' });
  });
  const result = await services.nosana.check();
  assert.equal(request.url, OLLAMA_CONFIG.NOSANA_ENDPOINT);
  assert.equal(request.body.model, OLLAMA_CONFIG.NOSANA_MODEL);
  assert.equal(request.body.think, false);
  assert.equal(request.body.stream, false);
  assert.equal(Object.hasOwn(request.body, 'format'), false);
  assert.equal(request.body.options.num_predict, 64);
  assert.equal(typeof result.message, 'string');
});

test('Ollama proposal requests JSON final output and leaves model scene content for validation (fetch stub)', async t => {
  const services = servicesFor(t);
  const proposal = fixtureProposal();
  proposal.scenes[0].text = '維持対象をモデルが誤って変更した場合のテストです。';
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return responseJson({ done: true, done_reason: 'stop', response: JSON.stringify(proposal) });
  });
  const result = await services.nosana.generate(SELECTION);
  assert.equal(body.think, false);
  assert.equal(body.format.type, 'object');
  assert.deepEqual(body.format.required, ['scenes', 'reason', 'ending']);
  assert.equal(body.format.properties.scenes.items.properties.text.minLength, 1);
  assert.equal(body.stream, false);
  assert.equal(body.options.num_predict, 2400);
  assert.ok(body.prompt.includes(JSON.stringify(STORY)));
  assert.ok(body.prompt.includes('"preservedSceneIds":[1,2]'));
  assert.deepEqual(result, proposal);
});

test('Ollama incomplete, thinking-only, truncated and invalid JSON responses remain failures (fetch stub)', async t => {
  const services = servicesFor(t);
  let payload;
  t.mock.method(globalThis, 'fetch', async () => responseJson(payload));
  const cases = [
    [{ done: false, response: 'まだ生成中' }, 'NOSANA_INCOMPLETE_RESPONSE'],
    [{ done: true, done_reason: 'stop', thinking: '最終回答ではない', response: '' }, 'NOSANA_EMPTY_RESPONSE'],
    [{ done: true, done_reason: 'length', response: '{"scenes":[' }, 'NOSANA_TRUNCATED'],
    [{ done: true, done_reason: 'stop', response: 'JSONではない文章' }, 'NOSANA_INVALID_JSON'],
  ];
  for (const [data, code] of cases) {
    payload = data;
    await assert.rejects(services.nosana.generate(SELECTION), error => error.code === code);
  }
});

test('OpenAI-compatible mode keeps its existing request contract (fetch stub)', async t => {
  const services = servicesFor(t, {
    NOSANA_CHAT_COMPLETIONS_URL: 'https://nosana.test/v1/chat/completions',
    NOSANA_MODEL: 'fixture-model',
    NOSANA_ALLOW_UNAUTHENTICATED: 'true',
  });
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    body = JSON.parse(options.body);
    return responseJson({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixtureProposal()) } }] });
  });
  await services.nosana.generate(SELECTION);
  assert.equal(Object.hasOwn(body, 'think'), false);
  assert.equal(Object.hasOwn(body, 'format'), false);
  assert.equal(body.max_tokens, 2400);
  assert.equal(Array.isArray(body.messages), true);
});
