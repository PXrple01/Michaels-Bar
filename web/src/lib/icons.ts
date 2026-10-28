// Linien-Icons (24×24, Strichstärke 2) und Wappen-Zeichen der Klassen.
import { raw, type Raw } from "./dom";

const P: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20"/><path d="M8 7h8M8 11h6"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  dice: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 2v6M3 7l9 1 9-1M12 8l-6 9h12z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sound: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m23 9-6 6M17 9l6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  potion: '<path d="M9 2h6M10 2v5L5 18a3 3 0 0 0 2.7 4h8.6A3 3 0 0 0 19 18l-5-11V2"/><path d="M7.5 14h9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sunset: '<path d="M17 18a5 5 0 0 0-10 0"/><path d="M12 9V2M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M16 5l-4 4-4-4"/>',
  cloud: '<path d="M18 10h-1.3A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
  minus: '<path d="M5 12h14"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M11 19l-7-7 7-7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  scroll: '<path d="M8 21h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H6"/><path d="M4 7a2 2 0 1 1 4 0v12a2 2 0 0 1-4 0"/><path d="M12 8h5M12 12h5M12 16h3"/>',
  sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4M16.7 13.9l.7.7-2.8 2.8"/>',
  bag: '<path d="M6 7h12l1 14H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  wand: '<path d="m15 4 5 5M3 21 14 10"/><path d="M18 2v2M22 6h-2M20 2l-1 1M9 3v2M8 4h2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  play: '<path d="m6 4 14 8-14 8z"/>',
  feather: '<path d="M20.2 12.2A6 6 0 0 0 11.8 3.8L5 10.6V19h8.4z"/><path d="M16 8 2 22M17.5 15H9"/>',
  fist: '<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4M10 9V4.5a1.5 1.5 0 0 1 3 0V9M13 9V5.5a1.5 1.5 0 0 1 3 0V10M16 10V7.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-2.5A1.5 1.5 0 0 1 7 11"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  crown: '<path d="m2 18 2-11 5 5 3-7 3 7 5-5 2 11z"/><path d="M4 21h16"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  map: '<path d="m1 6 7-3 8 3 7-3v15l-7 3-8-3-7 3z"/><path d="M8 3v15M16 6v15"/>',
  quill: '<path d="M20 2C10 4 6 10 5 19l-2 3"/><path d="M5 19c6 0 11-4 13-11M9 15c2-1 4-3 5-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
};

export function icon(name: keyof typeof P | string, cls = ""): Raw {
  return raw(`<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.info}</svg>`);
}

/** Wappenzeichen der Klassen – werden beim Einblenden „gezeichnet“ (stroke-dash). */
const SIGILS: Record<string, string> = {
  shield: '<path d="M32 6 52 13v16c0 15-10 24-20 29C22 53 12 44 12 29V13z"/><path d="M32 16v34M20 28h24"/><path d="M26 22l6-6 6 6"/>',
  axe: '<path d="M22 58 40 10"/><path d="M34 24c6-10 16-12 22-8-2 8-8 14-19 14"/><path d="M30 34c-10 2-16-2-18-10 8-4 16-2 21 4"/>',
  mask: '<path d="M10 18c8-6 36-6 44 0 0 20-8 34-22 38C18 52 10 38 10 18z"/><path d="M19 28c3-3 8-3 10 1M35 29c2-4 7-4 10-1"/><path d="M22 42c6 5 14 5 20 0"/>',
  candle: '<path d="M24 58h16M26 58V30h12v28"/><path d="M32 30v-6"/><path d="M32 8c5 6 5 10 0 14-5-4-5-8 0-14z"/><path d="M18 40h-6M52 40h-6M20 22l-4-4M44 22l4-4"/>',
  bow: '<path d="M18 6c22 10 22 42 0 52"/><path d="M18 6v52"/><path d="M8 32h46M46 26l8 6-8 6M12 28l-4 4 4 4"/>',
  cauldron: '<path d="M10 28h44"/><path d="M14 28c0 16 8 24 18 24s18-8 18-24"/><path d="M20 58l4-6M44 58l-4-6"/><path d="M26 20c0-4 4-4 4-8M34 22c0-5 5-5 5-10"/><circle cx="24" cy="36" r="2"/><circle cx="38" cy="40" r="3"/>',
};

export function sigil(name: string, cls = ""): Raw {
  return raw(`<svg class="sigil ${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIGILS[name] ?? SIGILS.shield}</svg>`);
}

/** Kleine Würfel-Silhouetten für Auswahlkacheln. */
const DICE_SHAPES: Record<number, string> = {
  4: '<path d="M32 6 58 54H6z"/><path d="M32 6v48M32 54 6 54M32 54l26 0"/>',
  6: '<rect x="10" y="10" width="44" height="44" rx="6"/><circle cx="22" cy="22" r="3" fill="currentColor"/><circle cx="32" cy="32" r="3" fill="currentColor"/><circle cx="42" cy="42" r="3" fill="currentColor"/>',
  8: '<path d="M32 4 58 32 32 60 6 32z"/><path d="M6 32h52M32 4l-10 28 10 28 10-28z"/>',
  10: '<path d="M32 4 58 26 32 60 6 26z"/><path d="M6 26l14 6 12-6 12 6 14-6M20 32l12 28 12-28M32 4v22"/>',
  12: '<path d="M32 4 56 18 56 46 32 60 8 46 8 18z"/><path d="M32 16l12 9-5 14H25l-5-14z"/><path d="M32 4v12M56 18l-12 7M56 46l-17-7M32 60V39M8 46l17-7M8 18l12 7"/>',
  20: '<path d="M32 4 57 18v28L32 60 7 46V18z"/><path d="M32 18 47 42H17z"/><path d="M32 4v14M57 18 47 42M57 46H47M32 60 17 42 47 42M7 46h10M7 18l10 24M7 18l25 0 25 0"/>',
  100: '<path d="M20 8 36 22 20 50 4 22z"/><path d="M44 14 60 28 44 56 28 28z"/>',
};
export function diceShape(sides: number, cls = ""): Raw {
  return raw(`<svg class="dshape ${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true">${DICE_SHAPES[sides] ?? DICE_SHAPES[20]}</svg>`);
}
