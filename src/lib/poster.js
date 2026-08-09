import { createCanvas } from '@napi-rs/canvas';

const SIZE = 400;
const PALETTE = [
  '#5b3ee0', '#e0507b', '#1fa672', '#e0973f',
  '#2f8fe0', '#c14fd6', '#3fb7ad', '#d64f4f',
];

function colorForSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Generates a square profile-card poster: initials on a seeded background
// color, name banner, and small active/kids badges. Called on demand and
// cached client-side via Cache-Control (see routes/stremio.js).
export async function generateProfilePoster({ id, name, isActive = false, isKids = false }) {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = colorForSeed(id);
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 160px sans-serif';
  ctx.fillText(initialsFor(name), SIZE / 2, SIZE / 2 - 10);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, SIZE - 70, SIZE, 70);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 34px sans-serif';
  const label = name.length > 16 ? `${name.slice(0, 15)}…` : name;
  ctx.fillText(label, SIZE / 2, SIZE - 35);

  if (isActive) {
    ctx.fillStyle = '#2fbf71';
    ctx.beginPath();
    ctx.arc(SIZE - 36, 36, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('✓', SIZE - 36, 39);
  }

  if (isKids) {
    ctx.fillStyle = '#ffcc33';
    ctx.beginPath();
    ctx.arc(36, 36, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#332200';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('K', 36, 39);
  }

  return canvas.encode('png');
}
