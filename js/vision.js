'use strict';

/* Brouillard de guerre, en équipes. Chaque camp ne voit que :
   - autour de ses joueurs (CONFIG.vision.headRadius unités) ;
   - autour de son territoire (landRadius unités) ;
   - toute région qu'il tient (sa « tour de vision ») ;
   - ce que révèlent ses radars et ses éclaireurs (game.reveals).
   Ailleurs, il ne connaît que ce qu'il a vu la dernière fois : la
   « carte connue » (vision.known), une copie de la grille mise à jour
   seulement là où il voit.

   La visibilité se calcule sur une grille grossière, une case par unité
   d'arène, toutes les CONFIG.vision.refresh secondes. Chez un invité en
   ligne, la grille du miroir est déjà la carte connue (l'hôte n'envoie
   que ce que le camp voit) : `shareGrid` évite de la recopier.

   Aucune dépendance au DOM. */

function createVision(game, landId, { shareGrid = false } = {}) {
  const { grid } = game;
  const size = grid.arenaSize;
  const known = shareGrid ? grid : {
    ...grid,
    owner: new Uint8Array(grid.owner.length),
    counts: new Int32Array(256),
    dirty: new Set(),
    stolen: null,
  };
  return {
    landId,
    known,
    shareGrid,
    visible: new Uint8Array(size * size),   // 1 = case (d'une unité) visible
    seen: new Uint8Array(size * size),      // 1 = case déjà vue au moins une fois
    version: 0,                              // change à chaque recalcul, pour le rendu
    clock: 0,
    hidden: new Set(),                       // adversaires dont la tête est hors de vue
    trailHidden: new Set(),                  // adversaires dont la traînée est entièrement hors de vue
    towers: [],                              // régions tenues par le camp : [{ name, x, y }]
  };
}

/* Toutes les cases d'une unité dans un disque. */
function stampDisc(visible, size, x, y, radius) {
  const left = Math.max(0, Math.floor(x - radius));
  const right = Math.min(size - 1, Math.floor(x + radius));
  const top = Math.max(0, Math.floor(y - radius));
  const bottom = Math.min(size - 1, Math.floor(y + radius));
  const limit = radius * radius;
  for (let cellY = top; cellY <= bottom; cellY++) {
    const dy = cellY + 0.5 - y;
    for (let cellX = left; cellX <= right; cellX++) {
      const dx = cellX + 0.5 - x;
      if (dx * dx + dy * dy <= limit) visible[cellY * size + cellX] = 1;
    }
  }
}

/* Case fine au centre d'une case d'une unité. */
function sampleIndex(grid, cellX, cellY) {
  const middle = Math.floor(grid.resolution / 2);
  return (cellY * grid.resolution + middle) * grid.size + cellX * grid.resolution + middle;
}

/* Une position est-elle visible pour ce camp ? */
function isVisibleAt(vision, x, y) {
  const size = vision.known.arenaSize;
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  if (cellX < 0 || cellY < 0 || cellX >= size || cellY >= size) return false;
  return vision.visible[cellY * size + cellX] === 1;
}

function computeVisible(vision, game) {
  const { grid } = game;
  const { visible, landId } = vision;
  const size = grid.arenaSize;
  const settings = CONFIG.vision;
  visible.fill(0);

  // Territoire du camp, élargi ; et part de chaque région qu'il tient.
  const regionTotals = new Int32Array(grid.regions.length + 1);
  const regionOwned = new Int32Array(grid.regions.length + 1);
  const owned = [];
  for (let cellY = 0; cellY < size; cellY++) {
    for (let cellX = 0; cellX < size; cellX++) {
      const index = sampleIndex(grid, cellX, cellY);
      if (grid.playable[index] === 0) continue;
      const region = grid.regionOf[index];
      regionTotals[region]++;
      if (grid.owner[index] === landId) {
        regionOwned[region]++;
        owned.push(cellX, cellY);
      }
    }
  }
  for (let i = 0; i < owned.length; i += 2) stampDisc(visible, size, owned[i] + 0.5, owned[i + 1] + 0.5, settings.landRadius);

  // Tours de vision : chaque région tenue est entièrement visible.
  vision.towers = [];
  const towerRegions = new Set();
  for (let region = 1; region < regionTotals.length; region++) {
    if (regionTotals[region] > 0 && regionOwned[region] / regionTotals[region] >= CONFIG.regionShare) {
      towerRegions.add(region);
      const [x, y] = grid.regions[region - 1].points[0];
      vision.towers.push({ name: grid.regions[region - 1].name, x, y });
    }
  }
  if (towerRegions.size > 0) {
    for (let cellY = 0; cellY < size; cellY++) {
      for (let cellX = 0; cellX < size; cellX++) {
        if (towerRegions.has(grid.regionOf[sampleIndex(grid, cellX, cellY)])) visible[cellY * size + cellX] = 1;
      }
    }
  }

  for (const entity of game.entities) {
    if (entity.alive && entity.landId === landId) stampDisc(visible, size, entity.x, entity.y, settings.headRadius);
  }
  for (const reveal of game.reveals || []) {
    if (reveal.landId === landId) stampDisc(visible, size, reveal.x, reveal.y, revealRadius(reveal));
  }
}

/* Recopie dans la carte connue ce que le camp voit. */
function refreshKnown(vision, game) {
  if (vision.shareGrid) return;
  const { grid } = game;
  const { known, visible } = vision;
  const size = grid.arenaSize;
  const { resolution } = grid;
  for (let cellY = 0; cellY < size; cellY++) {
    for (let cellX = 0; cellX < size; cellX++) {
      if (visible[cellY * size + cellX] === 0) continue;
      for (let fineY = 0; fineY < resolution; fineY++) {
        let index = (cellY * resolution + fineY) * grid.size + cellX * resolution;
        for (let fineX = 0; fineX < resolution; fineX++, index++) {
          if (known.owner[index] !== grid.owner[index]) setOwner(known, index, grid.owner[index]);
        }
      }
    }
  }
}

/* Qui, chez l'adversaire, est hors de vue : la tête, et toute la traînée. */
function refreshHidden(vision, game) {
  vision.hidden.clear();
  vision.trailHidden.clear();
  for (const entity of game.entities) {
    if (entity.landId === vision.landId) continue;
    const headSeen = entity.alive && isVisibleAt(vision, entity.x, entity.y);
    if (!headSeen) vision.hidden.add(entity.id);
    let trailSeen = headSeen;
    const points = entity.trailPoints;
    for (let i = 0; !trailSeen && i < points.length; i += 3) trailSeen = isVisibleAt(vision, points[i].x, points[i].y);
    if (!trailSeen) vision.trailHidden.add(entity.id);
  }
}

/* À chaque image ; ne recalcule que toutes les CONFIG.vision.refresh secondes. */
function updateVision(vision, game, dt, force = false) {
  vision.clock -= dt;
  if (vision.clock > 0 && !force) return false;
  vision.clock = CONFIG.vision.refresh;
  computeVisible(vision, game);
  for (let cell = 0; cell < vision.visible.length; cell++) vision.seen[cell] |= vision.visible[cell];
  refreshKnown(vision, game);
  // Chez un invité, l'hôte dit lui-même qui est caché (entity.hidden).
  if (!vision.shareGrid) refreshHidden(vision, game);
  vision.version++;
  return true;
}

/* --- Compétences de vision -------------------------------------------- */

/* Rayon actuel d'une révélation : le radar s'étend comme une onde. */
function revealRadius(reveal) {
  if (reveal.kind === 'radar') return reveal.radius * Math.min(1, reveal.age / CONFIG.vision.radar.sweep);
  return reveal.radius;
}

function visionCooldown(entity, kind) {
  return (entity.visionCooldowns && entity.visionCooldowns[kind]) || 0;
}

function startCooldown(entity, kind) {
  if (!entity.visionCooldowns) entity.visionCooldowns = { radar: 0, scout: 0 };
  entity.visionCooldowns[kind] = CONFIG.vision[kind].cooldown;
}

/* Radar : une onde part du joueur et révèle tout autour, un moment. */
function useRadar(game, entity) {
  if (!entity.alive || visionCooldown(entity, 'radar') > 0 || !hasFog(game)) return false;
  startCooldown(entity, 'radar');
  const { radius, duration } = CONFIG.vision.radar;
  game.reveals.push({ kind: 'radar', landId: entity.landId, entity, x: entity.x, y: entity.y, radius, age: 0, duration });
  game.events.push({ type: 'reveal', kind: 'radar', entity });
  return true;
}

/* Éclaireur : un drone file droit devant, puis plane sur place en
   révélant ce qui l'entoure. */
function useScout(game, entity) {
  if (!entity.alive || visionCooldown(entity, 'scout') > 0 || !hasFog(game)) return false;
  startCooldown(entity, 'scout');
  const { radius, speed, duration } = CONFIG.vision.scout;
  game.reveals.push({
    kind: 'scout', landId: entity.landId, entity, x: entity.x, y: entity.y, radius, age: 0, duration,
    vx: Math.cos(entity.angle) * speed, vy: Math.sin(entity.angle) * speed,
  });
  game.events.push({ type: 'reveal', kind: 'scout', entity });
  return true;
}

function tickReveals(game, dt) {
  for (const entity of game.entities) {
    if (!entity.visionCooldowns) continue;
    for (const kind of ['radar', 'scout']) entity.visionCooldowns[kind] = Math.max(0, entity.visionCooldowns[kind] - dt);
  }
  if (!game.reveals || game.reveals.length === 0) return;
  const limit = game.grid.arenaSize - 1;
  for (const reveal of game.reveals) {
    reveal.age += dt;
    if (reveal.kind === 'scout' && reveal.age <= CONFIG.vision.scout.flight) {
      const x = Math.max(1, Math.min(limit, reveal.x + reveal.vx * dt));
      const y = Math.max(1, Math.min(limit, reveal.y + reveal.vy * dt));
      // Le drone reste au-dessus du plateau : arrivé au bord, il s'arrête là.
      if (isPlayableAt(game.grid, x, y)) {
        reveal.x = x;
        reveal.y = y;
      }
    }
  }
  game.reveals = game.reveals.filter((reveal) => reveal.age < reveal.duration);
}

/* Le brouillard ne concerne que les parties en équipes (pas le duel). */
function hasFog(game) {
  return isTeamMode(game);
}
