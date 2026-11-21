'use strict';

/* Thèmes Jour et Nuit, repris de « L'Avenir en commun ».
   - Nuit : un ciel violet profond, étoilé, avec des halos ; le plateau
     flotte dans le vide, ses flancs violets.
   - Jour : crème et lavande, des halos clairs ; plateau crème aux flancs
     sable.
   L'interface (CSS) suit avec la classe `light` sur <body>. Le plateau
   reste clair dans les deux thèmes : les couleurs des camps, dont le bleu
   marine, y restent lisibles. */

const THEMES = Object.freeze({
  night: Object.freeze({
    key: 'night',
    metaColor: '#170830',
    space: Object.freeze({
      top: '#0f0524', middle: '#1b0b3d', bottom: '#341a63',
      halos: Object.freeze(['rgba(123, 19, 214, 0.32)', 'rgba(237, 95, 177, 0.16)', 'rgba(56, 133, 244, 0.14)']),
      stars: true, objectAlpha: 0.5, objectInk: '#FFFCF4', objectAccent: '#f9c900',
    }),
    ground: Object.freeze({ shadow: [188, 176, 214], light: [246, 242, 252], border: [123, 19, 214], borderStrength: 0.3 }),
    cliff: Object.freeze({ shade: '#1b0b3d', lit: '#7b13d6' }),
    rim: 'rgba(249, 201, 0, 0.85)',        // liseré au bord du plateau
    haze: 'rgba(27, 11, 61, 0.85)',        // brume du lointain
    fog: Object.freeze({ seen: [23, 8, 48, 0.74], unseen: [15, 5, 36, 0.93] }),   // brouillard de guerre
  }),
  day: Object.freeze({
    key: 'day',
    metaColor: '#eedfff',
    space: Object.freeze({
      top: '#FFFCF4', middle: '#eedfff', bottom: '#d6bcff',
      halos: Object.freeze(['rgba(255, 255, 255, 0.7)', 'rgba(249, 201, 0, 0.18)', 'rgba(237, 95, 177, 0.12)']),
      stars: false, objectAlpha: 0.35, objectInk: '#4C0297', objectAccent: '#D1271C',
    }),
    ground: Object.freeze({ shadow: [222, 210, 186], light: [255, 253, 246], border: [76, 2, 151], borderStrength: 0.22 }),
    cliff: Object.freeze({ shade: '#8a7aa8', lit: '#e4d9c0' }),
    rim: 'rgba(76, 2, 151, 0.55)',
    haze: 'rgba(238, 223, 255, 0.85)',
    fog: Object.freeze({ seen: [214, 188, 255, 0.72], unseen: [196, 168, 240, 0.94] }),
  }),
});

const THEME_STORAGE_KEY = 'debattle.theme';

/* Thème enregistré, sinon celui du système (clair ou sombre), sinon la nuit. */
function loadThemeKey() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'night' || saved === 'day') return saved;
  } catch (error) { /* stockage indisponible */ }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
}

/* Applique un thème à la page et le mémorise. Renvoie le thème. */
function applyTheme(key) {
  const theme = THEMES[key] || THEMES.night;
  document.body.classList.toggle('light', theme.key === 'day');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.metaColor);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.key);
  } catch (error) { /* stockage indisponible */ }
  return theme;
}
