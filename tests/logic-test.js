'use strict';

/* Tests des règles du jeu, hors navigateur :  node tests/logic-test.js
   Charge les fichiers sans DOM (config, grille, IA, règles) et vérifie
   les captures, les collisions, le redémarrage et la tenue dans la durée. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const files = ['config.js', 'names.js', 'maps.js', 'grid.js', 'ai.js', 'stats.js', 'vision.js', 'game.js', 'abilities.js', 'projection.js', 'speech.js', 'online.js'];
const source = files
  .map((file) => fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8').replace("'use strict';", ''))
  .join('\n');
const api = vm.runInNewContext(`'use strict';\n${source}\n({ CONFIG, createGame, updateGame, setPlayerHeading,
  resolvePosition, resolveHeadOnCollisions, killEntity, claimDisc, releaseTerritory, ownerAt, cellAt, setOwner, countCompleteRegions, franceToArena, cellsToScore, isHome, endGameFor,
  getSpeed, maybeRecruit, useBoost, useDash, dashProfile, isDashing, useBomb, createProjection,
  CAMPAIGN, generateCandidates, generatePartyNames, generateRivals, createIdentity, createSpeech, SPEECH_LINES, SPEECH,
  SOLO_COLORS, recolorSoloGame, ZONE_KINDS, completeRegions, steerHuman, handOverToBot, TEAMS, settleCapture,
  createHostSync, applyGuestCommand, createMirror, applyState, updateMirror, isOnlineWin, diffOwners,
  createLobby, lobbyJoin, lobbyPick, lobbyRename, lobbyLeave, cleanPlayerName,
  entityStats, landRates, tickStats, createVision, updateVision, isVisibleAt, useRadar, useScout, lobbySetMatch, matchArena,
  ARENA_SHAPES, createGrid, isInsideShape });`);
const { CONFIG, updateGame, setPlayerHeading, resolvePosition, resolveHeadOnCollisions,
  killEntity, claimDisc, releaseTerritory, ownerAt, cellsToScore, isHome, getSpeed, maybeRecruit,
  useBoost, useDash, dashProfile, isDashing, useBomb } = api;

const getEntityCells = (game, entity) => game.grid.counts[entity.landId];

/* Sauf mention contraire, les tests se jouent sur une arène carrée : les
   scénarios y sont placés au mètre près. La forme France a ses propres tests. */
const SQUARE = { shape: 'square', size: 60 };
const FRANCE = { shape: 'france', size: 60 };
const createGame = (options) => api.createGame({ arena: SQUARE, ...options });

const STEP = 1 / 60;
const EAST = 0;
const SOUTH = Math.PI / 2;
const WEST = Math.PI;
const NORTH = -Math.PI / 2;

/* Partie où le joueur est seul au centre, les adversaires étant écartés. */
function soloGame(options = {}) {
  const game = createGame({ mode: 'solo', ...options });
  for (const entity of game.entities) {
    releaseTerritory(game.grid, entity.landId);
    if (!entity.isPlayer) {
      entity.alive = false;
      entity.respawnIn = Infinity;
    }
  }
  const { x = 30, y = 30 } = options;
  game.player.x = x;
  game.player.y = y;
  claimDisc(game.grid, x, y, CONFIG.startRadius, game.player.landId);
  return game;
}

/* Le joueur vise un cap et parcourt une distance (virage compris). */
function drive(game, heading, distance) {
  const player = game.player;
  const target = player.pathLength + distance;
  setPlayerHeading(game, heading);
  // La limite de pas évite d'attendre sans fin une tête arrêtée par un mur.
  for (let i = 0; i < 2000 && player.alive && player.pathLength < target; i++) updateGame(game, STEP);
}

/* Adversaire immobile (sans IA), avec un petit territoire. */
function placeIdleBot(game, x, y, territoryRadius) {
  const bot = game.entities[1];
  Object.assign(bot, { alive: true, isPlayer: true, isHuman: true, x, y, targetAngle: null, pathLength: 0, dashTime: 0,
    trailCells: [], trailPoints: [], respawnIn: Infinity });
  if (territoryRadius) claimDisc(game.grid, x, y, territoryRadius, bot.landId);
  return bot;
}

/* Fait tracer à un adversaire immobile une traînée en ligne droite. */
function layTrail(game, bot, fromX, fromY, toX, toY) {
  const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 0.2);
  for (let i = 0; i <= steps; i++) {
    bot.x = fromX + (toX - fromX) * i / steps;
    bot.y = fromY + (toY - fromY) * i / steps;
    bot.pathLength += 0.2;
    resolvePosition(game, bot);
  }
}

function checkInvariants(game) {
  const { grid } = game;
  const counts = new Map();
  for (const id of grid.owner) counts.set(id, (counts.get(id) || 0) + 1);
  for (const land of game.lands) {
    assert.strictEqual(grid.counts[land.id], counts.get(land.id) || 0, 'compteur de cases faux');
    const held = game.entities.some((entity) => entity.alive && entity.landId === land.id);
    if (!held) assert.strictEqual(grid.counts[land.id], 0, 'un camp sans joueur en vie garde du territoire');
  }
  let expectedTrailCells = 0;
  for (const entity of game.entities) {
    if (!entity.alive) {
      assert.strictEqual(entity.trailCells.length, 0, 'un joueur éliminé garde une traînée');
      continue;
    }
    assert.ok(entity.x >= 0 && entity.y >= 0 && entity.x <= grid.arenaSize && entity.y <= grid.arenaSize, 'hors arène');
    assert.strictEqual(new Set(entity.trailCells).size, entity.trailCells.length, 'case de traînée en double');
    for (const index of entity.trailCells) {
      assert.strictEqual(grid.trail[index], entity.id, 'traînée absente de la grille');
    }
    expectedTrailCells += entity.trailCells.length;
  }
  const trailCells = grid.trail.reduce((sum, id) => sum + (id ? 1 : 0), 0);
  assert.strictEqual(trailCells, expectedTrailCells, 'traînée orpheline dans la grille');
}

/* Partie en équipes où seul le joueur bouge : les huit autres sont figés. */
function teamGame(teamKey) {
  const game = createGame({ mode: 'team', teamKey });
  for (const entity of game.entities) {
    if (!entity.isPlayer) Object.assign(entity, { isPlayer: true, isHuman: true, respawnIn: Infinity });
  }
  return game;
}

function soak(game, seconds) {
  const reasons = {};
  let captures = 0;
  const frames = Math.round(seconds / CONFIG.maxFrameTime);
  for (let i = 0; i < frames; i++) {
    updateGame(game, CONFIG.maxFrameTime);
    for (const event of game.events) {
      if (event.type === 'capture') captures++;
      if (event.type === 'death') reasons[event.reason] = (reasons[event.reason] || 0) + 1;
    }
    game.events.length = 0;
    if (i % 50 === 0) checkInvariants(game);
  }
  const deaths = Object.values(reasons).reduce((sum, count) => sum + count, 0);
  return { captures, deaths, reasons };
}

const tests = {
  'territoire initial en disque, identique pour tous': () => {
    const game = createGame({ mode: 'solo' });
    const expected = Math.PI * CONFIG.startRadius ** 2 * CONFIG.resolution ** 2;
    for (const entity of game.entities) {
      const cells = getEntityCells(game, entity);
      assert.ok(Math.abs(cells - expected) / expected < 0.05, `surface initiale ${cells} au lieu de ~${expected}`);
    }
    // Le nombre exact de cases dépend de la position du centre dans sa case.
    assert.ok(Math.abs(cellsToScore(game, game.startCells) - 20) <= 1, `score initial ${cellsToScore(game, game.startCells)}`);
    checkInvariants(game);
  },

  'le joueur attend la première commande': () => {
    const game = soloGame();
    for (let i = 0; i < 120; i++) updateGame(game, STEP);
    assert.deepStrictEqual([game.player.x, game.player.y], [30, 30]);
  },

  'le cap tourne progressivement : la trajectoire est courbe': () => {
    const game = soloGame();
    drive(game, EAST, 1);
    setPlayerHeading(game, SOUTH);
    updateGame(game, STEP);
    const turned = game.player.angle;
    assert.ok(turned > 0 && turned < 0.2, `virage instantané ou nul (${turned})`);
    drive(game, SOUTH, 4);
    assert.ok(Math.abs(game.player.angle - SOUTH) < 1e-6, 'le cap visé doit être atteint');
  },

  'une boucle fermée capture la zone entourée': () => {
    const game = soloGame();
    const player = game.player;
    const before = getEntityCells(game, player);
    drive(game, EAST, 9);
    assert.ok(player.trailPoints.length > 0, 'une traînée doit exister hors du territoire');
    drive(game, SOUTH, 8);
    drive(game, WEST, 9);
    drive(game, NORTH, 9);
    assert.ok(player.alive);
    assert.strictEqual(player.trailPoints.length, 0, 'la traînée doit disparaître');
    assert.strictEqual(player.trailCells.length, 0);
    assert.strictEqual(ownerAt(game.grid, 35, 34), player.landId, 'intérieur de la boucle non capturé');
    assert.strictEqual(ownerAt(game.grid, 42, 30), 0, 'extérieur capturé à tort');
    assert.strictEqual(ownerAt(game.grid, 35, 42), 0, 'extérieur capturé à tort');
    assert.ok(getEntityCells(game, player) > before * 3, 'le territoire doit nettement grandir');
    checkInvariants(game);
  },

  'un demi-tour serré ne coupe pas sa propre traînée': () => {
    const game = soloGame();
    drive(game, EAST, 7);
    drive(game, WEST, 6);
    assert.strictEqual(game.player.alive, true);
    const player = game.player;
    drive(game, Math.atan2(30 - player.y, 30 - player.x), 5);
    assert.strictEqual(player.alive, true);
    assert.strictEqual(player.trailPoints.length, 0, 'retour au territoire : capture');
    checkInvariants(game);
  },

  'recouper sa propre traînée fait perdre': () => {
    const game = soloGame();
    drive(game, EAST, 9);
    drive(game, SOUTH, 4);
    drive(game, WEST, 4);
    drive(game, NORTH, 8);
    assert.strictEqual(game.player.alive, false);
    assert.strictEqual(game.ending.reason, 'self');
    checkInvariants(game);
  },

  'le bord de l\'arène arrête la tête sans la tuer': () => {
    const game = soloGame();
    drive(game, WEST, 40);
    assert.strictEqual(game.player.alive, true);
    assert.ok(Math.abs(game.player.x - CONFIG.headRadius) < 1e-9, 'la tête doit s\'arrêter contre le mur');
    for (let i = 0; i < 300; i++) updateGame(game, STEP);
    assert.strictEqual(game.player.alive, true, 'rester appuyé contre le mur ne tue pas');
    drive(game, SOUTH, 3);
    assert.ok(game.player.y > 32, 'on glisse le long du mur');
  },

  'une boucle fermée contre le mur capture ce qu\'elle entoure': () => {
    const game = soloGame({ x: 5, y: 30 });
    const player = game.player;
    const before = getEntityCells(game, player);
    drive(game, WEST, 8);
    drive(game, SOUTH, 7);
    drive(game, EAST, 5);
    setPlayerHeading(game, NORTH);
    for (let i = 0; i < 600 && player.trailPoints.length > 0; i++) updateGame(game, STEP);
    assert.ok(player.alive && player.trailPoints.length === 0, 'retour chez soi');
    assert.strictEqual(ownerAt(game.grid, 0.3, 33), player.landId, 'la zone contre le mur doit être capturée');
    assert.strictEqual(ownerAt(game.grid, 2, 34), player.landId);
    assert.strictEqual(ownerAt(game.grid, 20, 33), 0, 'le reste de l\'arène reste libre');
    assert.ok(getEntityCells(game, player) > before * 2);
    checkInvariants(game);
  },

  'un adversaire qui touche la traînée élimine le joueur': () => {
    const game = soloGame();
    drive(game, EAST, 8);
    const cellsBefore = getEntityCells(game, game.player);
    const bot = placeIdleBot(game, 35, 30.3, 0);        // en plein sur la traînée
    resolvePosition(game, bot);
    assert.strictEqual(game.player.alive, false);
    assert.strictEqual(game.ending.reason, 'cut');
    assert.strictEqual(game.ending.killerName, bot.name);
    assert.strictEqual(game.ending.cells, cellsBefore);
    assert.strictEqual(bot.alive, true);
    for (let i = 0; i < 80; i++) updateGame(game, STEP);
    assert.strictEqual(game.over, true, 'l\'écran de défaite doit suivre');
    checkInvariants(game);
  },

  'frôler une traînée sans la toucher ne tue pas': () => {
    const game = soloGame();
    drive(game, EAST, 8);
    const bot = placeIdleBot(game, 35, 31.2, 0);        // à 1,2 unité de la ligne
    resolvePosition(game, bot);
    assert.strictEqual(game.player.alive, true);
  },

  'le joueur élimine un adversaire en coupant sa traînée': () => {
    const game = soloGame();
    const bot = placeIdleBot(game, 36, 22, 1.5);
    layTrail(game, bot, 36, 24, 36, 36);
    assert.ok(bot.trailCells.length > 0);
    drive(game, EAST, 9);
    assert.strictEqual(bot.alive, false);
    assert.strictEqual(game.player.alive, true);
    checkInvariants(game);
  },

  'un choc frontal élimine les deux': () => {
    const game = soloGame();
    drive(game, EAST, 6);                               // joueur hors de chez lui, cap à l'est
    const player = game.player;
    const bot = placeIdleBot(game, player.x + 0.6, player.y, 0);
    bot.angle = WEST;
    resolveHeadOnCollisions(game);
    assert.strictEqual(bot.alive, false);
    assert.strictEqual(player.alive, false);
    assert.strictEqual(game.ending.reason, 'headon');
  },

  'entourer tout le territoire adverse l\'élimine': () => {
    const game = soloGame();
    const bot = placeIdleBot(game, 35, 34, 1.5);
    drive(game, EAST, 9);
    drive(game, SOUTH, 8);
    drive(game, WEST, 9);
    drive(game, NORTH, 9);
    assert.strictEqual(game.player.alive, true);
    assert.strictEqual(bot.alive, false, 'le joueur entouré doit être éliminé');
    assert.strictEqual(ownerAt(game.grid, 35, 34), game.player.landId);
    checkInvariants(game);
  },

  'rejouer repart d\'un état neuf': () => {
    const first = soloGame();
    drive(first, EAST, 9);
    drive(first, SOUTH, 4);
    drive(first, WEST, 4);
    drive(first, NORTH, 8);
    assert.strictEqual(first.ending.reason, 'self');
    const second = createGame({ mode: 'solo' });
    assert.strictEqual(second.ending, null);
    assert.strictEqual(second.over, false);
    assert.strictEqual(second.player.alive, true);
    assert.strictEqual(second.player.targetAngle, null);
    const y = second.player.y;
    drive(second, NORTH, 1);
    assert.ok(second.player.y < y, 'les commandes répondent après redémarrage');
  },

  'traînée protégée : ni le joueur ni un adversaire ne la coupent, et la partie ne compte pas pour les records': () => {
    const game = soloGame({ safeTrail: true });
    assert.strictEqual(game.unranked, true);
    drive(game, EAST, 9);
    drive(game, SOUTH, 4);
    drive(game, WEST, 4);
    drive(game, NORTH, 8);
    assert.strictEqual(game.player.alive, true, 'recouper sa traînée ne tue plus');
    assert.strictEqual(game.ending, null);
    const bot = placeIdleBot(game, game.player.trailPoints[2].x, game.player.trailPoints[2].y - 3, 0);
    layTrail(game, bot, bot.x, bot.y, bot.x, bot.y + 6);                 // passe sur la traînée du joueur
    assert.strictEqual(game.player.alive, true, 'un adversaire ne la coupe pas non plus');
    // Les traînées adverses, elles, restent vulnérables.
    const other = soloGame({ safeTrail: true });
    const victim = placeIdleBot(other, 34, 24, 1.5);
    layTrail(other, victim, 34, 26, 34, 34);
    drive(other, EAST, 6);
    assert.strictEqual(victim.alive, false);
    assert.strictEqual(soloGame().unranked, false);
  },

  'une élimination rapporte une charge, et le bilan de défaite la compte': () => {
    const game = soloGame();
    const player = game.player;
    const bot = placeIdleBot(game, 36, 22, 1.5);
    layTrail(game, bot, 36, 24, 36, 36);
    drive(game, EAST, 9);
    assert.strictEqual(bot.alive, false);
    assert.strictEqual(player.kills, 1);
    assert.strictEqual(player.charges, 1);
    for (let i = 0; i < 30; i++) killEntity(game, bot, player, 'cut');   // déjà éliminé : ne compte pas deux fois
    assert.strictEqual(player.kills, 1);
    drive(game, SOUTH, 4);
    drive(game, WEST, 4);
    drive(game, NORTH, 8);
    assert.strictEqual(game.ending.reason, 'self');
    assert.strictEqual(game.ending.kills, 1);
    assert.ok(game.ending.standings.some((row) => row.isPlayerLand && row.cells > 0), 'le bilan garde la part du joueur');
  },

  'les charges plafonnent à dix': () => {
    const game = soloGame();
    for (let i = 0; i < 14; i++) {
      const bot = placeIdleBot(game, 40, 40, 1);
      killEntity(game, bot, game.player, 'cut');
    }
    assert.strictEqual(game.player.kills, 14);
    assert.strictEqual(game.player.charges, 10);
  },

  'un grand territoire ralentit, dans la limite prévue': () => {
    const game = soloGame();
    const small = getSpeed(game, game.player);
    assert.ok(small > CONFIG.speed * 0.99);
    claimDisc(game.grid, 30, 30, 12, game.player.landId);            // environ 12,5 % de l'arène
    const medium = getSpeed(game, game.player);
    assert.ok(medium < small * 0.9 && medium > small * 0.85, `vitesse ${medium}`);
    claimDisc(game.grid, 30, 30, 29, game.player.landId);            // environ 73 %
    assert.ok(Math.abs(getSpeed(game, game.player) - CONFIG.speed * (1 - CONFIG.maxSlowdown)) < 1e-9);
  },

  'arrêt : sans direction le joueur s\'arrête, et repart aussitôt dans la direction donnée': () => {
    const game = soloGame();
    const player = game.player;
    setPlayerHeading(game, null);
    assert.strictEqual(player.targetAngle, null, 'avant le départ, rien à arrêter');
    drive(game, EAST, 5);
    setPlayerHeading(game, null);
    assert.strictEqual(player.halted, true);
    const { x, y } = player;
    for (let i = 0; i < 120; i++) updateGame(game, STEP);
    assert.deepStrictEqual([player.x, player.y], [x, y], 'la tête reste sur place');
    assert.strictEqual(player.alive, true, 'rester sur sa traînée toute fraîche ne tue pas');
    setPlayerHeading(game, SOUTH);
    assert.ok(Math.abs(player.angle - SOUTH) < 1e-9, 'elle repart dans la nouvelle direction, sans virage');
    updateGame(game, STEP);
    assert.ok(player.y > y, 'et elle avance de nouveau');
  },

  'victoire : le joueur gagne en atteignant 51 % de l\'arène': () => {
    const game = soloGame();
    const player = game.player;
    // Petite boucle au bord du territoire : sort par l'est, revient par l'ouest.
    const smallLoop = (radius) => {
      claimDisc(game.grid, 30, 30, radius, player.landId);
      Object.assign(player, { x: 30 + radius - 1, y: 30, angle: EAST });
      drive(game, EAST, 3);
      drive(game, SOUTH, 2);
      setPlayerHeading(game, WEST);
      for (let i = 0; i < 600 && player.trailPoints.length > 0; i++) updateGame(game, STEP);
    };
    smallLoop(22);                                            // environ 42 % de l'arène
    assert.strictEqual(player.trailPoints.length, 0);
    assert.strictEqual(game.ending, null, 'sous le seuil, la partie continue');
    smallLoop(24.5);                                          // environ 52 %
    assert.ok(game.ending, 'la capture suivante doit clore la partie');
    assert.strictEqual(game.ending.won, true);
    assert.strictEqual(game.ending.reason, 'victory');
    assert.strictEqual(game.ending.standings[0].isPlayerLand, true);
    for (let i = 0; i < 80; i++) updateGame(game, STEP);
    assert.strictEqual(game.over, true);
    const frozen = [player.x, player.y];
    for (let i = 0; i < 30; i++) updateGame(game, STEP);
    assert.deepStrictEqual([player.x, player.y], frozen, 'après la victoire, tout s\'arrête');
  },

  'victoire : un camp adverse à 51 % fait perdre le joueur': () => {
    const game = teamGame('lfi');
    const player = game.player;
    const rival = game.entities.find((entity) => entity.landId !== player.landId);
    const rivalLand = game.lands[rival.landId - 1];
    for (const land of game.lands) releaseTerritory(game.grid, land.id);
    claimDisc(game.grid, 5, 5, 2, player.landId);
    Object.assign(player, { x: 5, y: 5 });
    for (const other of game.entities) if (other !== player && other !== rival) Object.assign(other, { x: 5, y: 5, landId: player.landId });
    claimDisc(game.grid, 34, 34, 24.5, rival.landId);
    Object.assign(rival, { x: 34, y: 9 });                    // juste hors de son territoire
    resolvePosition(game, rival);
    Object.assign(rival, { x: 34, y: 11 });                   // y rentre : capture, donc contrôle de victoire
    resolvePosition(game, rival);
    assert.ok(game.ending, 'la partie doit se clore');
    assert.strictEqual(game.ending.won, false);
    assert.strictEqual(game.ending.reason, 'outpaced');
    assert.strictEqual(game.ending.winnerName, rivalLand.name);
    assert.strictEqual(player.alive, true);
  },

  'boost : coûte une charge, accélère un moment, puis retombe': () => {
    const game = soloGame();
    const player = game.player;
    assert.strictEqual(useBoost(game, player), false, 'sans charge, pas de boost');
    player.charges = 2;
    const normal = getSpeed(game, player);
    assert.strictEqual(useBoost(game, player), true);
    assert.strictEqual(player.charges, 1);
    assert.ok(Math.abs(getSpeed(game, player) - normal * CONFIG.abilities.boost.speedFactor) < 1e-9);
    setPlayerHeading(game, EAST);
    for (let i = 0; i < 60 * 3; i++) updateGame(game, STEP);
    assert.ok(Math.abs(getSpeed(game, player) - normal) < 0.5, 'le boost doit s\'arrêter');
    assert.ok(player.trailCells.length > 0);
    checkInvariants(game);
  },

  'dash : coûte 3 charges, part dans la direction visée, même à l\'arrêt': () => {
    const game = soloGame();
    const player = game.player;
    assert.strictEqual(useDash(game, player, SOUTH), false, 'sans charges, pas de dash');
    Object.assign(player, { charges: 4, kills: 3 });
    drive(game, EAST, 1);
    setPlayerHeading(game, null);
    const profile = dashProfile(game, player);
    const y = player.y;
    assert.strictEqual(useDash(game, player, SOUTH), true);
    assert.strictEqual(player.charges, 1);
    assert.strictEqual(player.halted, false);
    assert.ok(game.events.some((event) => event.type === 'dash'));
    for (let i = 0; i < 120 && isDashing(player); i++) updateGame(game, STEP);
    assert.ok(Math.abs(player.y - y - profile.distance) < 0.5, `dash de ${player.y - y}, ${profile.distance} prévu`);
    assert.strictEqual(isDashing(player), false);
    assert.ok(Math.abs(player.angle - SOUTH) < 1e-9);
  },

  'dash : plus explosif avec les éliminations': () => {
    const game = soloGame();
    const player = game.player;
    const reach = (kills) => {
      player.kills = kills;
      return dashProfile(game, player).distance;
    };
    assert.ok(reach(3) > 9 && reach(3) < 13, `à 3 éliminations : ${reach(3)}`);
    assert.ok(reach(10) > reach(6) && reach(6) > reach(3), 'chaque élimination l\'allonge');
    assert.ok(reach(10) > 1.8 * reach(3), `à 10 éliminations : ${reach(10)}`);
    assert.strictEqual(reach(25), reach(10), 'plafonné à 10 éliminations');
  },

  'dash : traverse les têtes adverses sans choc frontal': () => {
    const game = soloGame();
    const player = game.player;
    claimDisc(game.grid, 30, 30, 6, player.landId);
    const bot = placeIdleBot(game, 30.6, 30, 0);
    bot.angle = WEST;
    setPlayerHeading(game, EAST);
    Object.assign(player, { charges: 3, kills: 3 });
    useDash(game, player, EAST);
    resolveHeadOnCollisions(game);
    assert.strictEqual(bot.alive, true);
    assert.strictEqual(player.alive, true);
  },

  'bombe : éclabousse au loin, élimine les adversaires touchés et peint le sol': () => {
    const game = soloGame();
    const player = game.player;
    const { range, flightTime, coreRadius } = CONFIG.abilities.bomb;
    const onTrail = placeIdleBot(game, 30 + range, 20, 1.5);
    layTrail(game, onTrail, 30 + range, 22, 30 + range, 30);           // sa traînée arrive au point d'impact
    const farAway = game.entities[2];
    Object.assign(farAway, { alive: true, isPlayer: true, isHuman: true, x: 10, y: 10, targetAngle: null, respawnIn: Infinity });
    claimDisc(game.grid, 10, 10, 1.5, farAway.landId);

    setPlayerHeading(game, EAST);
    assert.strictEqual(useBomb(game, player), false, 'il faut dix charges');
    player.charges = 10;
    const before = getEntityCells(game, player);
    assert.strictEqual(useBomb(game, player), true);
    assert.strictEqual(player.charges, 0);
    assert.strictEqual(game.projectiles.length, 1);
    const throwX = player.x;
    for (let i = 0; i < Math.ceil(flightTime * 60) + 2; i++) updateGame(game, STEP);
    assert.strictEqual(game.projectiles.length, 0);
    assert.strictEqual(onTrail.alive, false, 'la traînée touchée élimine son auteur');
    assert.strictEqual(farAway.alive, true, 'hors de la zone, rien');
    assert.strictEqual(player.kills, 1);
    assert.strictEqual(player.charges, 1);
    assert.strictEqual(ownerAt(game.grid, throwX + range, player.y), player.landId, 'le point d\'impact est peint');
    const gained = getEntityCells(game, player) - before;
    const coreArea = Math.PI * coreRadius ** 2 * CONFIG.resolution ** 2;
    assert.ok(gained > coreArea * 0.9 && gained < coreArea * 4, `zone gagnée inattendue : ${gained}`);
    checkInvariants(game);
  },

  'bombe : sans effet si le lanceur est éliminé avant l\'impact': () => {
    const game = soloGame();
    const player = game.player;
    player.charges = 10;
    setPlayerHeading(game, EAST);
    useBomb(game, player);
    killEntity(game, player, null, 'self');
    for (let i = 0; i < 60; i++) updateGame(game, STEP);
    assert.strictEqual(ownerAt(game.grid, 30 + CONFIG.abilities.bomb.range, 30), 0);
    checkInvariants(game);
  },

  'équipes : une grande capture fait venir un renfort, neuf joueurs au plus': () => {
    const game = teamGame('renaissance');
    const landId = game.player.landId;
    const members = () => game.entities.filter((entity) => entity.landId === landId);
    maybeRecruit(game, landId, 0);
    assert.strictEqual(members().length, 3, 'aucun gain, aucun renfort');
    for (let i = 0; i < 20; i++) maybeRecruit(game, landId, game.grid.playableCount);
    assert.strictEqual(members().length, CONFIG.teamMaxSize);
    const names = members().map((entity) => entity.name);
    assert.strictEqual(new Set(names).size, names.length, 'noms en double');
    for (const recruit of members()) assert.ok(recruit.alive && isHome(game, recruit), 'le renfort arrive sur le territoire commun');
    assert.strictEqual(game.entities.filter((entity) => entity.landId !== landId).length, 6, 'les autres camps ne changent pas');
    const solo = soloGame();
    maybeRecruit(solo, solo.player.landId, solo.grid.playableCount);
    assert.strictEqual(solo.entities.length, api.CAMPAIGN.levels[0].rivals + 1, 'pas de renfort en solo');
    checkInvariants(game);
  },

  'équipes : trois camps de trois, chacun sur son territoire': () => {
    for (const teamKey of ['lfi', 'renaissance', 'rn']) {
      const game = createGame({ mode: 'team', teamKey });
      assert.strictEqual(game.lands.length, 3);
      assert.strictEqual(game.entities.length, 9);
      const sizes = game.lands.map((land) => game.grid.counts[land.id]);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= Math.min(...sizes) * 0.03, `bases inégales : ${sizes}`);
      for (const land of game.lands) {
        assert.strictEqual(game.entities.filter((entity) => entity.landId === land.id).length, 3);
      }
      for (const entity of game.entities) assert.ok(isHome(game, entity), 'chacun démarre chez lui');
      const playerLand = game.lands[game.player.landId - 1];
      assert.strictEqual(playerLand.isPlayerLand, true);
      assert.strictEqual(playerLand.name, { lfi: 'LFI', renaissance: 'Renaissance', rn: 'RN' }[teamKey]);
      assert.strictEqual(game.entities.filter((entity) => entity.isPlayer).length, 1);
      checkInvariants(game);
    }
  },

  'équipes : la traînée d\'un allié ne tue pas, celle d\'un adversaire si': () => {
    const game = teamGame('rn');
    const player = game.player;
    const ally = game.entities.find((entity) => entity !== player && entity.landId === player.landId);
    const enemy = game.entities.find((entity) => entity.landId !== player.landId);
    drive(game, player.x < 30 ? EAST : WEST, 9);
    const onTrail = player.trailPoints[Math.floor(player.trailPoints.length / 2)];
    assert.ok(onTrail, 'le joueur doit avoir une traînée');
    Object.assign(ally, onTrail);
    resolvePosition(game, ally);
    assert.strictEqual(player.alive, true, 'un allié ne coupe pas la traînée');
    Object.assign(enemy, onTrail);
    resolvePosition(game, enemy);
    assert.strictEqual(player.alive, false, 'un adversaire coupe la traînée');
    assert.strictEqual(game.ending.reason, 'cut');
  },

  'équipes : le territoire est commun et survit à un coéquipier': () => {
    const game = teamGame('lfi');
    const player = game.player;
    const land = game.lands[player.landId - 1];
    const mates = game.entities.filter((entity) => entity !== player && entity.landId === land.id);
    const before = game.grid.counts[land.id];

    killEntity(game, mates[0], null, 'wall');
    assert.strictEqual(game.grid.counts[land.id], before, 'le territoire reste tant qu\'un coéquipier vit');
    mates[0].respawnIn = 0;
    mates[0].isPlayer = false;
    updateGame(game, STEP);
    assert.ok(mates[0].alive && isHome(game, mates[0]), 'le coéquipier revient sur le territoire commun');
    mates[0].isPlayer = true;
    mates[0].targetAngle = null;

    const start = { x: player.x, y: player.y };
    const outward = Math.atan2(30 - start.y, 30 - start.x);   // vers le centre de l'arène
    drive(game, outward, 10);
    drive(game, outward + Math.PI / 2, 4);
    setPlayerHeading(game, Math.atan2(start.y - player.y, start.x - player.x));
    for (let i = 0; i < 600 && player.alive && player.trailPoints.length > 0; i++) updateGame(game, STEP);
    assert.ok(player.alive && player.trailPoints.length === 0, 'retour chez soi');
    assert.ok(game.grid.counts[land.id] > before, 'la capture agrandit le territoire de l\'équipe');

    // (un renfort a pu rejoindre l'équipe pendant la capture)
    for (const member of game.entities.filter((entity) => entity.landId === land.id)) killEntity(game, member, null, 'self');
    assert.strictEqual(game.grid.counts[land.id], 0, 'équipe entièrement éliminée : territoire libéré');
    checkInvariants(game);
  },

  'France : l\'arène a la forme du pays, et les pourcentages portent sur elle': () => {
    const game = api.createGame({ mode: 'solo', arena: FRANCE });
    const { grid } = game;
    const fraction = grid.playableCount / grid.owner.length;
    assert.ok(fraction > 0.45 && fraction < 0.7, `part jouable inattendue : ${fraction}`);
    const inside = (x, y) => grid.playable[api.cellAt(grid, x, y)] === 1;
    assert.ok(inside(30, 30), 'le centre du pays est jouable');
    assert.ok(!inside(3, 3) && !inside(57, 3) && !inside(57, 57), 'les coins du carré sont hors de l\'arène');
    assert.ok(inside(8, 20), 'la Bretagne est jouable');
    assert.ok(!inside(10, 45), 'le golfe de Gascogne ne l\'est pas');
    for (const entity of game.entities) {
      assert.ok(inside(entity.x, entity.y), 'chacun apparaît dans l\'arène');
      assert.ok(getEntityCells(game, entity) > 280, 'territoire initial entier, pas rogné par la côte');
    }
    let owned = 0;
    for (let index = 0; index < grid.owner.length; index++) {
      if (grid.owner[index] !== 0) { owned++; assert.strictEqual(grid.playable[index], 1, 'territoire hors de l\'arène'); }
    }
    assert.ok(owned > 0);
  },

  'France : la côte arrête la tête, et une boucle contre la côte capture': () => {
    const game = api.createGame({ mode: 'solo', arena: FRANCE });
    const { grid } = game;
    const player = game.player;
    for (const entity of game.entities) {
      releaseTerritory(grid, entity.landId);
      if (!entity.isPlayer) Object.assign(entity, { alive: false, respawnIn: Infinity });
    }
    Object.assign(player, { x: 22, y: 34 });               // dans les terres, face à l'Atlantique
    claimDisc(grid, 22, 34, CONFIG.startRadius, player.landId);
    const before = getEntityCells(game, player);
    drive(game, WEST, 30);
    assert.strictEqual(player.alive, true);
    assert.ok(grid.playable[api.cellAt(grid, player.x, player.y)] === 1, 'la tête reste dans l\'arène');
    assert.ok(player.x > 13 && player.x < 20, `arrêtée par la côte, pas par le carré (x = ${player.x})`);
    drive(game, SOUTH, 6);
    drive(game, EAST, 4);
    setPlayerHeading(game, Math.atan2(34 - player.y, 22 - player.x));
    for (let i = 0; i < 900 && player.trailPoints.length > 0; i++) updateGame(game, STEP);
    assert.strictEqual(player.trailPoints.length, 0, 'retour chez soi');
    assert.ok(getEntityCells(game, player) > before + 80, 'la zone fermée contre la côte est capturée');
    assert.strictEqual(ownerAt(grid, 18.6, 34.6), player.landId, 'jusqu\'au rivage');
    assert.ok(getEntityCells(game, player) < grid.playableCount * 0.2, 'sans avaler le reste du pays');
    checkInvariants(game);
  },

  'régions : douze régions, chaque case du pays dans une seule': () => {
    const game = api.createGame({ mode: 'solo', arena: FRANCE });
    const { grid } = game;
    assert.strictEqual(grid.regions.length, 12);
    assert.strictEqual(grid.regions.reduce((sum, region) => sum + region.cells, 0), grid.playableCount);
    for (const region of grid.regions) assert.ok(region.cells > grid.playableCount * 0.015, `${region.name} est vide ou minuscule`);
    const regionAt = (longitude, latitude) => {
      const [x, y] = api.franceToArena(longitude, latitude, FRANCE.size);
      return grid.regions[grid.regionOf[api.cellAt(grid, x, y)] - 1].name;
    };
    assert.strictEqual(regionAt(2.35, 48.86), 'Île-de-France');
    assert.strictEqual(regionAt(1.44, 43.6), 'Occitanie');
    assert.strictEqual(regionAt(-3.5, 48.2), 'Bretagne');
    assert.strictEqual(regionAt(7.3, 48.3), 'Grand Est');
    assert.strictEqual(regionAt(-0.6, 44.8), 'Nouvelle-Aquitaine');
    assert.strictEqual(regionAt(5.4, 43.5), 'Provence-Alpes-Côte d\'Azur');
    assert.strictEqual(createGame({ mode: 'solo' }).grid.regions.length, 0, 'pas de régions sur l\'arène carrée');
  },

  'régions : au-delà de 70 %, la capture suivante complète la région': () => {
    const game = api.createGame({ mode: 'solo', arena: FRANCE });
    const { grid } = game;
    const player = game.player;
    for (const entity of game.entities) {
      releaseTerritory(grid, entity.landId);
      if (!entity.isPlayer) Object.assign(entity, { alive: false, respawnIn: Infinity });
    }
    const [x, y] = api.franceToArena(2.0, 47.5, FRANCE.size);      // Centre-Val de Loire
    const regionId = grid.regionOf[api.cellAt(grid, x, y)];
    const region = grid.regions[regionId - 1];
    assert.strictEqual(region.name, 'Centre-Val de Loire');
    const give = (share) => {
      let given = 0;
      for (let index = 0; index < grid.owner.length && given < region.cells * share; index++) {
        if (grid.regionOf[index] === regionId) { api.setOwner(grid, index, player.landId); given++; }
      }
    };
    const ownedInRegion = () => grid.owner.reduce((sum, id, index) => sum + (id === player.landId && grid.regionOf[index] === regionId ? 1 : 0), 0);
    // Petite capture en lisière de son territoire, pour déclencher le contrôle.
    const smallCapture = () => {
      let edge = -1;
      for (let index = 0; index < grid.owner.length && edge < 0; index++) {
        if (grid.owner[index] === player.landId && grid.owner[index + 1] === 0 && grid.playable[index + 1] === 1) edge = index;
      }
      Object.assign(player, { x: (edge % grid.size + 0.5) / grid.resolution, y: (Math.floor(edge / grid.size) + 0.5) / grid.resolution, angle: EAST });
      game.events.length = 0;
      drive(game, EAST, 1.5);
      setPlayerHeading(game, WEST);
      for (let i = 0; i < 600 && player.trailPoints.length > 0; i++) updateGame(game, STEP);
      return game.events.filter((event) => event.type === 'region');
    };

    give(0.5);
    assert.strictEqual(smallCapture().length, 0, 'à 50 %, rien');
    assert.ok(ownedInRegion() < region.cells * 0.6);
    give(0.72);
    const completed = smallCapture();
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].name, 'Centre-Val de Loire');
    assert.strictEqual(ownedInRegion(), region.cells, 'toute la région appartient au joueur');
    assert.strictEqual(smallCapture().length, 0, 'une région déjà complète n\'est pas annoncée deux fois');
    checkInvariants(game);
  },

  'en ligne : les humains d\'abord dans leur camp, des IA pour compléter, et seuls les humains attendent une commande': () => {
    const [a, b, c] = api.TEAMS.map((team) => team.key);
    const humans = [
      { peer: 'host', name: 'Zoé', teamKey: a },
      { peer: 'p2', name: 'Max', teamKey: a },
      { peer: 'p3', name: 'Léa', teamKey: b },
    ];
    const game = api.createGame({ mode: 'online', humans });
    assert.strictEqual(game.grid.zoneKind, 'region');
    assert.strictEqual(game.player.name, 'Zoé');
    assert.strictEqual(game.player.isHuman, true);
    for (const key of [a, b, c]) {
      const land = game.lands.find((item) => item.key === key);
      assert.strictEqual(game.entities.filter((entity) => entity.landId === land.id).length, 3, `camp ${key} complet`);
    }
    const max = game.entities.find((entity) => entity.peer === 'p2');
    assert.ok(max && max.isHuman && !max.isPlayer);
    assert.strictEqual(max.landId, game.player.landId, 'Max joue avec Zoé');
    for (let i = 0; i < 60; i++) updateGame(game, STEP);
    for (const entity of game.entities) {
      if (entity.isHuman) assert.strictEqual(entity.targetAngle, null, `${entity.name} attend sa commande`);
    }
    assert.ok(game.entities.some((entity) => !entity.isHuman && entity.targetAngle !== null), 'les IA partent');
    api.steerHuman(max, 0);
    const x = max.x;
    for (let i = 0; i < 10; i++) updateGame(game, STEP);
    assert.ok(max.x > x, 'Max avance quand il le demande');
  },

  'en ligne : tout le monde réapparaît, la partie finit quand un camp atteint 51 %, un invité parti est remplacé par une IA': () => {
    const [a, b] = api.TEAMS.map((team) => team.key);
    const game = api.createGame({ mode: 'online', humans: [{ peer: 'host', name: 'Zoé', teamKey: a }, { peer: 'p2', name: 'Max', teamKey: b }] });
    const max = game.entities.find((entity) => entity.peer === 'p2');
    killEntity(game, game.player, max, 'cut');
    killEntity(game, max, null, 'self');
    assert.strictEqual(game.ending, null, 'une élimination ne termine rien');
    for (let i = 0; i < 300 && !(game.player.alive && max.alive); i++) updateGame(game, STEP);
    assert.ok(game.player.alive && max.alive, 'les deux humains reviennent');
    api.handOverToBot(max);
    updateGame(game, STEP);
    assert.ok(max.targetAngle !== null, 'l\'IA a pris la main');
    const land = game.lands[max.landId - 1];
    claimDisc(game.grid, 50, 50, 45, land.id);
    api.settleCapture(game, max, 0);
    assert.strictEqual(game.ending.online, true);
    assert.strictEqual(game.ending.winnerKey, land.key);
    assert.strictEqual(game.ending.winnerName, land.name);
  },

  'en ligne : le miroir d\'un invité reproduit exactement la partie de l\'hôte': () => {
    const [a, b] = api.TEAMS.map((team) => team.key);
    const game = api.createGame({ mode: 'online', humans: [{ peer: 'host', name: 'Zoé', teamKey: a }, { peer: 'p2', name: 'Max', teamKey: b }] });
    const sync = api.createHostSync(game);
    const wire = (message) => JSON.parse(JSON.stringify(message));   // comme sur le réseau
    const mirror = api.createMirror(wire(sync.start()), 'p2');
    assert.strictEqual(mirror.player.name, 'Max');
    assert.strictEqual(mirror.player.isPlayer, true);
    assert.strictEqual(mirror.lands.map((land) => land.key).join(), game.lands.map((land) => land.key).join());

    setPlayerHeading(game, 0);
    api.applyGuestCommand(game, 'p2', wire({ type: 'steer', angle: Math.PI / 2 }));
    const host = game.entities.find((entity) => entity.peer === 'p2');
    Object.assign(host, { charges: 13, kills: 4 });   // dash (3) puis bombe (10)
    const events = [];
    // Dash puis bombe, dès que Max est en vie (une IA a pu l'éliminer entre-temps).
    let dashed = false;
    let bombed = false;
    for (let frame = 0; frame < 600; frame++) {
      updateGame(game, STEP);
      if (frame >= 200 && !dashed && host.alive) {
        Object.assign(host, { charges: 13, kills: 4 });
        dashed = true;
        api.applyGuestCommand(game, 'p2', wire({ type: 'ability', kind: 'dash', angle: 0 }));
      } else if (frame >= 260 && dashed && !bombed && host.alive) {
        host.charges = Math.max(host.charges, 10);
        bombed = true;
        api.applyGuestCommand(game, 'p2', wire({ type: 'ability', kind: 'bomb' }));
      }
      sync.collect(game.events);
      game.events.length = 0;
      if (frame % 3 === 2) {
        api.applyState(mirror, wire(sync.tick()));
        events.push(...mirror.events.map((event) => event.type));
        mirror.events.length = 0;
      }
    }
    api.applyState(mirror, wire(sync.tick()));
    assert.ok(game.grid.owner.every((owner, index) => mirror.grid.owner[index] === owner), 'mêmes cases');
    for (const land of game.lands) assert.strictEqual(mirror.grid.counts[land.id], game.grid.counts[land.id]);
    assert.strictEqual(mirror.entities.length, game.entities.length, 'renforts compris');
    for (const entity of game.entities) {
      const copy = mirror.entities[entity.id - 1];
      assert.strictEqual(copy.alive, entity.alive);
      assert.strictEqual(copy.trailPoints.length, entity.trailPoints.length, `traînée de ${entity.name}`);
      if (entity.alive) assert.ok(Math.hypot(copy.netX - entity.x, copy.netY - entity.y) < 0.01);
    }
    assert.ok(events.includes('dash'), 'le dash est annoncé');
    assert.ok(events.includes('capture'));
    assert.ok(mirror.projectiles.length > 0 || events.includes('splash'), 'la bombe aussi');

    // Lissage : la tête glisse vers sa position prévue sans à-coup.
    const head = mirror.entities.find((entity) => entity.alive && entity.netSpeed > 0);
    const before = Math.hypot(head.x - head.netX, head.y - head.netY);
    api.updateMirror(mirror, 0.016);
    assert.ok(Math.hypot(head.x - head.netX, head.y - head.netY) < before + 1);

    // Fin de partie : chaque appareil sait si son camp a gagné.
    const land = game.lands[host.landId - 1];
    claimDisc(game.grid, 50, 50, 45, land.id);
    api.settleCapture(game, host, 0);
    api.applyState(mirror, wire(sync.tick()));
    assert.strictEqual(mirror.ending.winnerKey, land.key);
    assert.strictEqual(api.isOnlineWin(mirror), true);
    for (let i = 0; i < 300 && !mirror.over; i++) api.updateMirror(mirror, STEP);
    assert.strictEqual(mirror.over, true);
  },

  'en ligne : les changements de cases voyagent en suites compactes': () => {
    const owner = new Uint8Array(20);
    const sent = new Uint8Array(20);
    owner.fill(3, 2, 9);
    owner.fill(1, 9, 12);
    assert.deepStrictEqual(Array.from(api.diffOwners(owner, sent)), [2, 7, 3, 9, 3, 1]);
    assert.strictEqual(api.diffOwners(owner, sent).length, 0, 'plus rien à envoyer');
    owner.fill(0, 4, 6);
    assert.deepStrictEqual(Array.from(api.diffOwners(owner, sent)), [4, 2, 0]);
  },

  'salon : six humains au plus, trois par camp, noms nettoyés': () => {
    const [a, b] = api.TEAMS.map((team) => team.key);
    const lobby = api.createLobby({ name: 'Zoé', teamKey: a });
    assert.strictEqual(lobby.players[0].peer, 'host');
    assert.strictEqual(api.lobbyJoin(lobby, 'p1', '  Max   le   Grand  ', a), null);
    assert.strictEqual(api.lobbyJoin(lobby, 'p2', '', a), null);
    assert.strictEqual(lobby.players[1].name, 'Max le Grand');
    assert.strictEqual(lobby.players[2].name, 'Invité');
    api.lobbyJoin(lobby, 'p3', 'Léa', a);
    assert.notStrictEqual(lobby.players[3].teamKey, a, 'camp plein : elle va ailleurs');
    assert.strictEqual(api.lobbyPick(lobby, 'p3', a), false);
    assert.strictEqual(api.lobbyPick(lobby, 'p3', b), true);
    api.lobbyJoin(lobby, 'p4', 'Tom', b);
    api.lobbyJoin(lobby, 'p5', 'Ana', b);
    assert.strictEqual(api.lobbyJoin(lobby, 'p6', 'Sam', b), 'full', 'six humains au plus');
    api.lobbyRename(lobby, 'p4', 'Thomas');
    assert.strictEqual(lobby.players.find((player) => player.peer === 'p4').name, 'Thomas');
    assert.strictEqual(api.lobbyLeave(lobby, 'p1').name, 'Max le Grand');
    assert.strictEqual(lobby.players.length, 5);
    assert.strictEqual(api.cleanPlayerName('Un nom beaucoup trop long pour la tête'), 'Un nom beaucoup');
  },

  'campagne : chaque niveau découpé en zones (secteurs, quartiers, communes, départements, régions)': () => {
    const expected = ['secteur', 'quartier', 'commune', 'departement', 'region'];
    api.CAMPAIGN.levels.forEach((level, index) => {
      const { grid } = api.createGame({ mode: 'solo', level: index });
      assert.strictEqual(grid.zoneKind, expected[index]);
      const count = index === 4 ? 12 : api.ZONE_KINDS[expected[index]].count;
      assert.strictEqual(grid.regions.length, count);
      assert.strictEqual(new Set(grid.regions.map((region) => region.name)).size, count, 'noms tous différents');
      assert.strictEqual(grid.regions.reduce((sum, region) => sum + region.cells, 0), grid.playableCount, 'chaque case dans une zone');
      for (const region of index === 4 ? [] : grid.regions) {
        assert.ok(region.cells > grid.playableCount * 0.04, `${region.name} est minuscule`);
        assert.ok(region.cells < grid.playableCount * 0.4, `${region.name} est démesurée`);
      }
      // Même découpage à chaque partie du niveau.
      const again = api.createGame({ mode: 'solo', level: index }).grid;
      assert.strictEqual(again.regions.map((region) => region.name).join(), grid.regions.map((region) => region.name).join());
      assert.strictEqual(again.regionOf.join(), grid.regionOf.join());
    });
  },

  'campagne : au-delà de 70 % d\'un secteur, la capture suivante le donne en entier': () => {
    const game = api.createGame({ mode: 'solo', level: 0 });
    const { grid, player } = game;
    for (const entity of game.entities) if (!entity.isPlayer) Object.assign(entity, { alive: false, respawnIn: Infinity });
    const zone = 2;
    const cells = [];
    for (let index = 0; index < grid.owner.length; index++) if (grid.regionOf[index] === zone) cells.push(index);
    const target = Math.ceil(cells.length * 0.72);
    cells.slice(0, target).forEach((index) => api.setOwner(grid, index, player.landId));
    const completed = api.completeRegions(grid, player.landId, CONFIG.regionShare);
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].name, grid.regions[zone - 1].name);
    assert.ok(cells.every((index) => grid.owner[index] === player.landId), 'tout le secteur appartient au joueur');
  },

  'arènes par défaut : disques en campagne, France trois fois plus vaste en équipes': () => {
    const level = api.CAMPAIGN.levels[3];
    const solo = api.createGame({ mode: 'solo', level: 3 }).grid;
    const radius = level.arena.size / 2 - 1;
    const disc = Math.PI * radius * radius * CONFIG.resolution ** 2;
    assert.ok(Math.abs(solo.playableCount - disc) / disc < 0.01, 'l\'arène de la région est un disque');
    const middle = level.arena.size / 2;
    assert.strictEqual(solo.playable[api.cellAt(solo, middle, middle)], 1);
    assert.strictEqual(solo.playable[api.cellAt(solo, 2, 2)], 0, 'les coins du carré sont hors du disque');

    const team = api.createGame({ mode: 'team', teamKey: 'rn' });
    const reference = api.createGame({ mode: 'solo', arena: FRANCE }).grid;
    assert.strictEqual(team.grid.regions.length, 12);
    const ratio = team.grid.playableCount / reference.playableCount;
    assert.ok(ratio > 2.9 && ratio < 3.1, `rapport de surface ${ratio}`);
    for (const entity of team.entities) assert.strictEqual(team.grid.playable[api.cellAt(team.grid, entity.x, entity.y)], 1);
    checkInvariants(team);
  },

  'classement : le nombre de régions entièrement tenues par chaque camp': () => {
    const game = api.createGame({ mode: 'team', teamKey: 'lfi', arena: FRANCE });
    const { grid } = game;
    for (const land of game.lands) releaseTerritory(grid, land.id);
    assert.deepStrictEqual([...api.countCompleteRegions(grid)].filter(Boolean), []);
    const [first, second, third] = game.lands;
    for (let index = 0; index < grid.owner.length; index++) {
      const region = grid.regionOf[index];
      if (region === 1 || region === 2) api.setOwner(grid, index, first.id);      // deux régions entières
      else if (region === 3) api.setOwner(grid, index, second.id);                  // une entière
      else if (region === 4 && index % 2) api.setOwner(grid, index, third.id);      // une à moitié
    }
    const complete = api.countCompleteRegions(grid);
    assert.deepStrictEqual([complete[first.id], complete[second.id], complete[third.id]], [2, 1, 0]);
    api.setOwner(grid, grid.regionOf.indexOf(3), third.id);                         // une case perdue
    assert.strictEqual(api.countCompleteRegions(grid)[second.id], 0, 'une région entamée ne compte plus');
  },

  'second tour : le camp en tête au premier tour se qualifie face au deuxième': () => {
    const game = teamGame('lfi');
    const player = game.player;
    const byKey = (key) => game.lands.find((land) => land.key === key);
    claimDisc(game.grid, 30, 30, 20, player.landId);                     // LFI en tête, avec environ 35 % de l'arène
    const second = game.lands.find((land) => land.key !== 'lfi');
    claimDisc(game.grid, 5, 5, 4, second.id);                            // un deuxième net
    killEntity(game, player, null, 'self');
    assert.strictEqual(game.ending.won, false);
    assert.strictEqual(game.ending.qualified, true);
    assert.strictEqual(game.ending.opponent.key, second.key);
    assert.strictEqual(game.ending.opponent.name, byKey(second.key).name);
    assert.strictEqual(game.ending.round, 1);
  },

  'second tour : être en tête ne suffit pas sous le tiers de l\'arène': () => {
    const game = teamGame('lfi');
    const player = game.player;
    claimDisc(game.grid, 30, 30, 17, player.landId);                     // en tête, mais environ 25 %
    const share = game.grid.counts[player.landId] / game.grid.playableCount;
    assert.ok(share > 0.2 && share < 1 / 3, `part de départ inattendue : ${share}`);
    killEntity(game, player, null, 'self');
    assert.strictEqual(game.ending.standings[0].isPlayerLand, true, 'le joueur est bien en tête');
    assert.strictEqual(game.ending.qualified, false, 'mais sous 33,3 %, pas de second tour');
  },

  'second tour : pas de qualification si le joueur n\'est pas en tête': () => {
    const game = teamGame('rn');
    const rival = game.lands.find((land) => land.key !== 'rn');
    const rivalMember = game.entities.find((entity) => entity.landId === rival.id);
    claimDisc(game.grid, 30, 30, 22, rival.id);
    killEntity(game, game.player, null, 'self');
    assert.strictEqual(game.ending.qualified, false);
    assert.strictEqual(game.ending.opponent, null);
    const solo = soloGame();
    claimDisc(solo.grid, 30, 30, 9, solo.player.landId);
    killEntity(solo, solo.player, null, 'self');
    assert.strictEqual(solo.ending.qualified, false, 'pas de second tour en solo');
  },

  'second tour : deux camps seulement, et une victoire à 51 % au premier tour n\'en déclenche pas': () => {
    const final = createGame({ mode: 'team', teamKey: 'renaissance', round: 2, opponentKey: 'rn', arena: FRANCE });
    assert.strictEqual(final.round, 2);
    assert.strictEqual(final.lands.map((land) => land.key).sort().join(','), 'renaissance,rn');
    assert.strictEqual(final.entities.length, CONFIG.teamSize * 2);
    assert.strictEqual(final.lands[final.player.landId - 1].key, 'renaissance');
    checkInvariants(final);

    const game = teamGame('lfi');
    const player = game.player;
    claimDisc(game.grid, 30, 30, 24.5, player.landId);                   // environ 52 % de l'arène carrée
    Object.assign(player, { x: 30 + 23.5, y: 30, angle: EAST });
    drive(game, EAST, 3);
    drive(game, SOUTH, 2);
    setPlayerHeading(game, WEST);
    for (let i = 0; i < 600 && !game.ending; i++) updateGame(game, STEP);
    assert.ok(game.ending && game.ending.won, 'élu dès le premier tour');
    assert.strictEqual(game.ending.qualified, false);
  },

  'second tour : à l\'élimination du joueur, le camp en tête l\'emporte': () => {
    const setUp = (playerAhead) => {
      const game = createGame({ mode: 'team', teamKey: 'lfi', round: 2, opponentKey: 'rn' });
      for (const entity of game.entities) if (!entity.isPlayer) Object.assign(entity, { isPlayer: true, isHuman: true, respawnIn: Infinity });
      const player = game.player;
      const rival = game.lands.find((land) => land.key === 'rn');
      const rivalMember = game.entities.find((entity) => entity.landId === rival.id);
      if (playerAhead) claimDisc(game.grid, player.x, player.y, 8, player.landId);
      else claimDisc(game.grid, rivalMember.x, rivalMember.y, 8, rival.id);
      killEntity(game, player, rivalMember, 'cut');
      return game;
    };
    const ahead = setUp(true).ending;
    assert.strictEqual(ahead.won, true);
    assert.strictEqual(ahead.winnerName, 'LFI');
    assert.strictEqual(ahead.qualified, false);
    const behind = setUp(false).ending;
    assert.strictEqual(behind.won, false);
    assert.strictEqual(behind.winnerName, 'RN');
    assert.strictEqual(behind.round, 2);
  },

  'caméra : tournée, elle montre devant elle ce qui est dans sa direction': () => {
    const view = api.createProjection();
    view.configure(780, 1688, 2);
    const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
    for (const yaw of [0, Math.PI / 2, -2.2, Math.PI]) {
      view.setYaw(yaw);
      view.follow(40, 40);
      const target = view.toScreen(40, 40, 0);
      assert.ok(near(target.x, view.centerX), 'le point suivi est au milieu, en largeur');
      const ahead = view.toScreen(40 + view.forwardX * 5, 40 + view.forwardY * 5, 0);
      assert.ok(near(ahead.x, view.centerX) && ahead.y < target.y, 'ce qui est devant apparaît au-dessus');
      const right = view.toScreen(40 + view.rightX * 3, 40 + view.rightY * 3, 0);
      assert.ok(right.x > target.x, 'ce qui est à droite apparaît à droite');
      // Une ligne d'écran sous l'horizon correspond bien au sol à la distance annoncée.
      const row = view.groundRow(1200);
      const ground = view.toScreen(view.x + view.forwardX * row.ahead, view.y + view.forwardY * row.ahead, 0);
      assert.ok(near(ground.y, 1200) && near(ground.scale, row.scale, 1e-9), 'groundRow et toScreen concordent');
    }
    view.setYaw(Math.PI / 2);                               // la caméra regarde vers l'est
    assert.ok(near(view.screenToWorldAngle(-Math.PI / 2), 0), 'glisser vers le haut de l\'écran mène vers l\'est');
    view.setYaw(7 * Math.PI);
    assert.ok(Math.abs(view.yaw) <= Math.PI + 1e-9, 'l\'angle reste entre -PI et PI');
  },

  'campagne : cinq niveaux de plus en plus grands, jusqu\'à la France': () => {
    const { levels, partyFromLevel } = api.CAMPAIGN;
    assert.strictEqual(levels.length, 5);
    assert.strictEqual(levels[partyFromLevel].name, 'Ville');
    assert.strictEqual(levels[4].arena.shape, 'france');
    const identity = api.createIdentity();
    let previous = 0;
    levels.forEach((level, index) => {
      const game = api.createGame({ mode: 'solo', level: index, identity });
      assert.strictEqual(game.level, index);
      assert.strictEqual(game.entities.length, level.rivals + 1);
      assert.ok(game.grid.playableCount > previous, 'chaque niveau est plus vaste que le précédent');
      previous = game.grid.playableCount;
      for (const entity of game.entities) assert.strictEqual(game.grid.playable[api.cellAt(game.grid, entity.x, entity.y)], 1);
      checkInvariants(game);
    });
  },

  'campagne : candidats au quartier, partis à partir de la ville': () => {
    const identity = api.createIdentity();
    const quartier = api.createGame({ mode: 'solo', level: 0, identity });
    const names = (game) => game.lands.map((land) => land.name);
    assert.strictEqual(quartier.lands[quartier.player.landId - 1].name, identity.candidate.full);
    for (const rival of identity.rivals.slice(0, 3)) assert.ok(names(quartier).includes(rival.full));
    identity.party = 'Parti de la Sieste';
    const ville = api.createGame({ mode: 'solo', level: 1, identity });
    assert.strictEqual(ville.lands[ville.player.landId - 1].name, 'Parti de la Sieste');
    for (const rival of identity.rivals.slice(0, 4)) assert.ok(names(ville).includes(rival.party), `${rival.party} absent`);
    const rivalHead = ville.entities.find((entity) => !entity.isPlayer);
    assert.ok(identity.rivals.some((rival) => rival.last === rivalHead.name), 'au-dessus du cube : le nom du candidat');
    assert.ok(['gauche', 'droite', 'neutre'].includes(rivalHead.voice));
  },

  'noms : générés, tous différents, et un choix de partis pour chaque candidat': () => {
    for (let round = 0; round < 50; round++) {
      const candidates = api.generateCandidates(3);
      assert.strictEqual(new Set(candidates.map((candidate) => candidate.last)).size, 3);
      const identity = api.createIdentity();
      const everyone = [identity.candidate, ...identity.rivals];
      const rivalCount = api.CAMPAIGN.maxRivals;
      assert.strictEqual(identity.rivals.length, rivalCount);
      assert.strictEqual(new Set(everyone.map((person) => person.last)).size, rivalCount + 1, 'deux candidats portent le même nom');
      assert.strictEqual(new Set(identity.rivals.map((rival) => rival.party)).size, rivalCount, 'deux partis portent le même nom');
      const voices = identity.rivals.map((rival) => rival.voice);
      const left = voices.filter((voice) => voice === 'gauche').length;
      assert.strictEqual(left, voices.filter((voice) => voice === 'droite').length, 'sensibilités équilibrées');
      assert.strictEqual(left, Math.floor(rivalCount / 2));
      const parties = api.generatePartyNames(identity.candidate);
      assert.strictEqual(parties.length, 3);
      assert.strictEqual(new Set(parties).size, 3);
    }
  },

  'répliques : les adversaires parlent, jamais plus de trois à la fois, et neutres en équipes': () => {
    const solo = api.createGame({ mode: 'solo', level: 3 });
    const speech = api.createSpeech();
    let spoke = 0;
    for (let i = 0; i < 60 / CONFIG.maxFrameTime; i++) {
      updateGame(solo, CONFIG.maxFrameTime);
      speech.handleEvents(solo);
      solo.events.length = 0;
      speech.update(solo, CONFIG.maxFrameTime);
      assert.ok(speech.bubbles.size <= api.SPEECH.maxVisible);
      spoke += speech.bubbles.size;
    }
    assert.ok(spoke > 0, 'personne n\'a parlé en une minute');

    const team = api.createGame({ mode: 'team', teamKey: 'rn' });
    const teamSpeech = api.createSpeech();
    const neutral = new Set([...api.SPEECH_LINES.neutre, ...api.SPEECH_LINES.kill]);
    for (let i = 0; i < 90 / CONFIG.maxFrameTime; i++) {
      updateGame(team, CONFIG.maxFrameTime);
      teamSpeech.handleEvents(team);
      team.events.length = 0;
      teamSpeech.update(team, CONFIG.maxFrameTime);
      for (const bubble of teamSpeech.bubbles.values()) assert.ok(neutral.has(bubble.text), `réplique engagée en équipes : ${bubble.text}`);
    }
  },

  'difficultés : Normal, on réapparaît dans la même partie': () => {
    const game = api.createGame({ mode: 'solo', level: 1, difficulty: 'normal', arena: SQUARE });
    const player = game.player;
    const killer = game.entities.find((entity) => !entity.isPlayer);
    killEntity(game, player, killer, 'cut');
    assert.strictEqual(player.alive, false);
    assert.strictEqual(game.ending, null, 'la partie continue');
    assert.strictEqual(getEntityCells(game, player), 0, 'le territoire est perdu');
    for (let i = 0; i < 60 * (CONFIG.botRespawnDelay + 0.5) && !player.alive; i++) updateGame(game, STEP);
    assert.strictEqual(player.alive, true, 'le joueur revient');
    assert.ok(getEntityCells(game, player) > 0, 'avec un nouveau territoire');
    assert.strictEqual(player.targetAngle, null, 'et attend sa première commande');
    checkInvariants(game);
  },

  'difficultés : Chaud et Hardcore, l\'élimination met fin à la partie ; Hardcore ajoute deux adversaires': () => {
    for (const difficulty of ['chaud', 'hardcore']) {
      const game = api.createGame({ mode: 'solo', level: 2, difficulty });
      killEntity(game, game.player, null, 'self');
      assert.ok(game.ending, `${difficulty} : la partie s'arrête`);
      assert.strictEqual(game.ending.won, false);
    }
    const identity = api.createIdentity();
    identity.rivals.length = 5;                         // campagne d'une version précédente
    const normal = api.createGame({ mode: 'solo', level: 4, identity, difficulty: 'normal' });
    const hardcore = api.createGame({ mode: 'solo', level: 4, identity, difficulty: 'hardcore' });
    assert.strictEqual(normal.entities.length, api.CAMPAIGN.levels[4].rivals + 1);
    assert.strictEqual(hardcore.entities.length, api.CAMPAIGN.levels[4].rivals + 3);
    assert.strictEqual(identity.rivals.length, 7, 'les adversaires manquants sont créés');
    checkInvariants(hardcore);
  },

  'finale : dans les deux premiers avec au moins un tiers, en Normal et en Chaud seulement': () => {
    /* Le joueur reçoit les colonnes [0, playerEnd) de l'arène carrée, un
       adversaire les colonnes [playerEnd, rivalEnd). */
    const setUp = (difficulty, playerEnd, rivalEnd) => {
      const game = api.createGame({ mode: 'solo', level: 1, difficulty, arena: SQUARE });
      for (const entity of game.entities) {
        releaseTerritory(game.grid, entity.landId);
        if (!entity.isPlayer) Object.assign(entity, { isPlayer: true, isHuman: true, respawnIn: Infinity });
      }
      const rival = game.lands.find((land) => !land.isPlayerLand);
      const { grid } = game;
      for (let index = 0; index < grid.owner.length; index++) {
        const x = (index % grid.size) / grid.resolution;
        if (x < playerEnd) api.setOwner(grid, index, game.player.landId);
        else if (x < rivalEnd) api.setOwner(grid, index, rival.id);
      }
      return { game, rival };
    };
    // Chaud : éliminé en deuxième position avec 36,7 % : finale contre le premier.
    let { game, rival } = setUp('chaud', 22, 60);
    killEntity(game, game.player, null, 'self');
    assert.strictEqual(game.ending.qualified, true);
    assert.strictEqual(game.ending.opponent.key, rival.key);
    assert.ok(rival.key.startsWith('rival-'));
    // Chaud : premier, mais avec 30 % seulement : pas de finale.
    ({ game } = setUp('chaud', 18, 30));
    killEntity(game, game.player, null, 'self');
    assert.strictEqual(game.ending.standings[0].isPlayerLand, true);
    assert.strictEqual(game.ending.qualified, false);
    // Hardcore : pas de finale, même dans le duo de tête avec plus d'un tiers.
    ({ game } = setUp('hardcore', 22, 60));
    killEntity(game, game.player, null, 'self');
    assert.strictEqual(game.ending.qualified, false);
    // Normal : un adversaire atteint 51 % alors que le joueur a plus d'un tiers : finale.
    ({ game, rival } = setUp('normal', 22, 60));
    api.endGameFor(game, { won: false, reason: 'outpaced', winnerName: rival.name });
    assert.strictEqual(game.ending.qualified, true);
    assert.strictEqual(game.ending.opponent.name, rival.name);
  },

  'couleur au choix en solo : jamais partagée avec un adversaire, changeable en cours de partie': () => {
    const identity = api.createIdentity();
    const mains = (game) => game.lands.map((land) => land.colors.main);
    let game = api.createGame({ mode: 'solo', level: 2, identity });
    assert.strictEqual(game.lands[game.player.landId - 1].colors.main, api.SOLO_COLORS[0].main);
    assert.strictEqual(new Set(mains(game)).size, game.lands.length);
    identity.colorIndex = 3;
    api.recolorSoloGame(game, identity);
    assert.strictEqual(game.lands[game.player.landId - 1].colors.main, api.SOLO_COLORS[3].main);
    assert.strictEqual(game.player.colors.main, api.SOLO_COLORS[3].main);
    assert.strictEqual(new Set(mains(game)).size, game.lands.length);
    for (const entity of game.entities) assert.strictEqual(entity.colors, game.lands[entity.landId - 1].colors);
    // Le niveau suivant garde ce choix, et la répartition est la même.
    const recolored = mains(game).join();
    game = api.createGame({ mode: 'solo', level: 2, identity });
    assert.strictEqual(mains(game).join(), recolored);
  },

  'finale : deux camps seulement ; en Chaud, éliminé, le décompte départage': () => {
    const identity = api.createIdentity();
    const final = api.createGame({ mode: 'solo', level: 2, identity, difficulty: 'chaud', round: 2, opponentKey: 'rival-3' });
    assert.strictEqual(final.round, 2);
    assert.strictEqual(final.entities.length, 2);
    const opponent = final.lands.find((land) => !land.isPlayerLand);
    assert.strictEqual(opponent.key, 'rival-3');
    assert.strictEqual(opponent.name, identity.rivals[3].party);
    claimDisc(final.grid, final.player.x, final.player.y, 9, final.player.landId);
    killEntity(final, final.player, null, 'self');
    assert.strictEqual(final.ending.won, true, 'en tête au décompte : finale gagnée');
    assert.strictEqual(final.ending.qualified, false);

    const normalFinal = api.createGame({ mode: 'solo', level: 2, identity, difficulty: 'normal', round: 2, opponentKey: 'rival-0' });
    killEntity(normalFinal, normalFinal.player, null, 'self');
    assert.strictEqual(normalFinal.ending, null, 'en Normal, la finale continue jusqu\'à 51 %');
  },

  'France : cinq minutes de partie en équipes, personne ne sort du pays': () => {
    const game = api.createGame({ mode: 'team', teamKey: null, arena: FRANCE });
    const { grid } = game;
    let captures = 0;
    for (let i = 0; i < 300 / CONFIG.maxFrameTime; i++) {
      updateGame(game, CONFIG.maxFrameTime);
      captures += game.events.filter((event) => event.type === 'capture').length;
      game.events.length = 0;
      if (i % 20 === 0) {
        for (const entity of game.entities) {
          if (entity.alive) assert.strictEqual(grid.playable[api.cellAt(grid, entity.x, entity.y)], 1, 'un joueur est sorti de l\'arène');
        }
      }
      if (i % 200 === 0) checkInvariants(game);
    }
    assert.ok(captures > 300, `trop peu de captures (${captures})`);
    const owned = game.lands.reduce((sum, land) => sum + grid.counts[land.id], 0);
    assert.ok(owned <= grid.playableCount);
  },

  'dix minutes de partie entre adversaires restent cohérentes': () => {
    const { captures, deaths, reasons } = soak(createGame({ mode: 'demo' }), 600);
    assert.ok(captures > 200, `trop peu de captures (${captures})`);
    assert.ok(deaths > 0, 'aucune élimination');
    const clumsy = (reasons.wall || 0) + (reasons.self || 0);
    assert.ok(clumsy <= deaths * 0.25 + 3, `IA maladroite : ${JSON.stringify(reasons)}`);
    assert.ok(!reasons.wall, 'plus personne ne doit mourir contre un mur');
    console.log(`     ${captures} captures, éliminations : ${JSON.stringify(reasons)}`);
  },

  'dix minutes de partie en équipes restent cohérentes et équilibrées': () => {
    const totals = { LFI: 0, Renaissance: 0, RN: 0 };
    let captures = 0;
    const sizes = [];
    for (let round = 0; round < 6; round++) {
      const game = createGame({ mode: 'team', teamKey: null });
      assert.strictEqual(game.player, null);
      captures += soak(game, 100).captures;
      for (const land of game.lands) totals[land.name] += game.grid.counts[land.id];
      assert.ok(game.entities.length <= CONFIG.teamMaxSize * 3);
      sizes.push(game.entities.length);
    }
    assert.ok(captures > 200, `trop peu de captures (${captures})`);
    console.log(`     ${captures} captures ; surface cumulée par camp sur 6 parties : ${JSON.stringify(totals)} ; joueurs en fin de partie : ${sizes}`);
  },

  'K/D/A : élimination, mort, et assist pour qui a serré la victime de près': () => {
    const game = createGame({ mode: 'demo' });
    const [victim, killer, helper] = game.entities;
    for (const entity of [victim, killer, helper]) { entity.isHuman = true; entity.targetAngle = null; }
    victim.trailPoints = [{ x: victim.x, y: victim.y }];
    helper.x = victim.x + 1; helper.y = victim.y;
    api.tickStats(game, CONFIG.stats.pressureEvery + 0.01);   // relevé de la « gêne »
    killEntity(game, victim, killer, 'cut');
    assert.deepStrictEqual({ ...api.entityStats(killer) }, { kills: 1, deaths: 0, assists: 0 });
    assert.deepStrictEqual({ ...api.entityStats(victim) }, { kills: 0, deaths: 1, assists: 0 });
    assert.strictEqual(api.entityStats(helper).assists, 1);
    // Au-delà de la fenêtre, plus d'assist.
    const game2 = createGame({ mode: 'demo' });
    const [v2, k2, h2] = game2.entities;
    v2.trailPoints = [{ x: v2.x, y: v2.y }];
    h2.x = v2.x + 1; h2.y = v2.y;
    api.tickStats(game2, CONFIG.stats.pressureEvery + 0.01);
    h2.x = v2.x + 30;
    api.tickStats(game2, CONFIG.stats.assistWindow + 1);
    killEntity(game2, v2, k2, 'cut');
    assert.strictEqual(api.entityStats(h2).assists, 0);
  },

  'K/D/A : prendre du territoire à un camp compte comme une gêne': () => {
    const game = createGame({ mode: 'demo' });
    const [victim, killer, thief] = game.entities;
    const index = game.grid.owner.findIndex((owner) => owner === victim.landId);
    api.setOwner(game.grid, index, thief.landId);
    api.settleCapture(game, thief, 1);
    killEntity(game, victim, killer, 'cut');
    assert.strictEqual(api.entityStats(thief).assists, 1);
  },

  'taux par seconde : moyenne glissante sur la fenêtre': () => {
    const game = createGame({ mode: 'demo' });
    const land = game.lands[0];
    api.tickStats(game, 0);
    for (let second = 0; second < 20; second++) {
      // Un camp qui gagne exactement 1 % de l'arène par seconde.
      const cells = Math.round(game.grid.playableCount * 0.01);
      let added = 0;
      for (let index = 0; index < game.grid.owner.length && added < cells; index++) {
        if (game.grid.playable[index] && game.grid.owner[index] === 0) { api.setOwner(game.grid, index, land.id); added++; }
      }
      api.tickStats(game, 1);
    }
    const rates = api.landRates(game, land.id);
    assert.ok(Math.abs(rates.share - 0.01) < 0.001, `taux ${rates.share}`);
    assert.ok(game.stats.samples.length <= CONFIG.stats.rateWindow / CONFIG.stats.sampleEvery + 1);
  },

  'cartes : Anneau percé au centre, Archipel en îles, zones en règles Zones seulement': () => {
    const ring = api.createGrid(62, 4, api.ARENA_SHAPES.ring(62, { zones: 'quartier' }));
    assert.strictEqual(api.isInsideShape({ outlines: ring.outlines }, 31, 31), false, 'le centre de l\'anneau est vide');
    assert.strictEqual(ring.regions.length, api.ZONE_KINDS.quartier.count);
    const islands = api.ARENA_SHAPES.archipel(66, { zones: false });
    assert.strictEqual(islands.regions.length, 0);
    assert.ok(api.isInsideShape(islands, 33, 33));
    assert.strictEqual(api.matchArena({ format: 'duel', map: 'france', rules: 'normal' }).zones, false);
    const france = api.matchArena({ format: 'teams', map: 'france', rules: 'zones' });
    assert.strictEqual(api.createGrid(france.size, 4, api.ARENA_SHAPES.france(france.size, france)).regions.length, 12);
  },

  'brouillard : un camp ne voit que près des siens, et garde la carte qu\'il a vue': () => {
    const game = createGame({ mode: 'team', teamKey: api.TEAMS[0].key });
    const vision = api.createVision(game, game.player.landId);
    api.updateVision(vision, game, 0, true);
    for (const entity of game.entities) {
      const ally = entity.landId === game.player.landId;
      if (ally) assert.ok(api.isVisibleAt(vision, entity.x, entity.y));
      const far = Math.min(...game.entities.filter((other) => other.landId === game.player.landId)
        .map((other) => Math.hypot(other.x - entity.x, other.y - entity.y)));
      if (!ally && far > CONFIG.vision.headRadius + CONFIG.teamBaseRadius + CONFIG.vision.landRadius + 2) {
        assert.ok(vision.hidden.has(entity.id), 'un adversaire lointain est visible');
      }
    }
    // Ce que le camp connaît : son territoire, exactement.
    assert.strictEqual(vision.known.counts[game.player.landId], game.grid.counts[game.player.landId]);
    const enemy = game.lands.find((land) => land.id !== game.player.landId);
    assert.ok(vision.known.counts[enemy.id] < game.grid.counts[enemy.id], 'le territoire adverse lointain est connu');
    // Le radar révèle autour du joueur.
    const before = vision.visible.reduce((sum, value) => sum + value, 0);
    assert.ok(api.useRadar(game, game.player));
    for (let i = 0; i < 60; i++) updateGame(game, STEP);
    api.updateVision(vision, game, 0, true);
    assert.ok(vision.visible.reduce((sum, value) => sum + value, 0) > before);
    assert.strictEqual(api.useRadar(game, game.player), false, 'radar rechargé trop vite');
  },

  'en ligne, équipes : l\'hôte n\'envoie à un camp que ce qu\'il voit': () => {
    const [a, b] = api.TEAMS.map((team) => team.key);
    const game = api.createGame({ mode: 'online', arena: { shape: 'france', size: 101 }, humans: [{ peer: 'host', name: 'Zoé', teamKey: a }, { peer: 'p2', name: 'Max', teamKey: b }] });
    const max = game.entities.find((entity) => entity.peer === 'p2');
    const vision = api.createVision(game, max.landId);
    api.updateVision(vision, game, 0, true);
    const sync = api.createHostSync(game, vision);
    const wire = (message) => JSON.parse(JSON.stringify(message));
    const start = wire(sync.start());
    assert.strictEqual(start.fog, true);
    const mirror = api.createMirror(start, 'p2');
    for (const entity of game.entities) {
      const copy = mirror.entities[entity.id - 1];
      if (vision.hidden.has(entity.id)) {
        assert.strictEqual(copy.hidden, true);
        assert.strictEqual(copy.x, 0, 'la position d\'un adversaire caché est partie');
      }
    }
    assert.ok(vision.hidden.size > 0);
    for (const land of game.lands) assert.strictEqual(mirror.grid.counts[land.id], vision.known.counts[land.id]);
  },

  'en ligne, duel : deux joueurs, pas d\'IA, ni brouillard ni renforts': () => {
    const lobby = api.createLobby({ name: 'Zoé', teamKey: 'lfi' });
    assert.ok(api.lobbySetMatch(lobby, { format: 'duel', map: 'ring', rules: 'normal' }));
    assert.strictEqual(api.lobbyJoin(lobby, 'p2', 'Max'), null);
    assert.strictEqual(api.lobbyJoin(lobby, 'p3', 'Léa'), 'full');
    const game = api.createGame({ mode: 'online', format: 'duel', arena: api.matchArena(lobby.match), humans: lobby.players });
    assert.strictEqual(game.entities.length, 2);
    assert.strictEqual(game.lands.length, 2);
    assert.ok(game.entities.every((entity) => entity.isHuman));
    assert.strictEqual(api.useRadar(game, game.player), false);
    const mirror = api.createMirror(JSON.parse(JSON.stringify(api.createHostSync(game).start())), 'p2');
    assert.strictEqual(mirror.player.name, 'Max');
    assert.strictEqual(mirror.grid.playableCount, game.grid.playableCount);
    // Trois joueurs dans le salon : plus de duel possible.
    const crowded = api.createLobby({ name: 'A', teamKey: 'lfi' });
    api.lobbyJoin(crowded, 'p2', 'B');
    api.lobbyJoin(crowded, 'p3', 'C');
    assert.strictEqual(api.lobbySetMatch(crowded, { format: 'duel' }), false);
  },
};

let failures = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}
process.exit(failures ? 1 : 0);
