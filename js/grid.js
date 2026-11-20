'use strict';

/* Grille fine posée sur l'arène : qui possède chaque case, et quelle traînée
   la recouvre. Les joueurs se déplacent librement ; la grille sert à mesurer
   le territoire et à décider des captures et des collisions.
   Aucune dépendance au DOM : ce fichier se teste hors navigateur. */

function createGrid(arenaSize, resolution, { outline = null, regions = [], zoneKind = null } = {}) {
  const size = arenaSize * resolution;
  const playable = new Uint8Array(size * size);
  let playableCount = 0;
  for (let index = 0; index < playable.length; index++) {
    const x = (index % size + 0.5) / resolution;
    const y = (Math.floor(index / size) + 0.5) / resolution;
    if (!outline || isInsideOutline(outline, x, y)) {
      playable[index] = 1;
      playableCount++;
    }
  }
  const regionOf = assignRegions(size, resolution, playable, regions);
  return {
    arenaSize,
    resolution,
    size,                                        // nombre de cases par côté
    regionOf,                                    // numéro de région de chaque case (1, 2, ...), 0 = aucune
    zoneKind,                                    // sorte de zone (clé de ZONE_KINDS), null sans découpage
    regions: regions.map((region, index) => ({   // nom, villes de référence et surface de chaque région
      name: region.name,
      points: region.points,
      cells: regionOf.reduce((count, id) => count + (id === index + 1 ? 1 : 0), 0),
    })),
    outline,                                     // contour de l'arène, ou null si elle est carrée
    playable,                                    // 1 = case jouable, 0 = hors de l'arène
    playableCount,                               // surface de l'arène, en cases : le 100 % des pourcentages
    owner: new Uint8Array(size * size),          // identifiant du propriétaire, 0 = libre
    trail: new Uint8Array(size * size),          // identifiant de la traînée, 0 = aucune
    trailStamp: new Float32Array(size * size),   // distance parcourue par l'auteur au moment du tracé
    counts: new Int32Array(256),                 // nombre de cases possédées par identifiant
    dirty: new Set(),                            // joueurs dont le territoire a changé depuis le dernier rendu
  };
}

/* Range chaque case jouable dans la région dont une ville est la plus proche. */
function assignRegions(size, resolution, playable, regions) {
  const regionOf = new Uint8Array(size * size);
  if (regions.length === 0) return regionOf;
  for (let index = 0; index < regionOf.length; index++) {
    if (playable[index] === 0) continue;
    const x = (index % size + 0.5) / resolution;
    const y = (Math.floor(index / size) + 0.5) / resolution;
    regionOf[index] = nearestRegion(regions, x, y);
  }
  return regionOf;
}

/* Numéro (à partir de 1) de la région dont une ville est la plus proche du point. */
function nearestRegion(regions, x, y) {
  let nearest = Infinity;
  let found = 0;
  for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
    for (const [cityX, cityY] of regions[regionIndex].points) {
      const distance = (cityX - x) * (cityX - x) + (cityY - y) * (cityY - y);
      if (distance < nearest) {
        nearest = distance;
        found = regionIndex + 1;
      }
    }
  }
  return found;
}

/* Régions qu'un camp possède à plus de `share` sans les avoir entièrement :
   il les complète. Renvoie, pour chaque région complétée, son nom et les
   cases gagnées. */
function completeRegions(grid, id, share) {
  if (grid.regions.length === 0) return [];
  const { owner, regionOf } = grid;
  const owned = new Int32Array(grid.regions.length + 1);
  for (let index = 0; index < owner.length; index++) {
    if (owner[index] === id) owned[regionOf[index]]++;
  }
  const completed = [];
  grid.regions.forEach((region, regionIndex) => {
    const count = owned[regionIndex + 1];
    if (count === region.cells || count <= region.cells * share) return;
    const cells = [];
    for (let index = 0; index < owner.length; index++) {
      if (regionOf[index] === regionIndex + 1 && owner[index] !== id) {
        setOwner(grid, index, id);
        cells.push(index);
      }
    }
    completed.push({ name: region.name, cells });
  });
  return completed;
}

/* Nombre de régions entièrement possédées par chaque camp (tableau indexé
   par identifiant de camp). */
function countCompleteRegions(grid) {
  const regionCount = grid.regions.length;
  const complete = new Int32Array(256);
  if (regionCount === 0) return complete;
  // Pour chaque région : son unique propriétaire, 0 tant qu'on n'a rien vu, -1 si elle est partagée ou incomplète.
  const holder = new Int32Array(regionCount + 1);
  const { owner, regionOf } = grid;
  for (let index = 0; index < owner.length; index++) {
    const region = regionOf[index];
    if (region === 0 || holder[region] === -1) continue;
    if (owner[index] === 0) holder[region] = -1;
    else if (holder[region] === 0) holder[region] = owner[index];
    else if (holder[region] !== owner[index]) holder[region] = -1;
  }
  for (let region = 1; region <= regionCount; region++) {
    if (holder[region] > 0) complete[holder[region]]++;
  }
  return complete;
}

/* Case située sous un point de l'arène, ou -1 hors de l'arène. */
function cellAt(grid, x, y) {
  const cellX = Math.floor(x * grid.resolution);
  const cellY = Math.floor(y * grid.resolution);
  if (cellX < 0 || cellY < 0 || cellX >= grid.size || cellY >= grid.size) return -1;
  return cellY * grid.size + cellX;
}

function isPlayableAt(grid, x, y) {
  const index = cellAt(grid, x, y);
  return index >= 0 && grid.playable[index] === 1;
}

/* Vrai si le point et ses abords, à `margin` près dans huit directions,
   sont dans l'arène. */
function hasClearance(grid, x, y, margin) {
  const diagonal = margin * 0.7;
  return isPlayableAt(grid, x, y) &&
    isPlayableAt(grid, x - margin, y) && isPlayableAt(grid, x + margin, y) &&
    isPlayableAt(grid, x, y - margin) && isPlayableAt(grid, x, y + margin) &&
    isPlayableAt(grid, x - diagonal, y - diagonal) && isPlayableAt(grid, x + diagonal, y - diagonal) &&
    isPlayableAt(grid, x - diagonal, y + diagonal) && isPlayableAt(grid, x + diagonal, y + diagonal);
}

function ownerAt(grid, x, y) {
  const index = cellAt(grid, x, y);
  return index < 0 ? 0 : grid.owner[index];
}

function setOwner(grid, index, id) {
  const previous = grid.owner[index];
  if (previous === id) return;
  grid.counts[previous]--;
  grid.counts[id]++;
  grid.owner[index] = id;
  grid.dirty.add(previous);
  grid.dirty.add(id);
}

/* Appelle `visit` pour chaque case jouable dont le centre est dans le disque. */
function forEachCellInDisc(grid, x, y, radius, visit) {
  const { size, resolution, playable } = grid;
  const centerX = x * resolution;
  const centerY = y * resolution;
  const reach = radius * resolution;
  const minX = Math.max(0, Math.floor(centerX - reach));
  const maxX = Math.min(size - 1, Math.floor(centerX + reach));
  const minY = Math.max(0, Math.floor(centerY - reach));
  const maxY = Math.min(size - 1, Math.floor(centerY + reach));
  for (let cellY = minY; cellY <= maxY; cellY++) {
    for (let cellX = minX; cellX <= maxX; cellX++) {
      const deltaX = cellX + 0.5 - centerX;
      const deltaY = cellY + 0.5 - centerY;
      const index = cellY * size + cellX;
      if (playable[index] === 1 && deltaX * deltaX + deltaY * deltaY <= reach * reach) visit(index);
    }
  }
}

/* Donne un disque de cases à un joueur. Renvoie les cases attribuées. */
function claimDisc(grid, x, y, radius, id) {
  const claimed = [];
  forEachCellInDisc(grid, x, y, radius, (index) => {
    setOwner(grid, index, id);
    claimed.push(index);
  });
  return claimed;
}

/* Capture : la traînée devient du territoire. Ce territoire, avec les bords
   de l'arène, découpe alors le reste en zones séparées : la plus grande est
   « l'extérieur », toutes les autres sont enfermées, donc conquises.
   Une boucle fermée contre un mur capture ainsi ce qu'elle entoure.
   Renvoie les cases nouvellement acquises. */
function captureEnclosed(grid, id, trailCells) {
  const { size, owner, playable } = grid;
  const total = size * size;
  const captured = [];

  for (const index of trailCells) {
    if (owner[index] !== id) {
      setOwner(grid, index, id);
      captured.push(index);
    }
  }

  // Numérote les zones de cases voisines qui n'appartiennent pas au joueur.
  const zoneOf = new Int32Array(total);   // 0 = pas encore visitée
  const zoneSizes = [0];
  const queue = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (zoneOf[start] !== 0 || owner[start] === id || playable[start] === 0) continue;
    const zone = zoneSizes.length;
    let head = 0;
    let tail = 0;
    const visit = (index) => {
      if (zoneOf[index] === 0 && owner[index] !== id && playable[index] === 1) {
        zoneOf[index] = zone;
        queue[tail++] = index;
      }
    };
    visit(start);
    while (head < tail) {
      const index = queue[head++];
      const x = index % size;
      if (x > 0) visit(index - 1);
      if (x < size - 1) visit(index + 1);
      if (index >= size) visit(index - size);
      if (index < total - size) visit(index + size);
    }
    zoneSizes.push(tail);
  }

  const outside = zoneSizes.indexOf(Math.max(...zoneSizes));
  for (let index = 0; index < total; index++) {
    if (zoneOf[index] !== 0 && zoneOf[index] !== outside) {
      setOwner(grid, index, id);
      captured.push(index);
    }
  }
  return captured;
}

/* Libère tout le territoire d'un joueur éliminé. */
function releaseTerritory(grid, id) {
  for (let index = 0; index < grid.owner.length; index++) {
    if (grid.owner[index] === id) setOwner(grid, index, 0);
  }
}

function clearTrail(grid, id, trailCells) {
  for (const index of trailCells) {
    if (grid.trail[index] === id) grid.trail[index] = 0;
  }
}

/* Un point au hasard sur le territoire d'un camp, ou null s'il n'en a plus. */
function findRandomOwnedPoint(grid, id) {
  if (grid.counts[id] === 0) return null;
  const { size, resolution, owner } = grid;
  let index = -1;
  for (let attempt = 0; attempt < 200 && index < 0; attempt++) {
    const candidate = Math.floor(Math.random() * owner.length);
    if (owner[candidate] === id) index = candidate;
  }
  if (index < 0) index = owner.indexOf(id);
  const x = index % size;
  const y = (index - x) / size;
  return { x: (x + 0.5) / resolution, y: (y + 0.5) / resolution };
}

function isDiscFree(grid, x, y, radius) {
  let free = true;
  forEachCellInDisc(grid, x, y, radius, (index) => {
    if (grid.owner[index] !== 0 || grid.trail[index] !== 0) free = false;
  });
  return free;
}

/* Cherche un emplacement libre, à distance des joueurs en vie. */
function findSpawnPoint(grid, occupiedPositions, radius, clearance) {
  const margin = radius + 6;   // jamais collé au bord de l'arène
  const span = grid.arenaSize - margin * 2;
  for (let attempt = 0; attempt < 400; attempt++) {
    const x = margin + Math.random() * span;
    const y = margin + Math.random() * span;
    const farEnough = occupiedPositions.every((p) => Math.hypot(p.x - x, p.y - y) >= clearance);
    const awayFromEdge = hasClearance(grid, x, y, radius + 3);
    if (farEnough && awayFromEdge && isDiscFree(grid, x, y, radius + 0.5)) return { x, y };
  }
  return null;
}
