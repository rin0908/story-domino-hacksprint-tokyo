const $ = (id) => document.getElementById(id);

const state = {
  story: null,
  scenes: [],
  ending: '',
  premise: '',
  mode: 'idle',
  busy: false,
  affectedIds: [],
  impact: null,
  proposal: null,
  validation: null,
  model: null,
  runId: null,
  adopted: false,
  sampleLabel: '',
  checkingConnections: false,
};

let statusRequestId = 0;

const serviceDescriptions = { neo4j: '関係をたどる', nosana: '修正案をつくる', daytona: '隔離環境で検査' };
const serviceIcons = { neo4j: 'N', nosana: 'n', daytona: 'D' };
const serviceStates = { missing: '設定待ち', configured: '設定済み・未確認', checking: '確認中', connected: '接続成功', failed: '接続失敗' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined ? { headers: { Accept: 'application/json' } } : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('アプリのサーバーに接続できませんでした。サーバーの起動状態を確認してください。');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('サーバーから読み取れる応答を受け取れませんでした。もう一度お試しください。');
  }
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `処理に失敗しました（HTTP ${response.status}）。`);
  }
  return data;
}

function notify(message, kind = '') {
  $('status-message').className = `status-message ${kind}`;
  $('status-symbol').textContent = ({ success: '✓', error: '!', working: '◌', sample: '◇' })[kind] || '○';
  $('status-text').textContent = message;
}

function updateButtons() {
  $('change-button').disabled = state.busy || !state.story;
  $('sample-button').disabled = state.busy || !state.story;
  $('check-button').disabled = state.busy;
  $('adopt-button').disabled = !canAdopt();
  $('undo-button').disabled = !canUndo();
  $('check-button').textContent = state.checkingConnections ? '接続を確認中…' : '接続を確認';
}

function canAdopt() {
  return !state.busy && Boolean(state.proposal) && !state.adopted &&
    (state.mode === 'sample' || (state.mode === 'live' && Boolean(state.runId) && state.validation?.valid === true));
}

function canUndo() {
  return !state.busy && state.adopted && (state.mode === 'sample' || (state.mode === 'live' && Boolean(state.runId)));
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelector('.pipeline').setAttribute('aria-busy', String(busy));
  updateButtons();
}

function setStep(id, status = '', label = '未実行') {
  $(`step-${id}`).className = `pipeline-step ${status}`;
  $(`step-${id}-state`).textContent = label;
}

function renderServices(data) {
  const services = Array.isArray(data.services) ? data.services : [];
  $('service-list').replaceChildren();
  $('connection-details-content').replaceChildren();
  for (const service of services) {
    const row = element('div', 'service-item');
    const icon = element('span', 'service-icon', serviceIcons[service.id] || '·');
    icon.setAttribute('aria-hidden', 'true');
    const copy = element('div');
    copy.append(element('strong', '', service.name), element('span', 'service-description', serviceDescriptions[service.id] || 'サービス'));
    const knownState = Object.hasOwn(serviceStates, service.state) ? service.state : 'missing';
    row.append(icon, copy, element('span', `state-pill ${knownState}`, serviceStates[knownState]));
    $('service-list').append(row);

    const detail = element('div', 'connection-detail-row');
    detail.append(element('strong', '', `${service.name}：${serviceStates[knownState]}`), element('p', '', service.message));
    if (service.missing?.length) {
      const missing = element('div', 'missing-config');
      for (const name of service.missing) missing.append(element('code', '', name));
      detail.append(missing);
    }
    if (service.checkedAt) {
      const date = new Date(service.checkedAt);
      if (!Number.isNaN(date.getTime())) detail.append(element('p', 'source-caption', `最終確認：${date.toLocaleString('ja-JP')}`));
    }
    $('connection-details-content').append(detail);
  }
  if (data.event) {
    $('event-status').replaceChildren(
      element('span', '', `スポンサー条件：${data.event.conditions || '未確認'}`),
      element('span', '', `提出先：${data.event.submission || '未確認'}`),
      element('span', '', `締切：${data.event.deadline || '未確認'}`),
    );
  }
}

function renderStory() {
  if (!state.story) return;
  $('current-premise').textContent = state.premise;
  $('current-ending').textContent = state.ending;
  $('fiction-note').textContent = state.story.disclaimer;
  $('premise-status').textContent = state.adopted ? 'CHANGED' : 'ORIGINAL';
  $('story-version').textContent = state.adopted ? (state.mode === 'sample' ? 'サンプルを採用中' : '修正案を採用中') : '元の物語';
  $('story-version').className = `story-version${state.adopted ? ' adopted' : ''}`;
  $('scene-grid').replaceChildren();
  for (const scene of state.scenes) {
    const preserved = state.story.preservedIds.includes(scene.id);
    const affected = state.affectedIds.includes(scene.id);
    const card = element('article', `scene-card${preserved ? ' preserved' : ''}${affected ? (state.mode === 'sample' ? ' sample-affected' : ' affected') : ''}`);
    const topline = element('div', 'scene-topline');
    const badge = preserved ? '維持する場面' : affected ? (state.mode === 'sample' ? 'サンプル対象' : '検索で関連あり') : '未検索';
    topline.append(element('span', 'scene-number', String(scene.id).padStart(2, '0')), element('span', 'scene-badge', badge));
    const heading = element('h3', '', scene.title);
    heading.id = `scene-${scene.id}-title`;
    card.setAttribute('aria-labelledby', heading.id);
    card.append(topline, heading, element('p', '', scene.text));
    $('scene-grid').append(card);
  }
  $('impact-legend').textContent = state.mode === 'sample'
    ? '黄：サンプルの修正対象。Neo4jの検索結果ではありません。'
    : state.impact
      ? `紫：Neo4jの検索結果 · 関連する場面 ${state.affectedIds.join('・') || 'なし'} / 緑：維持する場面`
      : '変更する設定との関係は、まだ検索していません。';
}

function renderEmptyComparison() {
  const empty = element('div', 'empty-state');
  const dominoes = element('div', 'empty-dominoes');
  dominoes.setAttribute('aria-hidden', 'true');
  for (const n of [1, 2, 3]) dominoes.append(element('span', '', n));
  empty.append(dominoes,
    element('h4', '', state.impact ? '関係の検索が完了しました。' : 'ひとつ変えて、つながりを見よう。'),
    element('p', '', state.impact ? '修正案はまだありません。生成・検査の進み具合や失敗の内容は、上のステップと状態メッセージで確認できます。' : '上の「実はデモは完成していた」から始めます。影響する場面と修正案が、ここに並びます。'),
    element('span', 'empty-caption', '場面1・2を維持し、物語の続きを見直します。'));
  $('comparison-content').append(empty);
}

function renderComparison() {
  const target = $('comparison-content');
  target.replaceChildren();
  if (state.mode === 'sample') target.append(element('div', 'sample-banner', state.sampleLabel));
  if (state.impact) {
    const paths = element('div', 'search-paths');
    paths.append(element('strong', '', `Neo4jで関連を検索：場面${state.affectedIds.join('・') || 'なし'}`));
    for (const path of state.impact.paths || []) {
      paths.append(element('p', '', `場面${path.sceneId}：${Array.isArray(path.path) ? path.path.join(' → ') : ''}`));
    }
    target.append(paths);
  }
  if (!state.proposal) {
    $('comparison-count').textContent = state.impact ? '検索結果を取得しました' : 'まだ変更はありません';
    renderEmptyComparison();
    return;
  }
  $('comparison-count').textContent = `${state.affectedIds.length}場面の修正候補`;
  const maintained = state.proposal.scenes.filter((scene) => state.story.preservedIds.includes(scene.id));
  const actuallyPreserved = state.story.preservedIds.every((id) => {
    const original = state.story.scenes.find((scene) => scene.id === id);
    const matches = maintained.filter((scene) => scene.id === id);
    return matches.length === 1 && matches[0].title === original.title && matches[0].text === original.text;
  });
  if (actuallyPreserved) target.append(element('p', 'comparison-preserved', '場面1・2は元の内容のままです。以下に修正候補を表示します。'));
  const relevant = state.proposal.scenes.filter((scene) => !state.story.preservedIds.includes(scene.id) || !actuallyPreserved);
  for (const scene of relevant) {
    const original = state.story.scenes.find((item) => item.id === scene.id);
    const row = element('article', 'comparison-row');
    const label = element('div', 'comparison-scene-label');
    label.append(element('span', 'small-scene-number', String(scene.id).padStart(2, '0')), element('span', '', `場面${scene.id}${state.story.preservedIds.includes(scene.id) ? '（維持対象・要確認）' : ''}`));
    const columns = element('div', 'comparison-columns');
    const before = element('div', 'comparison-cell');
    before.append(element('p', 'column-caption', 'BEFORE / 修正前'), element('h4', '', original?.title || '対応する元の場面がありません'), element('p', '', original?.text || '—'));
    const after = element('div', 'comparison-cell after');
    after.append(element('p', 'column-caption', state.mode === 'sample' ? 'SAMPLE / サンプル修正案' : 'AFTER / AIによる修正案'), element('h4', '', scene.title), element('p', '', scene.text));
    columns.append(before, after);
    row.append(label, columns);
    target.append(row);
  }
  if (state.proposal.ending !== state.story.ending) {
    const row = element('article', 'comparison-row');
    row.append(element('div', 'comparison-scene-label', 'オチの変更案'));
    const columns = element('div', 'comparison-columns');
    const before = element('div', 'comparison-cell');
    before.append(element('p', 'column-caption', 'BEFORE / 修正前'), element('p', '', state.story.ending));
    const after = element('div', 'comparison-cell after');
    after.append(element('p', 'column-caption', state.mode === 'sample' ? 'SAMPLE / サンプル修正案' : 'AFTER / AIによる修正案'), element('p', '', state.proposal.ending));
    columns.append(before, after);
    row.append(columns);
    target.append(row);
  }
}

function renderReview() {
  $('change-reason').textContent = state.proposal?.reason || (state.impact
    ? 'Neo4jの検索は完了しました。変更理由はNosanaの修正案を受信した後に表示します。'
    : 'まだ修正案はありません。設定と場面の関係を検索してから、変更理由を表示します。');
  $('generation-source').textContent = state.mode === 'sample'
    ? '事前に作成した例です。AI生成やスポンサーサービスの実行結果ではありません。'
    : state.model ? `実際の生成モデル：${state.model}（Nosana）` : '';
  $('mode-badge').className = `mode-badge ${state.mode === 'sample' ? 'sample' : state.mode === 'live' ? 'live' : ''}`;
  $('mode-badge').textContent = state.mode === 'sample' ? 'サンプル表示' : state.mode === 'live' ? '実サービス実行' : '準備中';
  $('validation-content').replaceChildren();
  $('validation-pill').className = 'validation-pill';
  if (state.mode === 'sample') {
    $('validation-pill').textContent = '実行なし';
    $('validation-content').append(element('p', 'muted-text', 'サンプルではDaytonaを実行しません。採用と取り消しは、この画面の中だけで体験できます。'));
  } else if (state.validation) {
    $('validation-pill').textContent = state.validation.valid ? '形式検査に合格' : '形式検査に不合格';
    $('validation-pill').classList.add(state.validation.valid ? 'valid' : 'invalid');
    const list = element('ul', 'validation-checks');
    for (const check of state.validation.checks || []) {
      const item = element('li');
      const text = element('span', '', check.label);
      if (check.detail) text.append(element('small', '', check.detail));
      const icon = element('span', `check-icon${check.passed ? '' : ' fail'}`, check.passed ? '✓' : '×');
      icon.setAttribute('aria-label', check.passed ? '合格' : '不合格');
      item.append(icon, text);
      list.append(item);
    }
    $('validation-content').append(list);
    if (state.validation.scope) $('validation-content').append(element('p', 'source-caption', state.validation.scope));
  } else {
    $('validation-pill').textContent = '未実行';
    $('validation-content').append(element('p', 'muted-text', '場面IDの欠落・重複、5場面の存在、場面1・2の維持を検査します。'));
  }
  $('adopt-button').replaceChildren(element('span', '', state.mode === 'sample' ? 'サンプルを採用' : 'この修正案を採用'), element('span', '', '✓'));
  $('adoption-note').textContent = state.adopted
    ? '採用しました。「元に戻す」で元の物語に戻せます。'
    : state.mode === 'sample'
      ? 'サンプルの操作は、この画面内だけに反映します。'
      : state.validation?.valid === false
        ? '形式検査に不合格のため、採用できません。'
        : state.validation?.valid === true
          ? '内容を確認して、修正案を採用してください。'
          : '形式検査に通ると、採用できます。';
  updateButtons();
}

function resetRun(mode) {
  Object.assign(state, {
    mode, affectedIds: [], impact: null, proposal: null, validation: null,
    model: null, runId: null, adopted: false, sampleLabel: '',
    scenes: structuredClone(state.story.scenes), ending: state.story.ending, premise: state.story.premise,
  });
  for (const step of ['impact', 'generate', 'validate']) setStep(step);
  renderStory();
  renderComparison();
  renderReview();
}

async function runPipeline() {
  if (state.busy || !state.story) return;
  resetRun('live');
  setBusy(true);
  let stage = 'impact';
  try {
    setStep(stage, 'running', '検索中…');
    notify('Neo4jで、変更する前提から場面への関係を検索しています。', 'working');
    const impact = await api('/api/impact', {});
    state.impact = impact;
    state.affectedIds = impact.affectedIds;
    state.runId = impact.runId;
    setStep(stage, 'done', `${impact.affectedIds.length}場面を取得`);
    renderStory();
    renderComparison();
    renderReview();

    stage = 'generate';
    setStep(stage, 'running', '生成中…');
    notify('Neo4jの検索が完了しました。Nosanaで、維持する場面も指定して修正案を生成しています。', 'working');
    const generated = await api('/api/generate', { runId: state.runId });
    state.proposal = generated.proposal;
    state.model = generated.model;
    setStep(stage, 'done', '生成完了');
    renderComparison();
    renderReview();

    stage = 'validate';
    setStep(stage, 'running', '検査中…');
    notify('修正案を生成しました。Daytonaの隔離環境で、5場面の形式と維持対象を検査しています。', 'working');
    const result = await api('/api/validate', { runId: state.runId });
    state.validation = result.validation;
    setStep(stage, result.validation.valid ? 'done' : 'failed', result.validation.valid ? '形式検査に合格' : '形式検査に不合格');
    renderReview();
    notify(result.validation.valid
      ? '検索・生成・形式検査が完了しました。修正案の内容を確認し、よければ「この修正案を採用」を押してください。'
      : 'Daytonaで形式検査を実行しましたが、不合格でした。検査結果を確認してください。この修正案は採用できません。', result.validation.valid ? 'success' : 'error');
  } catch (error) {
    setStep(stage, 'failed', '失敗');
    const stageName = { impact: 'Neo4jの検索', generate: 'Nosanaの生成', validate: 'Daytonaの検査' }[stage];
    notify(`${stageName}に失敗しました。${error.message} サンプルへは自動で切り替えません。`, 'error');
  } finally {
    setBusy(false);
    void refreshStatus();
  }
}

async function showSample() {
  if (state.busy || !state.story) return;
  setBusy(true);
  notify('サンプルを読み込んでいます。スポンサーサービスは実行しません。', 'working');
  try {
    const sample = await api('/api/sample');
    resetRun('sample');
    state.sampleLabel = sample.label;
    state.affectedIds = sample.affectedIds;
    state.proposal = sample.proposal;
    for (const step of ['impact', 'generate', 'validate']) setStep(step, '', 'サンプル・実行なし');
    renderStory();
    renderComparison();
    renderReview();
    notify('サンプルを表示しています。事前に作成した例で、AI生成・Neo4j検索・Daytona検査は実行していません。', 'sample');
  } catch (error) {
    notify(`サンプルを読み込めませんでした。${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function adopt() {
  if (!canAdopt()) return;
  setBusy(true);
  try {
    if (state.mode === 'sample') {
      state.scenes = structuredClone(state.proposal.scenes);
      state.ending = state.proposal.ending;
      state.premise = state.story.changedPremise;
    } else {
      notify('形式検査済みの修正案を採用しています。', 'working');
      const result = await api('/api/adopt', { runId: state.runId });
      state.scenes = result.scenes;
      state.ending = result.ending;
      state.premise = result.premise;
    }
    state.adopted = true;
    renderStory();
    renderReview();
    notify(state.mode === 'sample' ? 'サンプルをこの画面内で採用しました。「元に戻す」で元の物語に戻せます。' : '修正案を採用しました。5つの場面を更新しました。「元に戻す」で元の物語に戻せます。', state.mode === 'sample' ? 'sample' : 'success');
  } catch (error) {
    notify(`採用できませんでした。${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function undo() {
  if (!canUndo()) return;
  setBusy(true);
  try {
    if (state.mode === 'sample') {
      state.scenes = structuredClone(state.story.scenes);
      state.ending = state.story.ending;
      state.premise = state.story.premise;
    } else {
      notify('採用を取り消し、元の物語に戻しています。', 'working');
      const result = await api('/api/undo', { runId: state.runId });
      state.scenes = result.scenes;
      state.ending = result.ending;
      state.premise = result.premise;
    }
    state.adopted = false;
    renderStory();
    renderReview();
    notify(state.mode === 'sample' ? 'サンプルの採用を取り消しました。5場面・前提・オチを元に戻しました。' : '採用を取り消しました。5場面・前提・オチを元に戻しました。', state.mode === 'sample' ? 'sample' : 'success');
  } catch (error) {
    notify(`元に戻せませんでした。${error.message} 現在の表示は維持しています。`, 'error');
  } finally {
    setBusy(false);
  }
}

async function refreshStatus() {
  const requestId = ++statusRequestId;
  try {
    const result = await api('/api/status');
    if (requestId === statusRequestId) renderServices(result);
  } catch {
    if (requestId !== statusRequestId) return;
    $('connection-details-content').replaceChildren(element('p', '', '接続設定の状態を取得できませんでした。「接続を確認」で再試行してください。'));
    for (const pill of document.querySelectorAll('.service-list .state-pill')) {
      pill.textContent = '取得失敗';
      pill.className = 'state-pill failed';
    }
  }
}

async function checkConnections() {
  if (state.busy) return;
  const requestId = ++statusRequestId;
  state.checkingConnections = true;
  setBusy(true);
  notify('3サービスへの最小接続を確認しています。Nosanaには短い文章の応答を確認します。', 'working');
  for (const pill of document.querySelectorAll('.service-list .state-pill')) {
    pill.textContent = '確認中…';
    pill.className = 'state-pill checking';
  }
  try {
    const result = await api('/api/check-connections', {});
    if (requestId === statusRequestId) renderServices(result);
    const connected = result.services.filter((service) => service.state === 'connected').length;
    notify(result.readiness.ready
      ? '3サービスの実際の応答を確認しました。「実はデモは完成していた」から検索・生成・検査を実行できます。'
      : `接続確認が終わりました。${connected}/3サービスが接続成功です。「接続の詳細と必要な設定」を確認してください。`, result.readiness.ready ? 'success' : 'error');
    if (!result.readiness.ready) document.querySelector('.connection-details').open = true;
  } catch (error) {
    notify(`接続確認に失敗しました。${error.message}`, 'error');
    await refreshStatus();
  } finally {
    state.checkingConnections = false;
    setBusy(false);
  }
}

$('change-button').addEventListener('click', runPipeline);
$('sample-button').addEventListener('click', showSample);
$('check-button').addEventListener('click', checkConnections);
$('adopt-button').addEventListener('click', adopt);
$('undo-button').addEventListener('click', undo);

async function init() {
  setBusy(true);
  const requestId = ++statusRequestId;
  const results = await Promise.allSettled([api('/api/story'), api('/api/status')]);
  if (results[0].status === 'fulfilled') {
    state.story = results[0].value;
    resetRun('idle');
    notify('準備できました。接続を確認して、ひとつの設定を変えてみましょう。サンプルは設定なしで試せます。');
  } else {
    notify(`物語を読み込めませんでした。${results[0].reason.message} ページを再読み込みしてください。`, 'error');
  }
  if (results[1].status === 'fulfilled' && requestId === statusRequestId) {
    renderServices(results[1].value);
  } else if (requestId === statusRequestId) {
    $('connection-details-content').replaceChildren(element('p', '', '接続状態を取得できませんでした。「接続を確認」で再試行してください。'));
    for (const pill of document.querySelectorAll('.service-list .state-pill')) {
      pill.textContent = '取得失敗';
      pill.className = 'state-pill failed';
    }
  }
  setBusy(false);
}

void init();
