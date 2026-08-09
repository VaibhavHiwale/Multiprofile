const EMOJI_PALETTE = [
  '🎬', '🍿', '🐱', '🐶', '🦄', '🚀', '🎮', '🎨',
  '🌟', '🔥', '💎', '🎵', '📚', '⚽', '🏀', '🎯',
  '🌈', '🦊', '🐼', '🍕', '🎃', '👻', '🧙', '👑',
];

// Fully self-contained, vanilla HTML/CSS/JS (design doc §8: no build step,
// no framework — this is the one surface with zero Stremio protocol
// constraints, and it should stay simple enough to keep running unattended
// for years). The household token is read client-side from the URL path,
// so this same markup is served for every household.
export function renderConfigurePage() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MultiProfile — Household</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0d0d10; color: #eee; margin: 0; padding: 1.5rem;
    display: flex; flex-direction: column; align-items: center; }
  main { width: 100%; max-width: 720px; }
  h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
  .sub { color: #999; margin: 0 0 1.5rem; }
  section { background: #16161a; border-radius: 16px; padding: 1.25rem; margin-bottom: 1.5rem; }
  .install-row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .install-row img { width: 120px; height: 120px; border-radius: 8px; background: #fff; }
  .install-info { flex: 1; min-width: 220px; }
  code { display: block; background: #1f1f26; padding: 0.6rem 0.8rem; border-radius: 8px; word-break: break-all;
    font-size: 0.8rem; margin: 0.5rem 0; }
  button, .btn { font: inherit; background: #5b3ee0; color: #fff; border: none; border-radius: 999px;
    padding: 0.55rem 1.1rem; cursor: pointer; text-decoration: none; display: inline-block; }
  button.secondary { background: #2a2a33; }
  button.danger { background: #b8324a; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 1rem; }
  .card { background: #1f1f26; border-radius: 12px; padding: 0.75rem; cursor: grab; text-align: center; }
  .card.dragging { opacity: 0.4; }
  .card img { width: 100%; aspect-ratio: 1; border-radius: 8px; object-fit: cover; margin-bottom: 0.5rem; }
  .card .name { font-weight: 600; margin-bottom: 0.15rem; }
  .card .stats { font-size: 0.75rem; color: #999; margin-bottom: 0.5rem; }
  .card .actions { display: flex; gap: 0.4rem; justify-content: center; }
  .card .actions button { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
  .add-card { border: 2px dashed #444; display: flex; align-items: center; justify-content: center;
    min-height: 160px; font-size: 2rem; color: #666; background: none; }
  dialog { background: #1f1f26; color: #eee; border: none; border-radius: 16px; padding: 1.5rem; width: 90%; max-width: 360px; }
  dialog::backdrop { background: rgba(0,0,0,0.6); }
  label { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.85rem; color: #bbb; }
  input[type=text], input[type=password] { width: 100%; padding: 0.5rem; border-radius: 8px; border: 1px solid #444;
    background: #111; color: #eee; font-size: 1rem; }
  .emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 0.3rem; margin-top: 0.3rem; }
  .emoji-grid button { padding: 0.3rem; font-size: 1.2rem; background: #111; border-radius: 8px; }
  .emoji-grid button.selected { background: #5b3ee0; }
  .checkbox-row { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem; }
  .error { color: #e0507b; font-size: 0.85rem; margin-top: 0.5rem; }
  .limitation { font-size: 0.78rem; color: #888; margin-top: 0.75rem; line-height: 1.4; }
</style>
</head>
<body>
<main>
  <h1>MultiProfile</h1>
  <p class="sub">Household dashboard — manage profiles for this manifest URL.</p>

  <section>
    <div class="install-row">
      <img id="qr" alt="Install QR code">
      <div class="install-info">
        <div>Manifest URL</div>
        <code id="manifestUrl"></code>
        <button id="copyBtn" class="secondary">Copy URL</button>
        <a id="deepLink" class="btn" href="#">Open in Stremio</a>
      </div>
    </div>
  </section>

  <section>
    <div class="grid" id="grid"></div>
  </section>

  <p class="limitation">
    Kid profiles only filter this addon's own catalog rows (Continue Watching,
    Because You Watched) by Cinemeta genre metadata — they cannot filter what
    other installed addons independently return. This is scoped parental
    awareness, not a device-wide content lock.
  </p>
</main>

<dialog id="profileDialog">
  <form id="profileForm" method="dialog">
    <div id="dialogTitle" style="font-weight:600;">Add profile</div>
    <label>Name</label>
    <input type="text" id="fieldName" maxlength="40" required>
    <label>Avatar</label>
    <div class="emoji-grid" id="emojiGrid"></div>
    <div class="checkbox-row">
      <input type="checkbox" id="fieldKids">
      <label style="margin:0;" for="fieldKids">Kids profile</label>
    </div>
    <label>PIN (optional, 4–8 digits)</label>
    <input type="password" id="fieldPin" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Leave blank for none">
    <div class="error" id="formError"></div>
    <div class="dialog-actions">
      <button type="button" class="secondary" id="cancelBtn">Cancel</button>
      <button type="submit" id="saveBtn">Save</button>
    </div>
  </form>
</dialog>

<script>
(function () {
  const token = location.pathname.split('/')[1];
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
  const api = (path, opts) => fetch('/' + token + path, opts).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || ('request failed: ' + r.status));
    return body;
  });

  const manifestUrl = location.origin + '/' + token + '/manifest.json';
  document.getElementById('manifestUrl').textContent = manifestUrl;
  document.getElementById('qr').src = '/' + token + '/qrcode.png';
  document.getElementById('deepLink').href = 'stremio://' + location.host + '/' + token + '/manifest.json';
  document.getElementById('copyBtn').onclick = () => {
    navigator.clipboard.writeText(manifestUrl);
    const btn = document.getElementById('copyBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1200);
  };

  const EMOJI = ${JSON.stringify(EMOJI_PALETTE)};
  const emojiGrid = document.getElementById('emojiGrid');
  let selectedEmoji = null;
  EMOJI.forEach((e) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = e;
    btn.onclick = () => {
      selectedEmoji = e;
      [...emojiGrid.children].forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
    };
    emojiGrid.appendChild(btn);
  });

  const dialog = document.getElementById('profileDialog');
  const form = document.getElementById('profileForm');
  const formError = document.getElementById('formError');
  let editingId = null;

  function openDialog(profile) {
    editingId = profile ? profile.id : null;
    document.getElementById('dialogTitle').textContent = profile ? 'Edit profile' : 'Add profile';
    document.getElementById('fieldName').value = profile ? profile.name : '';
    document.getElementById('fieldKids').checked = profile ? profile.isKids : false;
    document.getElementById('fieldPin').value = '';
    document.getElementById('fieldPin').placeholder = profile && profile.hasPin
      ? 'Set — leave blank to keep, "clear" to remove' : 'Leave blank for none';
    selectedEmoji = profile ? profile.avatarUrl : null;
    [...emojiGrid.children].forEach((c) => c.classList.toggle('selected', c.textContent === selectedEmoji));
    formError.textContent = '';
    dialog.showModal();
  }
  document.getElementById('cancelBtn').onclick = () => dialog.close();

  document.getElementById('saveBtn').onclick = async (ev) => {
    ev.preventDefault();
    const name = document.getElementById('fieldName').value.trim();
    const isKids = document.getElementById('fieldKids').checked;
    const pinValue = document.getElementById('fieldPin').value.trim();
    formError.textContent = '';
    if (!name) { formError.textContent = 'Name is required.'; return; }

    const payload = { name, isKids, avatarUrl: selectedEmoji ?? null };
    if (editingId) {
      if (pinValue === 'clear') payload.pin = null;
      else if (pinValue) payload.pin = pinValue;
    } else if (pinValue) {
      payload.pin = pinValue;
    }

    try {
      if (editingId) {
        await api('/profiles/' + editingId, {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
      } else {
        await api('/profiles', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        });
      }
      dialog.close();
      await load();
    } catch (err) {
      formError.textContent = err.message;
    }
  };

  document.getElementById('grid').addEventListener('click', (ev) => {
    if (ev.target.dataset.action === 'add') openDialog(null);
  });

  let dragFromId = null;

  async function load() {
    const [{ profiles }, { stats }] = await Promise.all([api('/profiles'), api('/stats')]);
    const statsByProfile = Object.fromEntries(stats.map((s) => [s.profileId, s]));
    const grid = document.getElementById('grid');
    grid.innerHTML = '';

    profiles.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.draggable = true;
      card.dataset.id = p.id;

      const stat = statsByProfile[p.id];
      const statLine = stat
        ? stat.titlesWatched + ' watched' + (stat.topGenre ? ' · ' + stat.topGenre : '')
        : '';

      card.innerHTML =
        '<img src="/' + token + '/poster/' + p.id + '.png" alt="' + escapeHtml(p.name) + '">' +
        '<div class="name">' + escapeHtml(p.name) + (p.isActive ? ' ✓' : '') + '</div>' +
        '<div class="stats">' + escapeHtml(statLine) + '</div>' +
        '<div class="actions">' +
        '<button class="secondary" data-edit>Edit</button>' +
        '<button class="danger" data-delete>Delete</button>' +
        '</div>';

      card.querySelector('[data-edit]').onclick = () => openDialog(p);
      card.querySelector('[data-delete]').onclick = async () => {
        if (!confirm('Delete profile "' + p.name + '"?')) return;
        await api('/profiles/' + p.id, { method: 'DELETE' });
        await load();
      };

      card.addEventListener('dragstart', () => {
        dragFromId = p.id;
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (ev) => ev.preventDefault());
      card.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        if (!dragFromId || dragFromId === p.id) return;
        const ids = profiles.map((x) => x.id);
        const fromIndex = ids.indexOf(dragFromId);
        const toIndex = ids.indexOf(p.id);
        ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
        await api('/profiles/reorder', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileIds: ids }),
        });
        await load();
      });

      grid.appendChild(card);
    });

    if (profiles.length < 12) {
      const addCard = document.createElement('button');
      addCard.className = 'card add-card';
      addCard.dataset.action = 'add';
      addCard.textContent = '+';
      grid.appendChild(addCard);
    }
  }

  load();
})();
</script>
</body></html>`;
}
