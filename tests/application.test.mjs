// These application tests use explicit provider doubles. They do not establish
// connectivity to Neo4j, Nosana, or Daytona, or represent AI-generated output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/application.mjs';
import { missingSettings, safeError } from '../src/config.mjs';
import { STORY, SAMPLE_PROPOSAL } from '../src/story.mjs';
import { EVENT } from '../src/event.mjs';

const copy = (value) => structuredClone(value);
const env = {
  NEO4J_URI: 'neo4j+s://provider-double.invalid',
  NEO4J_USERNAME: 'test-user', NEO4J_PASSWORD: 'test-password-not-a-real-secret',
  NOSANA_CHAT_COMPLETIONS_URL: 'https://provider-double.invalid/v1/chat/completions', NOSANA_MODEL: 'explicit-test-model',
  NOSANA_API_KEY: 'test-nosana-key', DAYTONA_API_KEY: 'test-daytona-key',
  DAYTONA_SANDBOX_ID: 'test-existing-sandbox',
};
const checkIds = ['ids', 'unique', 'complete', 'content', 'preserved-1', 'preserved-2', 'metadata'];
function validation(failedId) {
  return { exitCode: 0, validation: {
    valid: !failedId,
    checks: checkIds.map((id) => ({ id, label: id, passed: id !== failedId, detail: 'テストdoubleの検査結果' })),
    scope: 'テストdouble。Daytonaでの実行結果ではありません。',
  } };
}
function fixture(options = {}) {
  const calls = [];
  const services = {
    neo4j: {
      check: async () => { calls.push('neo4j.check'); },
      impact: async () => { calls.push('neo4j.impact'); return { affectedIds: [3, 4, 5], preservedIds: [1, 2], paths: [] }; },
    },
    nosana: {
      check: async () => { calls.push('nosana.check'); },
      generate: async (impact) => { calls.push(['nosana.generate', copy(impact)]); return copy(SAMPLE_PROPOSAL); },
    },
    daytona: {
      check: async () => { calls.push('daytona.check'); },
      validate: async (input) => { calls.push(['daytona.validate', copy(input)]); return validation(); },
    },
  };
  const app = createApplication({ services, env: { ...env }, ...options });
  const post = (path, body = {}) => app.dispatch('POST', `/api/${path}`, body);
  const impact = () => post('impact');
  const generate = (run) => post('generate', { runId: run.runId });
  const validate = (run) => post('validate', { runId: run.runId });
  const adopt = (run) => post('adopt', { runId: run.runId });
  const undo = (run) => post('undo', { runId: run.runId });
  return { app, services, calls, post, impact, generate, validate, adopt, undo };
}
function rejectsCode(promise, code) {
  return assert.rejects(promise, (error) => error.code === code);
}
function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('configured values do not imply connectivity, while organizer facts retain their stated uncertainty', () => {
  const f = fixture();
  const result = f.app.status();
  assert.equal(result.readiness.ready, false);
  assert.ok(result.services.every((service) => service.state === 'configured' && service.checkedAt === null));
  assert.deepEqual(result.event, EVENT);
  assert.match(result.event.conditions, /全3製品が必須かは未明示/);
  assert.match(result.event.submission, /公開GitHub・PDFスライド必須/);
  assert.match(result.event.deadline, /2026年9月12日 16:00/);
  assert.match(result.event.registration, /本人申告.*実接続は別途確認/);
  assert.equal(f.calls.length, 0);
});

test('Nosana configuration requires the URL field for the chosen API style', async (t) => {
  const cases = [
    ['default OpenAI accepts the exact chat-completions URL', {}, []],
    ['default OpenAI does not assume an Ollama endpoint is a chat URL', { NOSANA_CHAT_COMPLETIONS_URL: '', NOSANA_ENDPOINT: 'https://provider-double.invalid' }, ['NOSANA_CHAT_COMPLETIONS_URL']],
    ['explicit OpenAI still requires the chat-completions URL', { NOSANA_API_STYLE: 'openai', NOSANA_CHAT_COMPLETIONS_URL: '', NOSANA_ENDPOINT: 'https://provider-double.invalid' }, ['NOSANA_CHAT_COMPLETIONS_URL']],
    ['Ollama accepts its own configured endpoint', { NOSANA_API_STYLE: 'ollama', NOSANA_CHAT_COMPLETIONS_URL: '', NOSANA_ENDPOINT: 'https://provider-double.invalid' }, []],
    ['Ollama does not silently reuse an OpenAI URL', { NOSANA_API_STYLE: 'ollama', NOSANA_ENDPOINT: '' }, ['NOSANA_ENDPOINT']],
  ];
  for (const [name, overrides, expected] of cases) await t.test(name, () => {
    const configured = { ...env, ...overrides };
    assert.deepEqual(missingSettings('nosana', configured), expected);
    const f = fixture({ env: configured });
    const service = f.app.status().services.find((item) => item.id === 'nosana');
    assert.equal(service.state, expected.length ? 'missing' : 'configured');
    assert.equal(f.app.status().readiness.ready, false, 'configuration alone never proves connectivity');
  });
});

test('Nosana inference-key alias or explicit unauthenticated mode satisfy authentication setup', () => {
  assert.deepEqual(missingSettings('nosana', { ...env, NOSANA_API_KEY: '', NOSANA_INFERENCE_API_KEY: 'test-inference-key' }), []);
  assert.deepEqual(missingSettings('nosana', { ...env, NOSANA_API_KEY: '', NOSANA_ALLOW_UNAUTHENTICATED: 'true' }), []);
  assert.ok(missingSettings('nosana', { ...env, NOSANA_API_KEY: '', NOSANA_ALLOW_UNAUTHENTICATED: 'false' }).some((field) => field.startsWith('NOSANA_API_KEY')));
});

test('specific provider failures retain clear safe error codes and actionable Japanese explanations', async (t) => {
  const cases = [
    ['nosana', 'NOSANA_AUTH_FAILED', /推論認証.*推論用キー/],
    ['nosana', 'NOSANA_TIMEOUT', /45秒以内/],
    ['nosana', 'NOSANA_TRUNCATED', /上限で途切れ/],
    ['nosana', 'NOSANA_INVALID_JSON', /JSON形式/],
    ['nosana', 'NOSANA_INVALID_API_STYLE', /openai または ollama/],
    ['nosana', 'NOSANA_INVALID_URL', /正確なHTTPS推論URL/],
    ['daytona', 'DAYTONA_SANDBOX_NOT_RUNNING', /起動中ではありません/],
    ['daytona', 'DAYTONA_INVALID_VALIDATION', /検査結果.*採用はできません/],
    ['neo4j', 'NEO4J_INVALID_GRAPH_RESULT', /依存関係検索.*一致しません/],
  ];
  for (const [stage, code, explanation] of cases) await t.test(code, async () => {
    const safe = safeError(stage, code);
    assert.equal(safe.code, code);
    assert.equal(safe.stage, stage);
    assert.match(safe.message, explanation);
    const f = fixture();
    const privateMessage = 'https://private.invalid/?token=SECRET_FROM_PROVIDER';
    f.services[stage].check = async () => { throw Object.assign(new Error(privateMessage), { code }); };
    const result = await f.app.checkConnections();
    const service = result.services.find((item) => item.id === stage);
    assert.equal(service.state, 'failed');
    assert.equal(service.message, safe.message);
    assert.equal(JSON.stringify(result).includes('SECRET_FROM_PROVIDER'), false);
    assert.equal(JSON.stringify(result).includes('private.invalid'), false);
  });
});

test('missing configuration is reported without calling provider doubles', async () => {
  const f = fixture({ env: {} });
  const result = await f.app.checkConnections();
  assert.ok(result.services.every((service) => service.state === 'missing' && service.missing.length > 0));
  assert.equal(f.calls.length, 0);
  await rejectsCode(f.impact(), 'CONFIG_MISSING');
});

test('Nosana must pass the short-response connection check before generation', async () => {
  const f = fixture();
  const run = await f.impact();
  await rejectsCode(f.generate(run), 'CHECK_REQUIRED');
  assert.equal(f.calls.some((call) => Array.isArray(call) && call[0] === 'nosana.generate'), false);
  const status = await f.app.checkConnections();
  assert.equal(status.readiness.ready, true);
  assert.match(status.services.find((service) => service.id === 'nosana').message, /短文応答/);
  const result = await f.generate(run);
  assert.equal(result.model, env.NOSANA_MODEL);
});

test('full pipeline passes graph output and proposal to providers; adoption and undo restore complete content', async () => {
  const f = fixture();
  await f.app.checkConnections();
  const run = await f.impact();
  assert.equal(run.source, 'neo4j');
  const generated = await f.generate(run);
  assert.equal(generated.source, 'nosana');
  const checked = await f.validate(run);
  assert.equal(checked.source, 'daytona');
  assert.equal(checked.validation.valid, true);
  const generationCall = f.calls.find((call) => Array.isArray(call) && call[0] === 'nosana.generate');
  assert.deepEqual(generationCall[1].affectedIds, [3, 4, 5]);
  assert.deepEqual(generationCall[1].preservedIds, [1, 2]);
  const validationCall = f.calls.find((call) => Array.isArray(call) && call[0] === 'daytona.validate');
  assert.deepEqual(validationCall[1].proposal, generated.proposal);
  const adopted = await f.adopt(run);
  assert.equal(adopted.adopted, true);
  assert.equal(adopted.premise, STORY.changedPremise);
  assert.equal(adopted.ending, SAMPLE_PROPOSAL.ending);
  assert.deepEqual(adopted.scenes, SAMPLE_PROPOSAL.scenes);
  assert.deepEqual(adopted.scenes.slice(0, 2), STORY.scenes.slice(0, 2));
  const restored = await f.undo(run);
  assert.deepEqual(restored, { scenes: STORY.scenes, ending: STORY.ending, premise: STORY.premise, adopted: false });
  assert.equal((await f.adopt(run)).adopted, true, 'a validated proposal can be adopted again after undo');
  assert.deepEqual(await f.app.dispatch('GET', '/api/story'), STORY, 'the original story remains immutable');
});

test('adoption is rejected before generation and before validation, and out-of-order steps are rejected', async () => {
  const f = fixture();
  await f.app.checkConnections();
  const run = await f.impact();
  await rejectsCode(f.adopt(run), 'VALIDATION_REQUIRED');
  await rejectsCode(f.validate(run), 'ORDER_INVALID');
  await f.generate(run);
  await rejectsCode(f.adopt(run), 'VALIDATION_REQUIRED');
  await rejectsCode(f.generate(run), 'ORDER_INVALID');
  await rejectsCode(f.undo(run), 'ORDER_INVALID');
});

test('invalid graph IDs never yield an adoptable run or silently fall back to demo IDs', async (t) => {
  for (const affectedIds of [[3, 4], [3, 4, 5, 5], [1, 3, 4, 5], ['3', '4', '5'], [3, 4, true], null]) {
    await t.test(JSON.stringify(affectedIds), async () => {
      const f = fixture();
      f.services.neo4j.impact = async () => ({ affectedIds });
      await rejectsCode(f.impact(), 'GRAPH_UNEXPECTED');
      assert.equal(f.calls.some((call) => Array.isArray(call) && call[0] === 'nosana.generate'), false);
    });
  }
});

test('a failed provider check does not prevent checking other services and never leaks provider secrets', async () => {
  const f = fixture();
  const secret = 'UNIQUE_SECRET_do_not_expose';
  f.services.nosana.check = async () => { throw Object.assign(new Error(`https://user:${secret}@private.invalid/path`), { code: secret }); };
  const result = await f.app.checkConnections();
  assert.equal(result.services.find((service) => service.id === 'neo4j').state, 'connected');
  assert.equal(result.services.find((service) => service.id === 'daytona').state, 'connected');
  assert.equal(result.services.find((service) => service.id === 'nosana').state, 'failed');
  assert.equal(result.readiness.ready, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('private.invalid'), false);
  const run = await f.impact();
  await rejectsCode(f.generate(run), 'CHECK_REQUIRED');
});

test('provider failures are sanitized, contain no fabricated proposal, and can be retried after rechecking', async () => {
  const f = fixture();
  await f.app.checkConnections();
  const run = await f.impact();
  const originalGenerate = f.services.nosana.generate;
  const secret = 'PRIVATE_URL_AND_TOKEN_37821';
  f.services.nosana.generate = async () => { throw Object.assign(new Error(secret), { code: secret }); };
  await assert.rejects(f.generate(run), (error) => {
    assert.equal(error.code, 'SERVICE_FAILED');
    assert.equal(error.stage, 'nosana');
    assert.equal(error.message.includes(secret), false);
    assert.equal(JSON.stringify(safeError(error.stage, error.code)).includes(secret), false);
    return true;
  });
  assert.equal(JSON.stringify(f.app.status()).includes(secret), false);
  await rejectsCode(f.adopt(run), 'VALIDATION_REQUIRED');
  f.services.nosana.generate = originalGenerate;
  await rejectsCode(f.generate(run), 'CHECK_REQUIRED');
  await f.app.checkConnections();
  assert.deepEqual((await f.generate(run)).proposal, SAMPLE_PROPOSAL);
});

test('failed validation disables adoption even when all other providers succeeded', async () => {
  const f = fixture();
  await f.app.checkConnections();
  const run = await f.impact();
  await f.generate(run);
  f.services.daytona.validate = async () => validation('preserved-1');
  const result = await f.validate(run);
  assert.equal(result.validation.valid, false);
  await rejectsCode(f.adopt(run), 'VALIDATION_REQUIRED');
});

test('incomplete, inconsistent, or nonzero-exit validation reports cannot authorize adoption', async (t) => {
  const cases = [
    ['missing checks', { exitCode: 0, validation: { valid: true, checks: [] } }],
    ['nonzero exit', { ...validation(), exitCode: 1 }],
    ['inconsistent valid flag', { ...validation('complete'), validation: { ...validation('complete').validation, valid: true } }],
    ['duplicate check', { ...validation(), validation: { ...validation().validation, checks: [...validation().validation.checks.slice(1), validation().validation.checks[1]] } }],
  ];
  for (const [name, report] of cases) await t.test(name, async () => {
    const f = fixture();
    await f.app.checkConnections();
    const run = await f.impact();
    await f.generate(run);
    f.services.daytona.validate = async () => copy(report);
    await rejectsCode(f.validate(run), 'SERVICE_FAILED');
    await rejectsCode(f.adopt(run), 'VALIDATION_REQUIRED');
  });
});

test('two concurrent runs keep proposals separate and a busy run rejects duplicate actions', async () => {
  const f = fixture();
  await f.app.checkConnections();
  let next = 0;
  f.services.neo4j.impact = async () => ({ affectedIds: [3, 4, 5], preservedIds: [1, 2], marker: ++next });
  const [runA, runB] = await Promise.all([f.impact(), f.impact()]);
  assert.notEqual(runA.runId, runB.runId);
  const gateA = deferred(), gateB = deferred();
  f.services.nosana.generate = async (impact) => {
    await (impact.marker === 1 ? gateA.promise : gateB.promise);
    const proposal = copy(SAMPLE_PROPOSAL);
    proposal.scenes[2].text = `テスト専用のrun ${impact.marker}`;
    return proposal;
  };
  const generationA = f.generate(runA), generationB = f.generate(runB);
  await rejectsCode(f.generate(runA), 'BUSY');
  await rejectsCode(f.adopt(runA), 'BUSY');
  gateB.resolve();
  await generationB;
  await f.validate(runB);
  assert.equal((await f.adopt(runB)).scenes[2].text, 'テスト専用のrun 2');
  gateA.resolve();
  await generationA;
  await f.validate(runA);
  assert.equal((await f.adopt(runA)).scenes[2].text, 'テスト専用のrun 1');
  await f.undo(runB);
  assert.equal((await f.adopt(runA)).scenes[2].text, 'テスト専用のrun 1');
});

test('returned data is cloned so callers cannot mutate stored proposals or the original story', async () => {
  const f = fixture();
  await f.app.checkConnections();
  const run = await f.impact();
  run.affectedIds[0] = 99;
  const generated = await f.generate(run);
  generated.proposal.scenes[0].text = '外部からの書き換え';
  await f.validate(run);
  const adopted = await f.adopt(run);
  assert.equal(adopted.scenes[0].text, STORY.scenes[0].text);
  adopted.scenes[0].text = '別の書き換え';
  assert.equal((await f.adopt(run)).scenes[0].text, STORY.scenes[0].text);
});

test('runs expire after one hour and expiry never silently substitutes another run', async () => {
  let clock = 1_000;
  const f = fixture({ now: () => clock });
  await f.app.checkConnections();
  const run = await f.impact();
  await f.generate(run);
  await f.validate(run);
  clock += 60 * 60 * 1000;
  assert.equal((await f.adopt(run)).adopted, true, 'the exact one-hour boundary is still valid');
  clock += 1;
  await rejectsCode(f.undo(run), 'RUN_NOT_FOUND');
  await rejectsCode(f.adopt(run), 'RUN_NOT_FOUND');
  const newRun = await f.impact();
  assert.notEqual(newRun.runId, run.runId);
  await f.generate(newRun);
});

test('sample endpoint is explicitly labeled and performs no provider calls', async () => {
  const f = fixture();
  const result = await f.app.dispatch('GET', '/api/sample');
  assert.match(result.label, /サンプル/);
  assert.match(result.label, /AI生成・スポンサー実行なし/);
  assert.deepEqual(result.proposal, SAMPLE_PROPOSAL);
  assert.equal(f.calls.length, 0);
});
