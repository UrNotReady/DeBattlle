'use strict';

/* Règles du jeu : déplacements, traînées, captures, collisions, éliminations.
   Aucune dépendance au DOM. Le rendu et l'interface lisent l'état `game`
   et la file `game.events`.

   Deux notions à distinguer :
   - un JOUEUR (entity) a une tête et une traînée qui n'appartiennent qu'à lui ;
   - un CAMP (land) possède le territoire. En solo, chaque joueur a son camp.
     En équipes, les coéquipiers partagent le même camp. */

const TRAIL_POINT_SPACING = 0.2;   // distance entre deux points du tracé affiché

function createLand(game, name, colors, key = null) {
  const land = { id: game.lands.length + 1, key, name, colors, isPlayerLand: false };
  game.lands.push(land);
  return land;
}

/* `isPlayer` : le joueur de cet appareil. `isHuman` : piloté par un humain,
   ici ou, en ligne, depuis l'appareil `peer` d'un invité ; les autres sont
   des IA. */
function createEntity(game, land, name, isPlayer, isHuman = isPlayer, peer = null) {
  const entity = {
    id: game.entities.length + 1,
    landId: land.id,
    name, isPlayer, isHuman, peer,
    colors: land.colors,
    alive: false,
    x: 0, y: 0,            // position de la tête, en unités d'arène
    angle: 0,              // cap actuel, en radians
    targetAngle: null,     // cap visé ; null = à l'arrêt, en attente d'une commande
    pathLength: 0,         // distance parcourue depuis l'apparition
    trailStart: 0,         // distance parcourue au début de la traînée en cours
    trailCells: [],        // cases de la grille couvertes par la traînée
    trailPoints: [],       // tracé de la traînée, pour l'affichage
    mind: null,            // état de l'IA
    respawnIn: 0,
    kills: 0,              // adversaires éliminés
    charges: 0,            // charges de compétence, gagnées à chaque élimination
    boostTime: 0,          // secondes de boost restantes
    dashTime: 0,           // secondes de dash restantes
    dashSpeedFactor: 1,    // multiplicateur de vitesse du dash en cours
    halted: false,         // arrêté à la demande du joueur ; repart à la prochaine commande
  };
  if (isPlayer) {
    game.player = entity;
    land.isPlayerLand = true;
  }
  game.entities.push(entity);
  return entity;
}

/* Identité d'une campagne : le candidat du joueur, son parti (choisi en
   arrivant à la ville) et ses adversaires. */
function createIdentity(random = Math.random) {
  const [candidate] = generateCandidates(1, random);
  return { candidate, party: null, rivals: generateRivals(CAMPAIGN.maxRivals, random, [candidate]) };
}

/* Une campagne commencée avec moins d'adversaires (version précédente, ou
   passage au Hardcore) reçoit ceux qui manquent. */
function ensureRivals(identity, count) {
  const missing = count - identity.rivals.length;
  if (missing > 0) identity.rivals.push(...generateRivals(missing, Math.random, [identity.candidate, ...identity.rivals]));
}

/* Solo (campagne) et démonstration : chacun pour soi. Aux premiers niveaux,
   on affronte des candidats ; ensuite, leurs partis. Au-dessus de chaque
   cube, le nom du candidat ; au classement, son nom ou son parti.
   En finale (`opponentKey`), seul l'adversaire désigné est là. */
function setUpSoloGame(game, { withPlayer, rivalCount, identity, partyNames, opponentKey = null }) {
  if (withPlayer) {
    const name = partyNames && identity.party ? identity.party : identity.candidate.full;
    createEntity(game, createLand(game, name, soloColors(identity).player, 'player'), PLAYER_NAME, true);
  }
  ensureRivals(identity, rivalCount);
  identity.rivals.slice(0, rivalCount).forEach((rival, index) => {
    const key = `rival-${index}`;
    if (opponentKey && key !== opponentKey) return;
    const land = createLand(game, partyNames ? rival.party : rival.full, rivalColors(identity, index), key);
    createEntity(game, land, rival.last, false).voice = rival.voice;
  });
}

/* Couleurs du solo : celle choisie par le joueur (`identity.colorIndex`
   dans SOLO_COLORS, la première par défaut) ; les adversaires se partagent
   les autres, dans l'ordre. */
function soloColors(identity) {
  const chosen = SOLO_COLORS[identity.colorIndex] ? identity.colorIndex : 0;
  return { player: SOLO_COLORS[chosen], rivals: SOLO_COLORS.filter((colors, index) => index !== chosen) };
}

function rivalColors(identity, index) {
  const { rivals } = soloColors(identity);
  return rivals[index % rivals.length];
}

/* Applique en cours de partie un changement de couleur du joueur : chaque
   camp reprend la couleur que lui donne l'identité. */
function recolorSoloGame(game, identity) {
  for (const land of game.lands) {
    land.colors = land.isPlayerLand ? soloColors(identity).player : rivalColors(identity, Number(land.key.slice('rival-'.length)));
  }
  for (const entity of game.entities) entity.colors = game.lands[entity.landId - 1].colors;
}

/* Équipes : des camps de même taille (les trois au premier tour, les deux
   qualifiés au second). Le joueur prend une place dans le camp choisi, les
   autres places sont tenues par l'IA. Les camps sont créés dans un ordre
   tiré au sort, pour qu'aucun ne profite de l'ordre de calcul. */
function setUpTeamGame(game, teamKey, teamKeys) {
  const teams = TEAMS.filter((team) => teamKeys.includes(team.key));
  for (let i = teams.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  for (const team of teams) {
    const land = createLand(game, team.name, team.colors, team.key);
    for (let seat = 0; seat < CONFIG.teamSize; seat++) {
      const isPlayer = team.key === teamKey && seat === 0;
      createEntity(game, land, isPlayer ? PLAYER_NAME : pickRoleName(game, land), isPlayer);
    }
  }
}

/* En ligne : les trois camps, chacun avec ses humains en premier puis des
   IA jusqu'à CONFIG.teamSize. `humans` : [{ peer, name, teamKey }], le peer
   'host' étant le joueur de l'appareil hôte. */
function setUpOnlineGame(game, humans) {
  const teams = TEAMS.map((team) => team);
  for (let i = teams.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[j]] = [teams[j], teams[i]];
  }
  for (const team of teams) {
    const land = createLand(game, team.name, team.colors, team.key);
    const members = humans.filter((human) => human.teamKey === team.key);
    for (const human of members) {
      const isHost = human.peer === 'host';
      createEntity(game, land, human.name, isHost, true, human.peer);
    }
    for (let seat = members.length; seat < CONFIG.teamSize; seat++) {
      createEntity(game, land, pickRoleName(game, land), false);
    }
  }
}

/* En ligne : un invité parti laisse son joueur à une IA. */
function handOverToBot(entity) {
  entity.isHuman = false;
  entity.peer = null;
  if (entity.alive) entity.mind = createBotMind(entity.angle);
}

/* Équipes, en local comme en ligne : trois camps, carte de France, renforts. */
function isTeamMode(game) {
  return game.mode === 'team' || game.mode === 'online';
}

/* Premier nom de rôle encore libre dans ce camp. */
function pickRoleName(game, land) {
  const taken = game.entities.filter((entity) => entity.landId === land.id).map((entity) => entity.name);
  return TEAM_ROLE_NAMES.find((name) => !taken.includes(name));
}

function getLandMembers(game, landId) {
  return game.entities.filter((entity) => entity.landId === landId);
}

/* Renfort : en équipes, chaque capture a une chance de faire venir un
   nouveau joueur IA, d'autant plus grande que la zone gagnée est vaste.
   La règle vaut pour les trois camps. */
function maybeRecruit(game, landId, gainedCells) {
  if (!isTeamMode(game)) return;
  if (getLandMembers(game, landId).length >= CONFIG.teamMaxSize) return;
  const gainedShare = gainedCells / game.grid.playableCount;
  if (Math.random() >= gainedShare * CONFIG.recruitChancePerShare) return;

  const land = game.lands[landId - 1];
  const recruit = createEntity(game, land, pickRoleName(game, land), false);
  if (spawnEntity(game, recruit, getSpawnClearance(game))) {
    game.events.push({ type: 'recruit', entity: recruit });
  } else {
    recruit.respawnIn = 1;
  }
}

/* Modes : 'solo' (un niveau de campagne), 'team' (équipes) ou 'demo'
   (adversaires seuls, derrière l'accueil).
   Solo : `level` (0 à 4), `identity` (voir createIdentity) et `difficulty`
   (voir CAMPAIGN.difficulties). `round` vaut 2 pour la finale d'un niveau,
   qui oppose le joueur au seul adversaire `opponentKey`.
   Équipes : `round` vaut 1 pour le premier tour, 2 pour le second, qui
   oppose le camp du joueur (`teamKey`) à `opponentKey`.
   En ligne ('online') : équipes sur la carte de France, avec les humains
   `humans` (voir setUpOnlineGame) ; tout le monde réapparaît, et la partie
   dure jusqu'à ce qu'un camp atteigne 51 %. */
function createGame({
  mode, teamKey = null, safeTrail = false, arena = null, round = 1, opponentKey = null,
  level = 0, identity = null, difficulty = 'chaud', humans = [],
}) {
  const levelInfo = mode === 'solo' ? CAMPAIGN.levels[level] : null;
  arena = arena || (levelInfo ? levelInfo.arena : CONFIG.arenas[mode === 'online' ? 'team' : mode]);
  const game = {
    mode,
    round,
    level,
    difficulty,
    safeTrail,             // traînée du joueur protégée : personne ne peut la couper, lui compris
    unranked: safeTrail,   // partie jouée (même un moment) traînée protégée : pas de record
    grid: createGrid(arena.size, CONFIG.resolution, ARENA_SHAPES[arena.shape](arena.size, arena)),
    lands: [],
    entities: [],
    player: null,
    projectiles: [],       // bombes en vol
    events: [],
    startCells: 0,         // taille du territoire initial du joueur, en cases
    ending: null,          // bilan de la partie, une fois perdue ou gagnée (voir endGameFor)
    over: false,
  };

  if (mode === 'online') {
    setUpOnlineGame(game, humans);
  } else if (mode === 'team') {
    setUpTeamGame(game, teamKey, round === 2 ? [teamKey, opponentKey] : TEAMS.map((team) => team.key));
  } else {
    setUpSoloGame(game, {
      withPlayer: mode === 'solo',
      rivalCount: levelInfo ? levelInfo.rivals + CAMPAIGN.difficulties[difficulty].extraRivals : CONFIG.botCount,
      identity: identity || createIdentity(),
      partyNames: levelInfo ? level >= CAMPAIGN.partyFromLevel : false,
      opponentKey: mode === 'solo' && round === 2 ? opponentKey : null,
    });
  }

  for (const entity of game.entities) {
    let clearance = getSpawnClearance(game);
    while (!spawnEntity(game, entity, clearance)) clearance--;
  }
  game.startCells = game.grid.counts[game.player ? game.player.landId : 1];
  game.events.length = 0;
  return game;
}

/* Distance visée entre un nouveau territoire et les joueurs déjà en place. */
function getSpawnClearance(game) {
  return game.grid.arenaSize * CONFIG.spawnClearanceShare;
}

function getLandCells(game, land) {
  return game.grid.counts[land.id];
}

/* Score : surface possédée, en carreaux du quadrillage. */
function cellsToScore(game, cells) {
  return Math.round(cells / (game.grid.resolution * game.grid.resolution));
}

function isHome(game, entity) {
  return ownerAt(game.grid, entity.x, entity.y) === entity.landId;
}

function areAllies(a, b) {
  return a.landId === b.landId;
}

/* Un joueur apparaît sur le territoire de son camp s'il existe encore,
   sinon il fonde un nouveau territoire à un endroit libre. */
function spawnEntity(game, entity, clearance) {
  const grid = game.grid;
  let spot = findRandomOwnedPoint(grid, entity.landId);
  if (!spot) {
    const radius = isTeamMode(game) ? CONFIG.teamBaseRadius : CONFIG.startRadius;
    const occupied = game.entities.filter((other) => other.alive);
    spot = findSpawnPoint(grid, occupied, radius, clearance);
    if (!spot) return false;
    const cells = claimDisc(grid, spot.x, spot.y, radius, entity.landId);
    game.events.push({ type: 'capture', landId: entity.landId, entity: null, cells });
  }

  entity.alive = true;
  entity.x = spot.x;
  entity.y = spot.y;
  entity.angle = entity.isHuman ? -Math.PI / 2 : Math.random() * Math.PI * 2;
  entity.targetAngle = null;
  entity.pathLength = 0;
  entity.trailCells = [];
  entity.trailPoints = [];
  entity.boostTime = 0;
  entity.dashTime = 0;
  entity.dashSpeedFactor = 1;
  entity.halted = false;
  entity.mind = entity.isHuman ? null : createBotMind(entity.angle);
  return true;
}

/* Cap demandé par le joueur. La première commande le met en mouvement ;
   `null` l'arrête sur place (contrôle manuel : plus aucune direction
   donnée ; contrôle auto : double tap). À l'arrêt, la commande suivante le
   fait repartir aussitôt dans la direction voulue, sans virage. */
function setPlayerHeading(game, angle) {
  steerHuman(game.player, angle);
}

/* Même chose pour n'importe quel humain : en ligne, l'hôte l'applique aux
   commandes reçues de ses invités. */
function steerHuman(player, angle) {
  if (!player || !player.alive) return;
  if (angle === null) {
    if (player.targetAngle !== null) player.halted = true;
    return;
  }
  if (player.targetAngle === null || player.halted) player.angle = angle;
  player.targetAngle = angle;
  player.halted = false;
}

/* Traînée protégée (option) : seul le joueur en profite. */
function hasSafeTrail(game, entity) {
  return game.safeTrail && entity === game.player;
}

/* Vitesse de croisière : un grand territoire ralentit, le boost accélère. */
function cruiseSpeed(game, entity) {
  const share = game.grid.counts[entity.landId] / game.grid.playableCount;
  const speed = CONFIG.speed * (1 - Math.min(CONFIG.maxSlowdown, share * CONFIG.slowdownPerShare));
  return entity.boostTime > 0 ? speed * CONFIG.abilities.boost.speedFactor : speed;
}

/* Vitesse actuelle : le dash l'emporte sur tout, l'arrêt immobilise. */
function getSpeed(game, entity) {
  if (entity.dashTime > 0) return cruiseSpeed(game, entity) * entity.dashSpeedFactor;
  if (entity.halted) return 0;
  return cruiseSpeed(game, entity);
}

/* Avance la partie de `dt` secondes. Le calcul est découpé en pas assez
   courts pour qu'une tête très rapide (boost, dash) ne saute par-dessus
   aucune traînée et laisse elle-même une traînée continue. */
function updateGame(game, dt) {
  if (game.over && game.ending.winnerName) return;   // partie gagnée par un camp : tout s'arrête
  let fastest = 0;
  for (const entity of game.entities) {
    if (entity.alive) fastest = Math.max(fastest, getSpeed(game, entity));
  }
  const steps = Math.max(1, Math.ceil(fastest * dt / CONFIG.maxStepDistance));
  for (let step = 0; step < steps; step++) stepGame(game, dt / steps);
}

function stepGame(game, dt) {
  for (const entity of game.entities) {
    if (!entity.alive) continue;
    tickAbilities(entity, dt);
    if (!entity.isHuman) entity.targetAngle = chooseBotHeading(game, entity, dt);
    moveEntity(game, entity, dt);
  }
  updateProjectiles(game, dt);
  resolveHeadOnCollisions(game);
  for (const entity of game.entities) {
    if (entity.alive) resolvePosition(game, entity);
    else if (!entity.isPlayer || playerRespawns(game)) waitForRespawn(game, entity, dt);
  }
  if (game.ending && !game.over) {
    game.ending.timer -= dt;
    if (game.ending.timer <= 0) game.over = true;
  }
}

/* Clôt la partie du joueur et en dresse le bilan. `winnerName` n'est donné
   que si un camp a gagné ; sinon le joueur a simplement été éliminé. En
   équipes, une élimination déclenche le décompte (voir countVotes). */
function endGameFor(game, { won, reason, killerName = null, winnerName = null }) {
  if (game.ending) return;
  const player = game.player;
  const standings = getStandings(game);
  game.ending = {
    won, reason, killerName, winnerName,
    round: game.round,
    qualified: false,      // vrai si le joueur passe au second tour
    opponent: null,        // au second tour : le camp à affronter { key, name }
    cells: game.grid.counts[player.landId],
    kills: player.kills,
    standings,
    timer: CONFIG.playerDeathDelay,
  };
  const isElimination = reason !== 'victory' && reason !== 'outpaced';
  if (game.mode === 'team' && isElimination) {
    Object.assign(game.ending, countVotes(game.round, standings, game.grid.playableCount));
  }
  if (game.mode === 'solo' && reason !== 'victory') {
    Object.assign(game.ending, soloFinalOutcome(game, standings, isElimination));
  }
}

/* Campagne, en Normal et en Chaud. Au premier tour d'un niveau, perdre en
   étant dans les deux premiers avec au moins un tiers de l'arène qualifie
   pour une finale contre l'autre camp du duo de tête. En finale, si le
   joueur est éliminé (Chaud), le camp en tête au décompte l'emporte. */
function soloFinalOutcome(game, standings, isElimination) {
  if (!CAMPAIGN.difficulties[game.difficulty].final) return {};
  if (game.round === 2) return isElimination ? countVotes(2, standings, game.grid.playableCount) : {};
  const rank = standings.findIndex((row) => row.isPlayerLand);
  const share = standings[rank].cells / game.grid.playableCount;
  if (rank > 1 || share < CONFIG.qualifyShare || standings.length < 2) return {};
  const other = standings[rank === 0 ? 1 : 0];
  return { qualified: true, opponent: { key: other.key, name: other.name } };
}

/* Décompte en équipes, quand le joueur est éliminé. Au premier tour, son
   camp passe au second tour face au deuxième s'il est strictement en tête
   ET possède au moins un tiers de l'arène. Au second tour, le camp en tête
   l'emporte (le joueur perd en cas d'égalité). */
function countVotes(round, standings, playableCount) {
  const [first, second] = standings;
  const leadsAlone = first.isPlayerLand && (!second || first.cells > second.cells);
  if (round === 1) {
    const qualifies = leadsAlone && first.cells / playableCount >= CONFIG.qualifyShare;
    return qualifies ? { qualified: true, opponent: { key: second.key, name: second.name } } : {};
  }
  const winner = leadsAlone ? first : standings.find((row) => !row.isPlayerLand);
  return { won: leadsAlone, winnerName: winner.name };
}

/* Victoire : le premier camp qui possède 51 % de l'arène gagne la partie.
   En ligne, le bilan ne dit que le camp gagnant : chaque appareil en déduit
   s'il a gagné. */
function checkVictory(game, landId) {
  if (!game.player || game.ending) return;
  if (game.grid.counts[landId] / game.grid.playableCount < CONFIG.winShare) return;
  const land = game.lands[landId - 1];
  if (game.mode === 'online') {
    game.ending = {
      online: true, winnerKey: land.key, winnerName: land.name, reason: 'victory',
      standings: getStandings(game), timer: CONFIG.playerDeathDelay,
    };
    return;
  }
  endGameFor(game, {
    won: land.isPlayerLand,
    reason: land.isPlayerLand ? 'victory' : 'outpaced',
    winnerName: land.name,
  });
}

/* En campagne Normal, le joueur éliminé réapparaît dans la même partie,
   qui continue jusqu'à ce qu'un camp atteigne 51 %. */
function playerRespawns(game) {
  if (game.ending) return false;
  return game.mode === 'online' || (game.mode === 'solo' && CAMPAIGN.difficulties[game.difficulty].respawn);
}

function waitForRespawn(game, entity, dt) {
  entity.respawnIn -= dt;
  if (entity.respawnIn > 0) return;
  if (!spawnEntity(game, entity, getSpawnClearance(game))) entity.respawnIn = 1;
}

/* Le cap rejoint le cap visé à vitesse de virage constante : c'est ce qui
   dessine les courbes. Les bords de l'arène arrêtent la tête sans la tuer :
   elle glisse le long du bord quand c'est possible. */
function moveEntity(game, entity, dt) {
  if (entity.targetAngle === null || getSpeed(game, entity) === 0) return;
  const maxTurn = CONFIG.turnRate * dt;
  const turn = angleDifference(entity.angle, entity.targetAngle);
  entity.angle += Math.max(-maxTurn, Math.min(maxTurn, turn));

  const distance = getSpeed(game, entity) * dt;
  const margin = CONFIG.headRadius;
  const limit = game.grid.arenaSize - margin;
  const fromX = entity.x;
  const fromY = entity.y;
  const toX = Math.max(margin, Math.min(limit, fromX + Math.cos(entity.angle) * distance));
  const toY = Math.max(margin, Math.min(limit, fromY + Math.sin(entity.angle) * distance));
  if (isPlayableAt(game.grid, toX, toY)) {
    entity.x = toX;
    entity.y = toY;
  } else if (isPlayableAt(game.grid, toX, fromY)) {
    entity.x = toX;
  } else if (isPlayableAt(game.grid, fromX, toY)) {
    entity.y = toY;
  }
  // Distance réellement parcourue : une tête bloquée contre un mur n'avance pas.
  entity.pathLength += Math.hypot(entity.x - fromX, entity.y - fromY);
}

/* Choc frontal : deux têtes adverses qui se foncent dessus. Les deux perdent,
   sauf celle qui se trouve sur le territoire de son camp. Une tête en
   plein dash passe au travers. */
function resolveHeadOnCollisions(game) {
  const living = game.entities.filter((entity) => entity.alive);
  const reach = CONFIG.headRadius * 2;
  for (let i = 0; i < living.length; i++) {
    for (let j = i + 1; j < living.length; j++) {
      const a = living[i];
      const b = living[j];
      if (!a.alive || !b.alive || areAllies(a, b) || isDashing(a) || isDashing(b)) continue;
      const deltaX = b.x - a.x;
      const deltaY = b.y - a.y;
      if (deltaX * deltaX + deltaY * deltaY > reach * reach) continue;
      const aGoesToB = Math.cos(a.angle) * deltaX + Math.sin(a.angle) * deltaY > 0;
      const bGoesToA = Math.cos(b.angle) * deltaX + Math.sin(b.angle) * deltaY < 0;
      if (!aGoesToB || !bGoesToA) continue;
      const aIsHome = isHome(game, a);
      const bIsHome = isHome(game, b);
      if (!aIsHome) killEntity(game, a, b, 'headon');
      if (!bIsHome) killEntity(game, b, a, 'headon');
    }
  }
}

/* Applique les règles à l'endroit où se trouve la tête : traînée touchée,
   retour au territoire ou prolongement de la traînée. */
function resolvePosition(game, entity) {
  const grid = game.grid;

  const index = cellAt(grid, entity.x, entity.y);
  const trailId = grid.trail[index];
  if (trailId === entity.id) {
    const isOldTrail = entity.pathLength - grid.trailStamp[index] > CONFIG.selfHitGap;
    if (isOldTrail && !hasSafeTrail(game, entity)) {
      killEntity(game, entity, null, 'self');
      return;
    }
  } else if (trailId !== 0) {
    const trailOwner = game.entities[trailId - 1];
    if (!areAllies(entity, trailOwner) && !hasSafeTrail(game, trailOwner)) killEntity(game, trailOwner, entity, 'cut');
  }

  if (grid.owner[index] === entity.landId) {
    if (entity.trailPoints.length) closeTrail(game, entity);
  } else {
    extendTrail(grid, entity);
  }
}

/* La traînée a une épaisseur : chaque pas couvre un disque de cases.
   Une case déjà couverte garde sa marque d'origine, ce qui permet de
   distinguer la traînée toute fraîche (sous la tête) de l'ancienne. */
function extendTrail(grid, entity) {
  const points = entity.trailPoints;
  if (points.length === 0) entity.trailStart = entity.pathLength;

  forEachCellInDisc(grid, entity.x, entity.y, CONFIG.trailRadius, (index) => {
    if (grid.owner[index] === entity.landId || grid.trail[index] !== 0) return;
    grid.trail[index] = entity.id;
    grid.trailStamp[index] = entity.pathLength;
    entity.trailCells.push(index);
  });

  const last = points[points.length - 1];
  if (!last || Math.hypot(entity.x - last.x, entity.y - last.y) >= TRAIL_POINT_SPACING) {
    points.push({ x: entity.x, y: entity.y });
  }
}

function getTrailLength(entity) {
  return entity.trailPoints.length ? entity.pathLength - entity.trailStart : 0;
}

function closeTrail(game, entity) {
  const grid = game.grid;
  clearTrail(grid, entity.id, entity.trailCells);
  const cells = captureEnclosed(grid, entity.landId, entity.trailCells);
  entity.trailCells = [];
  entity.trailPoints = [];
  game.events.push({ type: 'capture', landId: entity.landId, entity, cells });
  settleCapture(game, entity, cells.length);
}

/* Suites d'une capture, quelle qu'en soit l'origine : régions complétées,
   camps éliminés, renfort éventuel, victoire. */
function settleCapture(game, entity, gainedCells) {
  let gained = gainedCells;
  for (const region of completeRegions(game.grid, entity.landId, CONFIG.regionShare)) {
    gained += region.cells.length;
    game.events.push({ type: 'region', landId: entity.landId, name: region.name });
    game.events.push({ type: 'capture', landId: entity.landId, entity, cells: region.cells });
  }
  eliminateLandless(game, entity);
  maybeRecruit(game, entity.landId, gained);
  checkVictory(game, entity.landId);
}

/* Un camp qui n'a plus aucune case est éliminé par celui qui l'a conquis. */
function eliminateLandless(game, conqueror) {
  for (const other of game.entities) {
    if (other.alive && !areAllies(other, conqueror) && game.grid.counts[other.landId] === 0) {
      killEntity(game, other, conqueror, 'eaten');
    }
  }
}

/* Part de chaque camp, du plus grand au plus petit. */
function getStandings(game) {
  return game.lands
    .map((land) => ({ key: land.key, name: land.name, colors: land.colors, isPlayerLand: land.isPlayerLand, cells: game.grid.counts[land.id] }))
    .sort((a, b) => b.cells - a.cells);
}

/* Élimine un joueur. Le territoire de son camp n'est libéré que s'il ne
   reste aucun coéquipier en vie pour le tenir. */
function killEntity(game, victim, killer, reason) {
  if (!victim.alive) return;
  const cellsOwned = game.grid.counts[victim.landId];
  if (killer && !areAllies(killer, victim)) grantKill(killer);
  // Le bilan est dressé avant que le territoire du joueur ne soit libéré.
  // En campagne Normal, le joueur réapparaît : la partie continue.
  if (victim === game.player && !playerRespawns(game)) {
    endGameFor(game, { won: false, reason, killerName: killer ? killer.name : null });
  }

  victim.alive = false;
  clearTrail(game.grid, victim.id, victim.trailCells);
  victim.trailCells = [];
  victim.trailPoints = [];
  victim.targetAngle = null;
  victim.respawnIn = CONFIG.botRespawnDelay;

  const landHeld = game.entities.some((other) => other.alive && areAllies(other, victim));
  if (!landHeld) releaseTerritory(game.grid, victim.landId);

  game.events.push({
    type: 'death', entity: victim, killer, reason, x: victim.x, y: victim.y,
    landId: victim.landId, landReleased: !landHeld && cellsOwned > 0,
  });
}
