'use strict';

/* Contour lisse d'un territoire.
   La grille est en cases ; à l'écran on veut des formes aux bords arrondis.
   On adoucit donc la carte "case possédée ou non" (moyenne sur 5 x 5), on en
   extrait la ligne de niveau à mi-hauteur (marching squares), on lisse cette
   ligne et on en arrondit les angles. Le résultat est une liste de boucles
   fermées, en unités d'arène, recalculée seulement quand le territoire change.
   Le rendu les projette ensuite en perspective. */

/* Pour chaque configuration des quatre coins d'un carré (haut-gauche = 8,
   haut-droit = 4, bas-droit = 2, bas-gauche = 1), les côtés reliés par le
   contour. Côtés : 0 = haut, 1 = droite, 2 = bas, 3 = gauche. */
const CONTOUR_SEGMENTS = Object.freeze([
  [], [[3, 2]], [[2, 1]], [[3, 1]],
  [[0, 1]], [[0, 1], [3, 2]], [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], [[0, 3], [2, 1]], [[0, 1]],
  [[3, 1]], [[2, 1]], [[3, 2]], [],
]);

const CONTOUR_LEVEL = 12.5;      // sur 25 : la moitié du voisinage 5 x 5
const CONTOUR_PADDING = 3;
const CONTOUR_SMOOTHING_PASSES = 2;

/* Rectangle englobant de chaque joueur demandé, en un seul passage. */
function findTerritoryBounds(grid, ids) {
  const bounds = new Map();
  for (const id of ids) bounds.set(id, { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 });
  const { size, owner } = grid;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const box = bounds.get(owner[y * size + x]);
      if (!box) continue;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return bounds;
}

/* Carte adoucie : pour chaque case de la zone, nombre de cases possédées
   dans son voisinage 5 x 5 (de 0 à 25), calculé en deux passes. */
function buildSoftField(grid, id, box) {
  const { size, owner } = grid;
  const originX = box.minX - CONTOUR_PADDING;
  const originY = box.minY - CONTOUR_PADDING;
  const width = box.maxX - box.minX + 1 + CONTOUR_PADDING * 2;
  const height = box.maxY - box.minY + 1 + CONTOUR_PADDING * 2;

  const owned = new Uint8Array(width * height);
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      if (owner[y * size + x] === id) owned[(y - originY) * width + (x - originX)] = 1;
    }
  }

  const rowSums = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      rowSums[i] = owned[i - 2] + owned[i - 1] + owned[i] + owned[i + 1] + owned[i + 2];
    }
  }
  const values = new Uint8Array(width * height);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      values[i] = rowSums[i - width * 2] + rowSums[i - width] + rowSums[i] + rowSums[i + width] + rowSums[i + width * 2];
    }
  }
  return { values, width, height, originX, originY };
}

/* Parcourt la carte et relie entre eux les points où le contour traverse
   les arêtes du quadrillage. Chaque point a exactement deux voisins. */
function linkContourPoints(field) {
  const { values, width, height } = field;
  const points = new Map();   // arête -> [x, y] en cases locales
  const links = new Map();    // arête -> arêtes voisines le long du contour

  const crossing = (a, b) => (CONTOUR_LEVEL - a) / (b - a);
  const link = (from, to) => {
    if (!links.has(from)) links.set(from, []);
    links.get(from).push(to);
  };

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      const topLeft = values[i];
      const topRight = values[i + 1];
      const bottomLeft = values[i + width];
      const bottomRight = values[i + width + 1];
      const shape =
        (topLeft > CONTOUR_LEVEL ? 8 : 0) | (topRight > CONTOUR_LEVEL ? 4 : 0) |
        (bottomRight > CONTOUR_LEVEL ? 2 : 0) | (bottomLeft > CONTOUR_LEVEL ? 1 : 0);
      if (shape === 0 || shape === 15) continue;

      // Identifiant unique de chaque arête : horizontales paires, verticales impaires.
      const sideKeys = [i * 2, (i + 1) * 2 + 1, (i + width) * 2, i * 2 + 1];
      for (const [from, to] of CONTOUR_SEGMENTS[shape]) {
        for (const side of [from, to]) {
          const key = sideKeys[side];
          if (points.has(key)) continue;
          if (side === 0) points.set(key, [x + crossing(topLeft, topRight), y]);
          else if (side === 1) points.set(key, [x + 1, y + crossing(topRight, bottomRight)]);
          else if (side === 2) points.set(key, [x + crossing(bottomLeft, bottomRight), y + 1]);
          else points.set(key, [x, y + crossing(topLeft, bottomLeft)]);
        }
        link(sideKeys[from], sideKeys[to]);
        link(sideKeys[to], sideKeys[from]);
      }
    }
  }
  return { points, links };
}

/* Lisse une boucle fermée [x0, y0, x1, y1, ...] : chaque point se rapproche
   de la moyenne de ses deux voisins. */
function smoothLoop(loop) {
  const length = loop.length;
  let current = loop;
  for (let pass = 0; pass < CONTOUR_SMOOTHING_PASSES; pass++) {
    const next = new Array(length);
    for (let k = 0; k < length; k++) {
      next[k] = (current[(k - 2 + length) % length] + current[k] * 2 + current[(k + 2) % length]) / 4;
    }
    current = next;
  }
  return current;
}

/* Arrondit les angles d'une boucle fermée : chaque segment est remplacé par
   ses points au quart et aux trois quarts (algorithme de Chaikin). */
function roundLoopCorners(loop) {
  const length = loop.length;
  const rounded = new Float32Array(length * 2);
  for (let k = 0; k < length; k += 2) {
    const nextX = loop[(k + 2) % length];
    const nextY = loop[(k + 3) % length];
    rounded[k * 2] = loop[k] * 0.75 + nextX * 0.25;
    rounded[k * 2 + 1] = loop[k + 1] * 0.75 + nextY * 0.25;
    rounded[k * 2 + 2] = loop[k] * 0.25 + nextX * 0.75;
    rounded[k * 2 + 3] = loop[k + 1] * 0.25 + nextY * 0.75;
  }
  return rounded;
}

/* Suit chaque boucle de points du contour. Renvoie une liste de boucles
   [x0, y0, x1, y1, ...] en unités d'arène. */
function traceLoops(points, links, toArenaX, toArenaY) {
  const loops = [];
  const visited = new Set();
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const rawLoop = [];
    let previous = -1;
    let current = start;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const [x, y] = points.get(current);
      rawLoop.push(toArenaX(x), toArenaY(y));
      const [first, second] = links.get(current);
      const next = first !== previous ? first : second;
      previous = current;
      current = next;
    }
    if (rawLoop.length >= 6) loops.push(roundLoopCorners(smoothLoop(rawLoop)));
  }
  return loops;
}

/* Contour du territoire d'un camp : boucles extérieures et trous, à remplir
   avec la règle "evenodd". */
function buildTerritoryLoops(grid, id, box) {
  const field = buildSoftField(grid, id, box);
  const { points, links } = linkContourPoints(field);
  const scale = 1 / grid.resolution;
  return traceLoops(points, links,
    (x) => (field.originX + x + 0.5) * scale,
    (y) => (field.originY + y + 0.5) * scale);
}
