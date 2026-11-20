'use strict';

/* Compétences. Chaque élimination rapporte une charge (10 au plus), que l'on
   dépense à sa guise :
   - Boost   (1 charge)   : pointe de vitesse de quelques secondes, cumulable ;
   - Dash    (3 charges)  : projection explosive dans la direction visée,
                            d'autant plus longue et rapide que l'on a éliminé
                            d'adversaires ;
   - Bombe   (10 charges) : lancée loin devant, elle éclabousse une large zone
                            qui devient du territoire et élimine les adversaires
                            touchés, eux ou leur traînée.
   Aucune dépendance au DOM. */

function grantKill(killer) {
  killer.kills++;
  killer.charges = Math.min(CONFIG.abilities.maxCharges, killer.charges + 1);
}

function spendCharges(entity, cost) {
  if (!entity.alive || entity.charges < cost) return false;
  entity.charges -= cost;
  return true;
}

/* --- Boost ----------------------------------------------------------- */

function useBoost(game, entity) {
  if (!spendCharges(entity, CONFIG.abilities.boost.cost)) return false;
  entity.boostTime += CONFIG.abilities.boost.duration;
  return true;
}

/* --- Dash ------------------------------------------------------------ */

/* Puissance du dash : plus on a éliminé d'adversaires, plus il part vite et
   loin. `distance` : longueur parcourue, montrée par la flèche de visée. */
function dashProfile(game, entity) {
  const { baseSpeedFactor, speedPerKill, baseDuration, durationPerKill, maxKills } = CONFIG.abilities.dash;
  const kills = Math.min(maxKills, entity.kills);
  const speedFactor = baseSpeedFactor + speedPerKill * kills;
  const duration = baseDuration + durationPerKill * kills;
  return { speedFactor, duration, distance: cruiseSpeed(game, entity) * speedFactor * duration, power: kills / maxKills };
}

function isDashing(entity) {
  return entity.dashTime > 0;
}

/* Projette la tête dans la direction `angle` (cap en radians), même à
   l'arrêt. En plein dash, elle traverse les autres têtes ; elle laisse
   une traînée et coupe celles qu'elle croise, comme en temps normal. */
function useDash(game, entity, angle) {
  if (!entity.alive) return false;
  const profile = dashProfile(game, entity);
  if (!spendCharges(entity, CONFIG.abilities.dash.cost)) return false;
  entity.angle = angle;
  entity.targetAngle = angle;
  entity.halted = false;
  entity.dashTime = profile.duration;
  entity.dashSpeedFactor = profile.speedFactor;
  game.events.push({ type: 'dash', entity, angle, power: profile.power });
  return true;
}

function tickAbilities(entity, dt) {
  entity.boostTime = Math.max(0, entity.boostTime - dt);
  entity.dashTime = Math.max(0, entity.dashTime - dt);
}

/* --- Bombe ----------------------------------------------------------- */

function useBomb(game, entity) {
  const { cost, range, flightTime } = CONFIG.abilities.bomb;
  if (!spendCharges(entity, cost)) return false;
  const heading = entity.targetAngle !== null ? entity.targetAngle : entity.angle;
  // La bombe retombe toujours dans l'arène : au besoin, elle est lancée moins loin.
  let reach = range;
  while (reach > 0 && !isPlayableAt(game.grid, entity.x + Math.cos(heading) * reach, entity.y + Math.sin(heading) * reach)) {
    reach -= 0.5;
  }
  game.projectiles.push({
    entity,
    fromX: entity.x,
    fromY: entity.y,
    toX: entity.x + Math.cos(heading) * Math.max(0, reach),
    toY: entity.y + Math.sin(heading) * Math.max(0, reach),
    age: 0,
    duration: flightTime,
  });
  return true;
}

function updateProjectiles(game, dt) {
  for (const projectile of game.projectiles) {
    projectile.age += dt;
    if (projectile.age >= projectile.duration) splash(game, projectile);
  }
  game.projectiles = game.projectiles.filter((projectile) => projectile.age < projectile.duration);
}

/* Forme d'éclaboussure, différente à chaque fois : une flaque centrale,
   des coulées autour, et quelques gouttes projetées plus loin. */
function buildSplashCells(grid, x, y) {
  const { coreRadius, lobes, drops } = CONFIG.abilities.bomb;
  const cells = new Set();
  const addDisc = (centerX, centerY, radius) =>
    forEachCellInDisc(grid, centerX, centerY, radius, (index) => cells.add(index));
  const addRing = (count, minDistance, maxDistance, minRadius, maxRadius) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = minDistance + Math.random() * (maxDistance - minDistance);
      addDisc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance,
        minRadius + Math.random() * (maxRadius - minRadius));
    }
  };

  addDisc(x, y, coreRadius);
  addRing(lobes, coreRadius * 0.7, coreRadius * 1.3, coreRadius * 0.3, coreRadius * 0.6);
  addRing(drops, coreRadius * 1.6, coreRadius * 2.1, 0.45, 0.9);
  return cells;
}

/* À l'impact : élimine les adversaires dont la tête ou la traînée est
   touchée, puis la zone éclaboussée devient du territoire du lanceur.
   Si le lanceur a été éliminé entre-temps, la bombe ne fait rien. */
function splash(game, projectile) {
  const thrower = projectile.entity;
  if (!thrower.alive) return;
  const grid = game.grid;
  const cells = buildSplashCells(grid, projectile.toX, projectile.toY);

  for (const index of cells) {
    const trailId = grid.trail[index];
    if (trailId === 0) continue;
    const trailOwner = game.entities[trailId - 1];
    if (!areAllies(trailOwner, thrower) && !hasSafeTrail(game, trailOwner)) killEntity(game, trailOwner, thrower, 'splash');
  }
  for (const other of game.entities) {
    if (other.alive && !areAllies(other, thrower) && cells.has(cellAt(grid, other.x, other.y))) {
      killEntity(game, other, thrower, 'splash');
    }
  }

  const gained = [];
  for (const index of cells) {
    if (grid.owner[index] !== thrower.landId) {
      setOwner(grid, index, thrower.landId);
      gained.push(index);
    }
  }
  game.events.push({ type: 'splash', x: projectile.toX, y: projectile.toY, entity: thrower });
  game.events.push({ type: 'capture', landId: thrower.landId, entity: thrower, cells: gained });
  settleCapture(game, thrower, 0);
}
