const form = document.getElementById('setup-form');
const input = document.getElementById('daytona-api-key');
const saveButton = document.getElementById('save-key-button');
const status = document.getElementById('setup-status');
const statusText = document.getElementById('setup-status-text');
let saving = false;

function showStatus(message, kind = '') {
  status.className = `status-message ${kind}`;
  statusText.textContent = message;
}

function setSaving(value) {
  saving = value;
  saveButton.disabled = value;
  input.disabled = value;
  saveButton.textContent = value ? '保存しています…' : 'この端末に保存';
}

// Only this same-origin POST receives the entered key. Do not log the form,
// request, response, or raw errors, and never fetch a previously saved key.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || !form.reportValidity()) return;
  if (!input.value.trim()) {
    showStatus('DaytonaのAPIキーを入力してください。', 'error');
    input.focus();
    return;
  }
  setSaving(true);
  showStatus('この端末の .env に保存しています。', 'working');
  try {
    const response = await fetch('/api/setup/daytona-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
      body: JSON.stringify({ apiKey: input.value.trim() }),
    });
    if (!response.ok) throw new Error('SAVE_FAILED');
    const result = await response.json();
    if (result.saved !== true) throw new Error('SAVE_FAILED');
    input.value = '';
    form.reset();
    showStatus('保存しました。サーバー再起動が必要です。再起動後、物語に戻って「接続を確認」を実行してください。', 'success');
  } catch {
    // A fixed message prevents a server or network error from echoing secrets.
    showStatus('保存を確認できませんでした。サーバーが起動していることと入力内容を確認して、もう一度保存してください。', 'error');
  } finally {
    setSaving(false);
  }
});

// Never retain a typed key in a page restored from browser navigation history.
window.addEventListener('pagehide', () => { input.value = ''; });
window.addEventListener('pageshow', (event) => { if (event.persisted) input.value = ''; });
saveButton.disabled = false;
