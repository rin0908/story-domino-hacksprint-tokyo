import assert from 'node:assert/strict';
import { createServices } from '../src/services.mjs';
import { SAMPLE_PROPOSAL } from '../src/story.mjs';
import { safeError } from '../src/config.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const services = createServices(process.env);
const evidence = { checkedAt: new Date().toISOString(), provider: 'daytona', inputSource: '明示した事前作成サンプルと、その不正データ。AI生成結果ではない。', cases: [] };
try {
  for (const [name, mutate, expected] of [
    ['正しいサンプルの形式検査', p => p, true],
    ['場面1の改変を拒否', p => { p.scenes[0].text = '変更してはいけない場面'; return p; }, false],
    ['場面IDの欠落と重複を拒否', p => { p.scenes[4].id = 4; return p; }, false],
  ]) {
    const result = await services.daytona.validate({ proposal: mutate(structuredClone(SAMPLE_PROPOSAL)) });
    assert.equal(result.validation.valid, expected);
    evidence.cases.push({ name, ...result });
    console.log(`Daytona実行: ${name} — 期待どおり ${result.validation.valid ? '合格' : '不合格'}`);
  }
} catch (error) {
  console.log(safeError('daytona', error.code).message);
  process.exitCode = 1;
} finally {
  await mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.runtime/daytona-evidence.json', import.meta.url), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await services.close();
}
