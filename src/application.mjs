import { randomUUID } from 'node:crypto';
import { STORY, SAMPLE_PROPOSAL } from './story.mjs';
import { SERVICE_NAMES, missingSettings, safeError } from './config.mjs';
import { EVENT } from './event.mjs';
import { redactSecrets } from './services.mjs';

const fail = (code, stage, status = 409) => { throw Object.assign(new Error(code), { code, stage, status }); };
const clone = (value) => structuredClone(value);

export function createApplication({ services, env = process.env, now = () => Date.now() }) {
  const runs = new Map();
  const states = {};
  let checking = false;
  const status = () => {
    const list = Object.entries(SERVICE_NAMES).map(([id, name]) => {
      const missing = missingSettings(id, env);
      return { id, name, state: missing.length ? 'missing' : states[id]?.state || 'configured', message: missing.length ? '必要な接続情報が未設定です。登録状況と接続成功は別に確認します。' : states[id]?.message || '値は設定されています。実接続はまだ確認していません。', missing, checkedAt: states[id]?.checkedAt || null };
    });
    return { services: list, readiness: { ready: list.every((s) => s.state === 'connected') }, event: clone(EVENT) };
  };
  function requireConfigured(id) {
    if (missingSettings(id, env).length) fail('CONFIG_MISSING', id, 503);
  }
  async function call(id, operation) {
    requireConfigured(id);
    try { return await operation(); }
    catch (error) {
      const safe = safeError(id, error.code);
      states[id] = { state: 'failed', message: safe.message, checkedAt: new Date(now()).toISOString() };
      throw Object.assign(new Error(safe.code), { code: safe.code, stage: id, status: 502 });
    }
  }
  async function checkConnections() {
    if (checking) fail('BUSY', 'connections');
    checking = true;
    try {
      await Promise.allSettled(Object.keys(SERVICE_NAMES).map(async (id) => {
        if (missingSettings(id, env).length) return;
        states[id] = { state: 'checking', message: '実際の応答を確認しています。' };
        await call(id, () => services[id].check());
        states[id] = { state: 'connected', message: id === 'nosana' ? '実際のモデルから短文応答を受信しました。' : id === 'daytona' ? '既存Sandbox内でPythonの実行と終了値を確認しました。' : '接続確認とRETURN 1のクエリに成功しました。', checkedAt: new Date(now()).toISOString() };
      }));
    } finally { checking = false; }
    return status();
  }
  function getRun(id) {
    for (const [key, run] of runs) if (now() - run.createdAt > 60 * 60 * 1000 && !run.busy) runs.delete(key);
    const run = runs.get(id);
    if (!run) fail('RUN_NOT_FOUND', 'run', 404);
    return run;
  }
  async function withRun(id, operation) {
    const run = getRun(id);
    if (run.busy) fail('BUSY', 'run');
    run.busy = true;
    try { return await operation(run); } finally { run.busy = false; }
  }
  return {
    status, checkConnections,
    async dispatch(method, path, body = {}) {
      if (method === 'GET' && path === '/api/story') return clone(STORY);
      if (method === 'GET' && path === '/api/status') return status();
      if (method === 'GET' && path === '/api/sample') return { label: 'サンプル：事前に作成した例（AI生成・スポンサー実行なし）', affectedIds: [3, 4, 5], proposal: clone(SAMPLE_PROPOSAL) };
      if (method !== 'POST') fail('INVALID_REQUEST', 'request', 404);
      if (path === '/api/check-connections') return checkConnections();
      if (path === '/api/impact') {
        const impact = await call('neo4j', () => services.neo4j.impact());
        if (!Array.isArray(impact.affectedIds) || JSON.stringify([...impact.affectedIds].sort()) !== '[3,4,5]') fail('GRAPH_UNEXPECTED', 'neo4j', 502);
        const runId = randomUUID();
        // A small bounded in-memory store, isolated by opaque per-run IDs.
        if (runs.size >= 100) {
          const oldest = [...runs.entries()].find(([, run]) => !run.busy);
          if (oldest) runs.delete(oldest[0]); else fail('BUSY', 'run');
        }
        runs.set(runId, { createdAt: now(), impact: clone(impact), phase: 'impact', busy: false });
        return { ...clone(impact), runId, source: 'neo4j' };
      }
      if (!['/api/generate', '/api/validate', '/api/adopt', '/api/undo'].includes(path)) fail('INVALID_REQUEST', 'request', 404);
      if (typeof body.runId !== 'string') fail('INVALID_REQUEST', 'request', 400);
      return withRun(body.runId, async (run) => {
        if (path === '/api/generate') {
          if (run.phase !== 'impact') fail('ORDER_INVALID', 'nosana');
          requireConfigured('nosana');
          if (states.nosana?.state !== 'connected') fail('CHECK_REQUIRED', 'nosana');
          const proposal = await call('nosana', () => services.nosana.generate(clone(run.impact)));
          run.proposal = clone(proposal);
          run.phase = 'generated';
          return { runId: body.runId, proposal: clone(proposal), source: 'nosana', model: redactSecrets(env.NOSANA_MODEL, env) };
        }
        if (path === '/api/validate') {
          if (run.phase !== 'generated') fail('ORDER_INVALID', 'daytona');
          const result = await call('daytona', () => services.daytona.validate({ proposal: clone(run.proposal) }));
          const checks = result.validation?.checks;
          const expected = ['ids', 'unique', 'complete', 'content', 'preserved-1', 'preserved-2', 'metadata'];
          const authenticShape = result.exitCode === 0 && Array.isArray(checks) && checks.length === expected.length && expected.every((id) => checks.filter((c) => c.id === id && typeof c.passed === 'boolean').length === 1);
          if (!authenticShape || result.validation.valid !== checks.every((c) => c.passed)) fail('SERVICE_FAILED', 'daytona', 502);
          run.validation = clone(result.validation);
          run.phase = result.validation.valid ? 'validated' : 'rejected';
          return { runId: body.runId, ...clone(result), source: 'daytona' };
        }
        if (path === '/api/adopt') {
          if (!['validated', 'adopted'].includes(run.phase) || run.validation?.valid !== true) fail('VALIDATION_REQUIRED', 'daytona');
          run.phase = 'adopted';
          return { scenes: clone(run.proposal.scenes), ending: run.proposal.ending, premise: STORY.changedPremise, adopted: true };
        }
        if (run.phase !== 'adopted') fail('ORDER_INVALID', 'run');
        run.phase = 'validated';
        return { scenes: clone(STORY.scenes), ending: STORY.ending, premise: STORY.premise, adopted: false };
      });
    }
  };
}
