import satori from '@cf-wasm/satori/workerd';
import { Resvg } from '@cf-wasm/resvg/workerd';
import { FONTS } from './fonts.js';

const SIZE = 400;
const PALETTE = [
  '#5b3ee0', '#e0507b', '#1fa672', '#e0973f',
  '#2f8fe0', '#c14fd6', '#3fb7ad', '#d64f4f',
];

// Unchanged from the @napi-rs/canvas build — same hash, same palette, so an
// existing profile keeps exactly the background colour it always had.
export function colorForSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// A handful of code points and not an http(s) URL: treat it as the emoji glyph
// picked in /configure, not a link. Full image-URL avatars aren't fetched or
// composited in this MVP — falls back to initials instead (a documented
// limitation, not a bug: see docs/PROGRESS.md).
export function isGlyph(avatarUrl) {
  if (!avatarUrl) return false;
  if (/^https?:\/\//i.test(avatarUrl)) return false;
  return Array.from(avatarUrl).length <= 4;
}

export function truncateName(name) {
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

// The active badge's tick used to be the text glyph '✓'. Roboto's latin subset
// doesn't carry U+2713, so it's drawn as a path instead — identical shape,
// zero dependency on what's in the font.
const CHECK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
  '<path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" fill="none" stroke="#ffffff" ' +
  'stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function svgDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function toCodePoints(text) {
  return [...text]
    .map((ch) => ch.codePointAt(0).toString(16))
    .filter((hex) => hex !== 'fe0f') // drop the variation selector, as twemoji does
    .join('-');
}

// Satori resolves anything outside the loaded fonts through this callback. For
// emoji it wants a data URI back, which it embeds as an <image>. Fetching
// Twemoji is more reliable than the old canvas path's implicit dependency on a
// colour-emoji font being installed in the deploy image — and because posters
// are cached in R2 (see routes/stremio.js) this fetch happens roughly once per
// profile, not once per catalog render.
export const TWEMOJI_BASE =
  'https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg';

export function createEmojiAssetLoader(fetchImpl = fetch) {
  return async function loadAdditionalAsset(code, segment) {
    if (code !== 'emoji') return [];
    try {
      const res = await fetchImpl(`${TWEMOJI_BASE}/${toCodePoints(segment)}.svg`);
      if (!res.ok) return '';
      return svgDataUri(await res.text());
    } catch {
      // A missing emoji must never fail the whole poster.
      return '';
    }
  };
}

function badge({ left, background, children }) {
  return {
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        top: '12px',
        left: `${left}px`,
        width: '48px',
        height: '48px',
        borderRadius: '24px',
        backgroundColor: background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      children,
    },
  };
}

// Same square profile card the canvas version drew: an emoji glyph or initials
// on a seeded background, a name banner across the bottom, a green active
// checkmark top-right and a yellow "K" kids badge top-left.
export function buildPosterTree({ id, name, avatarUrl, isActive, isKids }) {
  const glyph = isGlyph(avatarUrl) ? avatarUrl : initialsFor(name);
  const children = [
    {
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          top: '0px',
          left: '0px',
          width: `${SIZE}px`,
          height: `${SIZE - 70 - 20}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '160px',
          fontWeight: 700,
          color: 'rgba(255,255,255,0.92)',
        },
        children: glyph,
      },
    },
    {
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          left: '0px',
          top: `${SIZE - 70}px`,
          width: `${SIZE}px`,
          height: '70px',
          backgroundColor: 'rgba(0,0,0,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '34px',
          fontWeight: 700,
          color: '#ffffff',
        },
        children: truncateName(name),
      },
    },
  ];

  if (isActive) {
    children.push(
      badge({
        left: SIZE - 36 - 24,
        background: '#2fbf71',
        children: {
          type: 'img',
          props: { src: svgDataUri(CHECK_SVG), width: 30, height: 30 },
        },
      })
    );
  }

  if (isKids) {
    children.push(
      badge({
        left: 12,
        background: '#ffcc33',
        children: {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              fontSize: '26px',
              fontWeight: 700,
              color: '#332200',
            },
            children: 'K',
          },
        },
      })
    );
  }

  return {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        width: `${SIZE}px`,
        height: `${SIZE}px`,
        display: 'flex',
        backgroundColor: colorForSeed(id),
        fontFamily: 'Roboto',
      },
      children,
    },
  };
}

export async function generateProfilePosterSvg(profile, { loadAdditionalAsset } = {}) {
  return satori(buildPosterTree(profile), {
    width: SIZE,
    height: SIZE,
    fonts: FONTS,
    loadAdditionalAsset: loadAdditionalAsset ?? createEmojiAssetLoader(),
  });
}

// Returns a PNG as a Uint8Array. resvg is the WASM rasteriser; satori has
// already outlined all text, so no font database is needed at this stage.
export async function generateProfilePoster(profile, options = {}) {
  const svg = await generateProfilePosterSvg(profile, options);
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: 'width', value: SIZE },
  });
  return resvg.render().asPng();
}
