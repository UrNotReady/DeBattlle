'use strict';

/* IA des adversaires : volontairement simple.
   Chez lui, le bot flâne puis sort. Dehors, il trace deux segments reliés
   par un virage, puis vise le point le plus proche de son territoire.
   Il rentre plus tôt s'il se sent menacé, coupe une traînée adverse qui
   passe devant lui, et s'écarte du bord et de sa propre traînée. */

const AI = Object.freeze({
  wanderPause: Object.freeze([0.6, 1.6]),   // secondes entre deux changements de cap, chez lui
  homeMaxTime: 2.5,                         // au-delà, il file tout droit pour sortir
  legTime: Object.freeze([0.45, 1.0]),      // durée d'un segment d'expédition
  threatRadius: 5,                          // distance d'un rival qui déclenche le repli
  maxTrailLength: 30,
  homeScanPause: 0.2,                       // secondes entre deux recherches du chemin du retour
  lookAheadStep: 0.08,                      // l'IA simule sa trajectoire par pas de 0,08 s...
  lookAheadSteps: 7,                        // ...sur 7 pas, soit environ 4,5 unités
  wallMargin: 1,
  avoidOffsets: Object.freeze([0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2, Math.PI]),
  sightStep: 0.4,                           // pas d'échantillonnage d'une ligne de vue
  cutOffsets: Object.freeze([0, 0.5, -0.5]),
  cutDistances: Object.freeze([1, 2, 3]),
});

function createBotMind(heading) {
  return { mode: 'home', heading, speed: CONFIG.speed, timer: 0, homeTime: 0, leg: 0, side: 1, scanTimer: 0, homePoint: null };
}

function randomBetween([min, max]) {
  return min + Math.random() * (max - min);
}

/* Renvoie le cap que le bot veut suivre pour cette mise à jour. */
function chooseBotHeading(game, bot, dt) {
  const mind = bot.mind;
  mind.timer -= dt;
  mind.speed = getSpeed(game, bot);
  if (isHome(game, bot)) wanderAtHome(bot, dt);
  else runExpedition(game, bot, dt);

  const safeHeading = avoidDanger(game.grid, bot, mind.heading);
  if (mind.mode !== 'back') mind.heading = safeHeading;
  return safeHeading;
}

function wanderAtHome(bot, dt) {
  const mind = bot.mind;
  if (mind.mode !== 'home') {
    mind.mode = 'home';
    mind.homeTime = 0;
    mind.timer = randomBetween(AI.wanderPause);
  }
  mind.homeTime += dt;
  if (mind.timer <= 0 && mind.homeTime < AI.homeMaxTime) {
    mind.heading = bot.angle + (Math.random() * 2 - 1) * 1.2;
    mind.timer = randomBetween(AI.wanderPause);
  }
}

function runExpedition(game, bot, dt) {
  const mind = bot.mind;
  if (mind.mode === 'home') {
    mind.mode = 'out';
    mind.leg = 0;
    mind.side = Math.random() < 0.5 ? 1 : -1;
    mind.timer = randomBetween(AI.legTime);
    mind.scanTimer = 0;
  }

  if (mind.mode === 'out') {
    if (getTrailLength(bot) > AI.maxTrailLength || isThreatened(game, bot)) {
      mind.mode = 'back';
    } else if (mind.timer <= 0) {
      mind.leg++;
      if (mind.leg >= 2) {
        mind.mode = 'back';
      } else {
        const turn = mind.side * Math.PI / 2;
        mind.heading += isPathClear(game.grid, bot, mind.heading + turn) ? turn : -turn;
        mind.timer = randomBetween(AI.legTime);
      }
    }
  }

  const cutAngle = findCutAngle(game, bot);
  if (cutAngle !== null) {
    mind.heading = cutAngle;
  } else if (mind.mode === 'back') {
    steerHome(game.grid, bot, dt);
  }
}

function steerHome(grid, bot, dt) {
  const mind = bot.mind;
  mind.scanTimer -= dt;
  if (mind.scanTimer <= 0) {
    mind.homePoint = findNearestOwnPoint(grid, bot);
    mind.scanTimer = AI.homeScanPause;
  }
  if (mind.homePoint) {
    mind.heading = Math.atan2(mind.homePoint.y - bot.y, mind.homePoint.x - bot.x);
  }
}

function isThreatened(game, bot) {
  return game.entities.some((other) =>
    other.alive && !areAllies(other, bot) &&
    Math.hypot(other.x - bot.x, other.y - bot.y) <= AI.threatRadius
  );
}

/* Cherche une traînée adverse (jamais celle d'un allié) juste devant, dans un cône étroit. */
function findCutAngle(game, bot) {
  const grid = game.grid;
  for (const distance of AI.cutDistances) {
    for (const offset of AI.cutOffsets) {
      const angle = bot.angle + offset;
      const index = cellAt(grid, bot.x + Math.cos(angle) * distance, bot.y + Math.sin(angle) * distance);
      const trailId = index >= 0 ? grid.trail[index] : 0;
      if (trailId !== 0 && !areAllies(game.entities[trailId - 1], bot)) return angle;
    }
  }
  return null;
}

/* Point du territoire de son camp le plus proche que le bot peut rejoindre en ligne
   droite sans recouper sa traînée (une case sur deux suffit). À défaut,
   le plus proche tout court. */
function findNearestOwnPoint(grid, bot) {
  const { size, resolution, owner } = grid;
  let nearest = null;
  let nearestDistance = Infinity;
  let reachable = null;
  let reachableDistance = Infinity;
  for (let cellY = 0; cellY < size; cellY += 2) {
    for (let cellX = 0; cellX < size; cellX += 2) {
      if (owner[cellY * size + cellX] !== bot.landId) continue;
      const point = { x: (cellX + 0.5) / resolution, y: (cellY + 0.5) / resolution };
      const distance = Math.hypot(point.x - bot.x, point.y - bot.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = point;
      }
      if (distance < reachableDistance && isLineFreeOfOwnTrail(grid, bot, point, distance)) {
        reachableDistance = distance;
        reachable = point;
      }
    }
  }
  return reachable || nearest;
}

function isLineFreeOfOwnTrail(grid, bot, point, distance) {
  for (let travelled = CONFIG.selfHitGap; travelled < distance; travelled += AI.sightStep) {
    const ratio = travelled / distance;
    const index = cellAt(grid, bot.x + (point.x - bot.x) * ratio, bot.y + (point.y - bot.y) * ratio);
    if (grid.trail[index] === bot.id) return false;
  }
  return true;
}

/* Garde le cap voulu s'il est dégagé, sinon le cap dégagé le plus proche.
   Le bord de l'arène ne tue pas, mais le bot l'évite : il s'y retrouverait coincé. */
function avoidDanger(grid, bot, heading) {
  for (const offset of AI.avoidOffsets) {
    if (isPathClear(grid, bot, heading + offset)) return heading + offset;
  }
  return heading;
}

/* Simule la courbe que suivrait le bot en visant ce cap, et vérifie qu'elle
   ne mène ni contre le bord de l'arène ni sur sa propre traînée. */
function isPathClear(grid, bot, heading) {
  const stepDistance = bot.mind.speed * AI.lookAheadStep;
  const maxTurn = CONFIG.turnRate * AI.lookAheadStep;
  let { x, y, angle, pathLength } = bot;

  for (let step = 0; step < AI.lookAheadSteps; step++) {
    angle += Math.max(-maxTurn, Math.min(maxTurn, angleDifference(angle, heading)));
    x += Math.cos(angle) * stepDistance;
    y += Math.sin(angle) * stepDistance;
    pathLength += stepDistance;
    if (!hasClearance(grid, x, y, AI.wallMargin)) return false;
    const index = cellAt(grid, x, y);
    if (grid.trail[index] === bot.id && pathLength - grid.trailStamp[index] > CONFIG.selfHitGap) return false;
  }
  return true;
}
