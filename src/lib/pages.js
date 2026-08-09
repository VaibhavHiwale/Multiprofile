import { escapeHtml } from './html.js';

const BASE_STYLE = `
  body { font-family: system-ui, sans-serif; background: #111; color: #eee;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  main { max-width: 360px; padding: 2rem; text-align: center; }
  h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
  p { color: #aaa; line-height: 1.4; }
  input { font-size: 1.5rem; letter-spacing: 0.3rem; text-align: center; width: 100%;
    padding: 0.6rem; border-radius: 8px; border: 1px solid #444; background: #1c1c1c; color: #eee; margin: 1rem 0; }
  button, .btn { display: inline-block; font-size: 1rem; padding: 0.75rem 1.5rem; border-radius: 999px;
    border: none; background: #5b3ee0; color: #fff; cursor: pointer; text-decoration: none; margin-top: 0.5rem; }
  .error { color: #e0507b; font-size: 0.9rem; }
`;

export function renderPinForm({ token, profileId, name, error = null }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Switch to ${escapeHtml(name)}</title><style>${BASE_STYLE}</style></head>
<body><main>
  <h1>Enter PIN for ${escapeHtml(name)}</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : '<p>This profile is PIN-protected.</p>'}
  <form method="POST" action="/${token}/switch/${profileId}">
    <input type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" autofocus required>
    <div><button type="submit">Switch</button></div>
  </form>
</main></body></html>`;
}

export function renderSwitchConfirmation({ name }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Switched to ${escapeHtml(name)}</title><style>${BASE_STYLE}</style>
<script>setTimeout(function () { window.location.href = 'stremio://board'; }, 400);</script>
</head>
<body><main>
  <h1>Switched to ${escapeHtml(name)}</h1>
  <p>Attempting to return you to Stremio automatically. If nothing happens
     (this is a known issue on some platforms), tap the button below.</p>
  <a class="btn" href="stremio://board">Tap here to return to your library</a>
</main></body></html>`;
}
