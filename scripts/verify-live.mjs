import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApplication } from '../src/application.mjs';
import { createServices } from '../src/services.mjs';
import { STORY } from '../src/story.mjs';
import { safeError } from '../src/config.mjs';

// Real providers only. No sample/fake fallback is used by this smoke test.
const services = createServices(process.env);
const app = createApplication({ services });
const evidence = { checkedAt: new Date().toISOString(), realProviders: true };
try {
  const status = await app.checkConnections();
  evidence.services = status.services;
  for (const service of status.services) console.log(`${service.name}: ${service.state} — ${service.message}`);
  if (status.services.find(s => s.id === 'neo4j').state === 'connected') {
    const impact = await app.dispatch('POST', '/api/impact', {});
    evidence.impact = impact;
    console.log(`Neo4j実検索: 場面${impact.affectedIds.join('・')} / ${impact.paths.length}経路`);
    if (status.readiness.ready) {
      const body = { runId: impact.runId };
      evidence.generated = await app.dispatch('POST', '/api/generate', body);
      evidence.validated = await app.dispatch('POST', '/api/validate', body);
      console.log(`Nosana実生成: ${evidence.generated.model} / ${evidence.generated.proposal.scenes.length}場面`);
      console.log(`Daytona実検査: ${evidence.validated.validation.valid ? '合格' : '不合格'}`);
      if (evidence.validated.validation.valid) {
        const adopted = await app.dispatch('POST', '/api/adopt', body);
        for (const id of [1, 2]) assert.deepEqual(adopted.scenes.find(s => s.id === id), STORY.scenes.find(s => s.id === id));
        const undone = await app.dispatch('POST', '/api/undo', body);
        assert.deepEqual(undone.scenes, STORY.scenes);
        assert.equal(undone.premise, STORY.premise);
        assert.equal(undone.ending, STORY.ending);
        evidence.adoptUndoVerified = true;
        console.log('実生成結果の採用・元に戻す: 完全復元を確認');
      } else process.exitCode = 1;
    } else process.exitCode = 1;
  } else process.exitCode = 1;
} catch (error) {
  evidence.error = safeError(error.stage, error.code);
  console.log(evidence.error.message);
  process.exitCode = 1;
} finally {
  await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.runtime/live-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await services.close();
}
