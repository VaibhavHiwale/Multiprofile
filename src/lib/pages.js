import { escapeHtml } from './html.js';
import { ADDON_NAME } from './manifest.js';

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

// The PIN is submitted through a real HTML form POST, never a PIN-in-query
// -string GET, so it can't land in access logs or browser history.
export function renderPinForm({ token, profileId, name, error = null }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Switch to ${escapeHtml(name)} — ${ADDON_NAME}</title><style>${BASE_STYLE}</style></head>
<body><main>
  <h1>Enter PIN for ${escapeHtml(name)}</h1>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : '<p>This profile is PIN-protected.</p>'}
  <form method="POST" action="/${token}/switch/${profileId}">
    <input type="password" name="pin" inputmode="numeric" pattern="[0-9]*" maxlength="8" autofocus required>
    <div><button type="submit">Switch</button></div>
  </form>
</main></body></html>`;
}

// design.md §2 anticipated the stremio:// deep link being unreliable
// (Stremio/stremio-bugs#2466, #2484 documents it silently failing on
// macOS). Real-device testing (2026-08-10, Windows) found something worse
// than silent failure: an *automatic* redirect attempt to stremio://board
// tripped a bug in that Stremio build's own deep-link handler, which
// misread it as an addon-install request and threw a visible error dialog
// on every single switch. Firing that unprompted on every page load is
// worse than not attempting it at all, so there is no longer an automatic
// redirect — only the manual button, which is opt-in (the user chose to
// tap it) rather than a surprise. The switch itself (the D1 write) always
// happens before this page renders, regardless of what the button does.
export function renderSwitchConfirmation({ name }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Switched to ${escapeHtml(name)} — ${ADDON_NAME}</title><style>${BASE_STYLE}</style>
</head>
<body><main>
  <h1>Switched to ${escapeHtml(name)}</h1>
  <p>You can close this page and switch back to Stremio yourself, or try
     the button below. On some Stremio versions it may show an error
     instead of returning you automatically — if that happens, the switch
     already worked, just go back to Stremio manually.</p>
  <a class="btn" href="stremio://board">Try returning to Stremio</a>
</main></body></html>`;
}
