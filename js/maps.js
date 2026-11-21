'use strict';

/* Formes d'arène. Une forme est un contour fermé [x0, y0, x1, y1, ...] en
   unités d'arène ; tout ce qui est hors du contour est infranchissable.
   Aucune dépendance au DOM. */

/* Contour simplifié de la France métropolitaine (sans la Corse), en
   longitude / latitude, dans le sens des aiguilles d'une montre depuis
   Dunkerque. C'est un tracé à la main, pas un relevé cartographique. */
const FRANCE_COAST = Object.freeze([
  [2.4, 51.05], [3.2, 50.75], [4.2, 50.0], [4.8, 50.15], [5.8, 49.5], [6.4, 49.45],
  [8.2, 48.97], [7.8, 48.5], [7.55, 47.55], [6.9, 47.4], [6.1, 46.4], [6.8, 46.4],
  [7.0, 45.9], [7.0, 45.2], [6.9, 44.4], [7.7, 44.1], [7.5, 43.78], [7.2, 43.65],
  [6.7, 43.2], [5.9, 43.05], [5.3, 43.25], [4.6, 43.35], [3.7, 43.4], [3.1, 43.05],
  [3.15, 42.43], [2.0, 42.35], [0.7, 42.7], [-0.5, 42.8], [-1.3, 43.05], [-1.78, 43.37],
  [-1.55, 43.5], [-1.3, 44.6], [-1.15, 45.5], [-1.05, 45.6], [-1.2, 46.15], [-1.8, 46.5],
  [-2.2, 47.25], [-2.9, 47.55], [-3.4, 47.7], [-4.75, 48.03], [-4.78, 48.4], [-4.0, 48.7],
  [-3.0, 48.85], [-2.0, 48.65], [-1.5, 48.63], [-1.6, 49.2], [-1.85, 49.7], [-1.6, 49.68],
  [-1.25, 49.7], [-1.1, 49.35], [-0.3, 49.3], [0.1, 49.5], [1.1, 49.93], [1.55, 50.2],
  [1.6, 50.75], [1.85, 50.95],
]);

/* Régions métropolitaines (sans la Corse, absente de la carte). Chaque
   région est décrite par quelques villes : une case appartient à la région
   de la ville la plus proche. Les limites obtenues sont donc approchées. */
const FRANCE_REGIONS = Object.freeze([
  { name: 'Hauts-de-France', cities: [[3.06, 50.63], [2.3, 49.9], [3.62, 49.56], [2.08, 49.43], [1.85, 50.95]] },
  { name: 'Normandie', cities: [[1.1, 49.44], [-0.37, 49.18], [-1.62, 49.64], [0.09, 48.43], [1.15, 49.02], [-1.09, 49.12]] },
  { name: 'Île-de-France', cities: [[2.35, 48.86], [2.66, 48.54], [2.13, 48.8], [2.1, 49.05], [2.88, 48.96]] },
  {
    name: 'Grand Est',
    cities: [[7.75, 48.58], [6.18, 49.12], [6.18, 48.69], [4.03, 49.26], [4.07, 48.3], [4.72, 49.77], [7.36, 48.08],
      [5.14, 48.11], [6.45, 48.17], [4.36, 48.96], [5.16, 48.77]],
  },
  { name: 'Bretagne', cities: [[-1.68, 48.11], [-4.49, 48.39], [-4.1, 48.0], [-2.76, 47.66], [-2.76, 48.51]] },
  { name: 'Pays de la Loire', cities: [[-1.55, 47.22], [-0.55, 47.47], [0.2, 48.0], [-0.77, 48.07], [-1.43, 46.67]] },
  { name: 'Centre-Val de Loire', cities: [[1.9, 47.9], [0.69, 47.39], [2.4, 47.08], [1.49, 48.45], [1.33, 47.59], [1.69, 46.81]] },
  {
    name: 'Bourgogne-Franche-Comté',
    cities: [[5.04, 47.32], [6.02, 47.24], [3.57, 47.8], [3.16, 46.99], [4.83, 46.31], [6.86, 47.64], [5.55, 46.67], [6.15, 47.62]],
  },
  {
    name: 'Nouvelle-Aquitaine',
    cities: [[-0.58, 44.84], [0.34, 46.58], [1.26, 45.83], [-0.37, 43.3], [-1.15, 46.16], [0.72, 45.18], [0.62, 44.2],
      [-0.5, 43.89], [0.16, 45.65], [-0.46, 46.32], [1.87, 46.17], [1.77, 45.27], [-1.47, 43.49]],
  },
  {
    name: 'Auvergne-Rhône-Alpes',
    cities: [[4.83, 45.76], [3.08, 45.78], [5.72, 45.19], [4.39, 45.44], [6.13, 45.9], [5.92, 45.57], [4.89, 44.93],
      [2.44, 44.93], [3.88, 45.04], [3.33, 46.57], [5.23, 46.2], [4.6, 44.74]],
  },
  {
    name: 'Occitanie',
    cities: [[1.44, 43.6], [3.88, 43.61], [2.9, 42.7], [4.36, 43.84], [2.57, 44.35], [2.15, 43.93], [0.07, 43.23],
      [1.44, 44.45], [3.5, 44.52], [2.35, 43.21], [0.59, 43.65], [1.6, 42.97], [1.35, 44.02]],
  },
  { name: 'Provence-Alpes-Côte d\'Azur', cities: [[5.37, 43.3], [7.26, 43.7], [5.93, 43.12], [4.81, 43.95], [6.08, 44.56], [6.24, 44.09]] },
]);

/* Place un point (longitude, latitude) dans l'arène en gardant les
   proportions du pays : à cette latitude, un degré de longitude vaut
   environ 0,69 degré de latitude. */
function franceToArena(longitude, latitude, arenaSize) {
  const LONGITUDE_RATIO = 0.688;
  const WEST = -4.8;
  const EAST = 8.2;
  const NORTH = 51.05;
  const margin = 2;
  const scale = (arenaSize - margin * 2) / ((EAST - WEST) * LONGITUDE_RATIO);
  return [margin + (longitude - WEST) * LONGITUDE_RATIO * scale, margin + 0.75 + (NORTH - latitude) * scale];
}

function buildFranceOutline(arenaSize) {
  const outline = [];
  for (const [longitude, latitude] of FRANCE_COAST) outline.push(...franceToArena(longitude, latitude, arenaSize));
  return outline;
}

/* Les villes de chaque région, placées dans l'arène. */
function buildFranceRegions(arenaSize) {
  return FRANCE_REGIONS.map((region) => ({
    name: region.name,
    points: region.cities.map(([longitude, latitude]) => franceToArena(longitude, latitude, arenaSize)),
  }));
}

/* Arène ronde : un disque inscrit dans le carré. */
function buildRoundOutline(arenaSize) {
  const SIDES = 96;
  const radius = arenaSize / 2 - 1;
  const outline = [];
  for (let side = 0; side < SIDES; side++) {
    const angle = (side / SIDES) * Math.PI * 2;
    outline.push(arenaSize / 2 + Math.cos(angle) * radius, arenaSize / 2 + Math.sin(angle) * radius);
  }
  return outline;
}

/* Petit générateur pseudo-aléatoire à graine (mulberry32) : un même
   découpage pour une même arène, d'une partie à l'autre. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/* Découpage d'une arène ronde en zones : une au centre, les autres en parts
   de tarte. Chaque part est décrite par trois points le long d'un rayon,
   légèrement décalés : une case appartient à la zone du point le plus
   proche, ce qui donne des limites qui ondulent, comme de vraies limites
   communales. Le tirage ne dépend que de la taille et du type de zone. */
function buildRoundZones(arenaSize, kind) {
  const { count, names } = ZONE_KINDS[kind];
  const random = seededRandom(arenaSize * 131 + count * 7);
  const center = arenaSize / 2;
  const radius = arenaSize / 2 - 1;
  const at = (distance, angle) => [center + Math.cos(angle) * distance * radius, center + Math.sin(angle) * distance * radius];

  const zones = [[at(0, 0), at(0.12, random() * Math.PI * 2)]];
  const slices = count - 1;
  const slice = (Math.PI * 2) / slices;
  const turn = random() * slice;
  for (let index = 0; index < slices; index++) {
    const angle = turn + index * slice;
    zones.push([0.58, 0.78, 0.96].map((distance) => at(distance, angle + (random() - 0.5) * slice * 0.4)));
  }
  const pool = [...names];
  return zones.map((points) => ({ name: pool.splice(Math.floor(random() * pool.length), 1)[0], points }));
}

/* Cercle de `radius` autour de (centerX, centerY), en `sides` segments. */
function buildCircle(centerX, centerY, radius, sides = 64, wobble = null) {
  const loop = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    const distance = radius * (wobble ? 1 + wobble(angle) : 1);
    loop.push(centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance);
  }
  return loop;
}

/* Anneau : un disque percé d'un trou au centre, qu'il faut contourner. */
function buildRingOutlines(arenaSize) {
  const center = arenaSize / 2;
  return [buildCircle(center, center, arenaSize / 2 - 1, 96), buildCircle(center, center, arenaSize * 0.17, 48)];
}

/* Archipel : une grande île centrale et quatre îles plus petites, aux
   bords qui ondulent, reliées à l'île centrale par des ponts. Ce n'est
   qu'un contour : toutes les boucles se combinent en pair-impair, et les
   ponts recouvrent l'eau entre deux îles. */
function buildArchipelOutlines(arenaSize) {
  const center = arenaSize / 2;
  const random = seededRandom(arenaSize * 977);
  const islands = [{ x: center, y: center, radius: arenaSize * 0.2 }];
  const turn = random() * Math.PI * 2;
  for (let index = 0; index < 4; index++) {
    const angle = turn + index * Math.PI / 2;
    islands.push({ x: center + Math.cos(angle) * arenaSize * 0.33, y: center + Math.sin(angle) * arenaSize * 0.33, radius: arenaSize * 0.14 });
  }
  const loops = islands.map((island) => {
    const phase = random() * Math.PI * 2;
    return buildCircle(island.x, island.y, island.radius, 56, (angle) => 0.08 * Math.sin(angle * 3 + phase) + 0.04 * Math.sin(angle * 5 - phase));
  });
  // Les ponts : des rubans de 4 unités de large, de l'île centrale à chaque autre île.
  const half = 2;
  for (const island of islands.slice(1)) {
    const dx = island.x - center;
    const dy = island.y - center;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const from = islands[0].radius * 0.8;
    const to = length - island.radius * 0.8;
    loops.push([
      center + ux * from - uy * half, center + uy * from + ux * half,
      center + ux * to - uy * half, center + uy * to + ux * half,
      center + ux * to + uy * half, center + uy * to - ux * half,
      center + ux * from + uy * half, center + uy * from - ux * half,
    ]);
  }
  return { loops: loops.map(orientLoop), union: true };
}

/* Même sens de parcours pour toutes les boucles d'une union : remplies
   ensemble (règle non nulle), elles s'additionnent sans trou. */
function orientLoop(loop) {
  let area = 0;
  const count = loop.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) area += (loop[j * 2] - loop[i * 2]) * (loop[j * 2 + 1] + loop[i * 2 + 1]);
  if (area >= 0) return loop;
  const reversed = [];
  for (let i = count - 1; i >= 0; i--) reversed.push(loop[i * 2], loop[i * 2 + 1]);
  return reversed;
}

/* Découpage d'une arène quelconque en `count` zones : des germes tirés au
   sort dans la partie jouable, assez éloignés les uns des autres ; une
   case appartient à la zone du germe le plus proche. */
function buildSeededZones(arenaSize, kind, isInside) {
  const { count, names } = ZONE_KINDS[kind];
  const random = seededRandom(arenaSize * 313 + count * 11);
  const seeds = [];
  let spacing = arenaSize * 0.3;
  for (let tries = 0; seeds.length < count && tries < 4000; tries++) {
    if (tries % 400 === 399) spacing *= 0.85;
    const x = 2 + random() * (arenaSize - 4);
    const y = 2 + random() * (arenaSize - 4);
    if (!isInside(x, y) || seeds.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < spacing)) continue;
    seeds.push([x, y]);
  }
  const pool = [...names];
  return seeds.map((point) => ({ name: pool.splice(Math.floor(random() * pool.length), 1)[0], points: [point] }));
}

/* Formes disponibles : chacune reçoit la taille de l'arène et sa
   description (CONFIG.arenas, CAMPAIGN.levels, CONFIG.maps).
   `outlines` : boucles du contour, combinées en pair-impair (un trou est
   une boucle dans une autre) ; `union` : les boucles s'additionnent (îles
   et ponts) ; null : toute l'arène carrée est jouable. `regions` vide :
   pas de découpage ; `zoneKind` : clé de ZONE_KINDS. `zones: false`
   retire le découpage d'une carte qui en a un (la France, en règles Normal). */
const ARENA_SHAPES = Object.freeze({
  round: (arenaSize, arena = {}) => ({
    outlines: [buildRoundOutline(arenaSize)],
    regions: arena.zones ? buildRoundZones(arenaSize, arena.zones) : [],
    zoneKind: arena.zones || null,
  }),
  france: (arenaSize, arena = {}) => (arena.zones === false
    ? { outlines: [buildFranceOutline(arenaSize)], regions: [], zoneKind: null }
    : { outlines: [buildFranceOutline(arenaSize)], regions: buildFranceRegions(arenaSize), zoneKind: 'region' }),
  square: (arenaSize, arena = {}) => ({
    outlines: null,
    regions: arena.zones ? buildSeededZones(arenaSize, arena.zones, () => true) : [],
    zoneKind: arena.zones || null,
  }),
  ring: (arenaSize, arena = {}) => {
    const outlines = buildRingOutlines(arenaSize);
    return {
      outlines,
      regions: arena.zones ? buildSeededZones(arenaSize, arena.zones, (x, y) => isInsideOutlines(outlines, x, y)) : [],
      zoneKind: arena.zones || null,
    };
  },
  archipel: (arenaSize, arena = {}) => {
    const { loops } = buildArchipelOutlines(arenaSize);
    const shape = { outlines: loops, union: true };
    return {
      ...shape,
      regions: arena.zones ? buildSeededZones(arenaSize, arena.zones, (x, y) => isInsideShape(shape, x, y)) : [],
      zoneKind: arena.zones || null,
    };
  },
});

/* Point dans l'arène : pair-impair sur toutes les boucles, ou dans l'une
   d'elles au moins (`union`). */
function isInsideOutlines(outlines, x, y) {
  let inside = false;
  for (const outline of outlines) if (isInsideOutline(outline, x, y)) inside = !inside;
  return inside;
}

function isInsideShape({ outlines, union = false }, x, y) {
  if (!outlines) return true;
  return union ? outlines.some((outline) => isInsideOutline(outline, x, y)) : isInsideOutlines(outlines, x, y);
}

function isInsideOutline(outline, x, y) {
  let inside = false;
  const count = outline.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = outline[i * 2];
    const yi = outline[i * 2 + 1];
    const xj = outline[j * 2];
    const yj = outline[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
