// These tests execute the real fixed Python validation program locally.
// They verify code behavior, not Daytona connectivity or sandbox execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildValidationCode } from '../src/validation.mjs';
import { STORY, SAMPLE_PROPOSAL } from '../src/story.mjs';

const copy = (value) => structuredClone(value);
function validate(proposal = copy(SAMPLE_PROPOSAL)) {
  const result = spawnSync('python3', ['-c', buildValidationCode()], {
    env: { ...process.env, STORY_DOMINO_INPUT: JSON.stringify({ original: STORY, proposal }) },
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Python validation failed: ${result.stderr}`);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}
function failed(result, id) {
  assert.equal(result.valid, false);
  assert.equal(result.checks.find((check) => check.id === id)?.passed, false, `${id} must fail`);
}

test('valid five-scene proposal passes the real fixed Python program locally', () => {
  const result = validate();
  assert.equal(result.valid, true);
  assert.equal(result.checks.length, 7);
  assert.ok(result.checks.every((check) => check.passed === true));
  assert.match(result.scope, /形式検査/);
  assert.match(result.scope, /意味/);
  assert.match(result.scope, /人が確認/);
});

test('missing and duplicate scene IDs are rejected independently', () => {
  const missing = copy(SAMPLE_PROPOSAL);
  missing.scenes = missing.scenes.filter((scene) => scene.id !== 4);
  failed(validate(missing), 'complete');
  const duplicate = copy(SAMPLE_PROPOSAL);
  duplicate.scenes[3].id = 3;
  const result = validate(duplicate);
  failed(result, 'unique');
  failed(result, 'complete');
});

test('IDs must be actual Python integers in range; booleans cannot masquerade as integers', async (t) => {
  for (const id of [true, false, '3', 3.5, null, 0, 6, {}, []]) {
    await t.test(JSON.stringify(id), () => {
      const proposal = copy(SAMPLE_PROPOSAL);
      proposal.scenes[2].id = id;
      failed(validate(proposal), 'ids');
    });
  }
});

test('changing either title or text of preserved scenes 1 or 2 is rejected', async (t) => {
  for (const id of [1, 2]) for (const field of ['title', 'text']) {
    await t.test(`scene ${id} ${field}`, () => {
      const proposal = copy(SAMPLE_PROPOSAL);
      proposal.scenes.find((scene) => scene.id === id)[field] += '変更';
      failed(validate(proposal), `preserved-${id}`);
    });
  }
});

test('non-scene data, empty content, and overlong strings are rejected', async (t) => {
  const cases = [
    ['non-array scenes', (proposal) => { proposal.scenes = {}; }, 'content'],
    ['non-object scene', (proposal) => { proposal.scenes[2] = 'scene'; }, 'content'],
    ['empty title', (proposal) => { proposal.scenes[2].title = '  '; }, 'content'],
    ['empty text', (proposal) => { proposal.scenes[2].text = '\n\t'; }, 'content'],
    ['non-string text', (proposal) => { proposal.scenes[2].text = 123; }, 'content'],
    ['overlong title', (proposal) => { proposal.scenes[2].title = 'あ'.repeat(121); }, 'content'],
    ['overlong text', (proposal) => { proposal.scenes[2].text = 'あ'.repeat(3001); }, 'content'],
    ['empty reason', (proposal) => { proposal.reason = ''; }, 'metadata'],
    ['missing ending', (proposal) => { delete proposal.ending; }, 'metadata'],
  ];
  for (const [name, mutate, check] of cases) await t.test(name, () => {
    const proposal = copy(SAMPLE_PROPOSAL);
    mutate(proposal);
    failed(validate(proposal), check);
  });
});

test('scene order can change while exact IDs and preserved content still pass', () => {
  const proposal = copy(SAMPLE_PROPOSAL);
  proposal.scenes.reverse();
  assert.equal(validate(proposal).valid, true);
});

test('quotes, newlines, and Python-looking story text stay data and never execute', () => {
  const marker = join(tmpdir(), `story-domino-injection-must-not-exist-${randomUUID()}`);
  const proposal = copy(SAMPLE_PROPOSAL);
  proposal.scenes[2].text = `引用符 " ' \\ と改行\n\"\"\"\n__import__('pathlib').Path(${JSON.stringify(marker)}).write_text('executed')\n#`;
  proposal.reason = `'); __import__('os').system('echo INJECTION_SENTINEL'); #`;
  assert.equal(existsSync(marker), false);
  const result = validate(proposal);
  assert.equal(result.valid, true, 'Python-looking prose is permitted as data');
  assert.equal(existsSync(marker), false, 'story text must not create files');
  assert.equal(buildValidationCode().includes(marker), false, 'the fixed executable program does not interpolate story data');
});

test('null proposal fails clearly without executing untrusted input or crashing', () => {
  const result = validate(null);
  failed(result, 'complete');
  failed(result, 'metadata');
});
