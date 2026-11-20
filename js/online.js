/* Partie en ligne : l'appareil hôte fait tourner la partie (game.js) et
   envoie à ses invités un instantané au départ, puis, toutes les
   CONFIG.online.sendInterval secondes, ce qui a changé. Chaque invité tient
   une copie de la partie (le « miroir »), l'affiche avec le rendu habituel
   et renvoie ses commandes à l'hôte.

   Ce fichier ne touche ni au DOM ni au réseau : net.js transporte les
   messages, qui sont des objets simples (convertis en JSON). Le canal est
   fiable et ordonné : chaque message ne contient que les changements
   depuis le précédent. */

const roundTo = (value) => Math.round(value * 100) / 100;

/* --- Côté hôte ------------------------------------------------------- */

/* Cases dont le propriétaire a changé depuis `previous`, en suites :
   [début, longueur, propriétaire, début, ...]. Met `previous` à jour. */
function diffOwners(owner, previous) {
  const runs = [];
  let index = 0;
  while (index < owner.length) {
    if (owner[index] === previous[index]) {
      index++;
      continue;
    }
    const value = owner[index];
    const start = index;
    while (index < owner.length && owner[index] === value && previous[index] !== value) {
      previous[index] = value;
      index++;
    }
    runs.push(start, index - start, value);
  }
  return runs;
}

function describeEntity(entity) {
  return { id: entity.id, landId: entity.landId, name: entity.name, isHuman: entity.isHuman, peer: entity.peer };
}

/* État d'une tête, en tableau pour alléger les messages. */
function entityState(game, entity) {
  return [
    entity.id,
    entity.alive ? 1 : 0,
    roundTo(entity.x),
    roundTo(entity.y),
    roundTo(entity.angle),
    entity.alive && entity.targetAngle !== null ? roundTo(getSpeed(game, entity)) : 0,
    entity.kills,
    entity.charges,
    roundTo(entity.boostTime),
    roundTo(entity.dashTime),
    entity.targetAngle === null ? 0 : 1,
    entity.halted ? 1 : 0,
  ];
}

/* Événements utiles à l'affichage, les joueurs remplacés par leur numéro. */
function serializeEvent(event) {
  const id = (entity) => (entity ? entity.id : 0);
  switch (event.type) {
    case 'capture': return { type: 'capture', landId: event.landId, entity: id(event.entity), count: event.cells.length };
    case 'death': return {
      type: 'death', entity: id(event.entity), killer: id(event.killer), reason: event.reason,
      x: roundTo(event.x), y: roundTo(event.y), landId: event.landId, landReleased: event.landReleased,
    };
    case 'region': return { type: 'region', landId: event.landId, name: event.name };
    case 'recruit': return { type: 'recruit', entity: id(event.entity) };
    case 'dash': return { type: 'dash', entity: id(event.entity), power: roundTo(event.power) };
    case 'splash': return { type: 'splash', entity: id(event.entity), x: roundTo(event.x), y: roundTo(event.y) };
    default: return null;
  }
}

/* Suivi de ce qui a déjà été envoyé. `collect(events)` à chaque image
   (avant que la boucle ne vide game.events) ; `tick()` produit le message
   suivant ; `start()` le tout premier, avec tout l'état. */
function createHostSync(game) {
  const sentOwner = new Uint8Array(game.grid.owner.length);
  const sentTrails = new Map();   // identifiant -> { points (le tableau envoyé), length }
  let sentEntities = 0;
  let pendingEvents = [];
  let endingSent = false;

  function trailChanges() {
    const changes = [];
    for (const entity of game.entities) {
      const points = entity.trailPoints;
      const sent = sentTrails.get(entity.id);
      const isNew = !sent || sent.points !== points || points.length < sent.length;
      const from = isNew ? 0 : sent.length;
      if (!isNew && from === points.length) continue;
      const flat = [];
      for (let i = from; i < points.length; i++) flat.push(roundTo(points[i].x), roundTo(points[i].y));
      changes.push({ id: entity.id, reset: isNew ? 1 : 0, points: flat });
      sentTrails.set(entity.id, { points, length: points.length });
    }
    return changes;
  }

  function tick() {
    const added = game.entities.slice(sentEntities).map(describeEntity);
    sentEntities = game.entities.length;
    const message = {
      type: 'state',
      cells: diffOwners(game.grid.owner, sentOwner),
      added,
      entities: game.entities.map((entity) => entityState(game, entity)),
      trails: trailChanges(),
      events: pendingEvents,
      projectiles: game.projectiles.map((bomb) => [
        bomb.entity.id, roundTo(bomb.fromX), roundTo(bomb.fromY), roundTo(bomb.toX), roundTo(bomb.toY),
        roundTo(bomb.age), bomb.duration,
      ]),
    };
    pendingEvents = [];
    if (game.ending && !endingSent) {
      message.ending = game.ending;
      endingSent = true;
    }
    return message;
  }

  return {
    collect(events) {
      for (const event of events) {
        const serialized = serializeEvent(event);
        if (serialized) pendingEvents.push(serialized);
      }
    },
    start: () => ({ type: 'start', lands: game.lands.map((land) => land.key), state: tick() }),
    tick,
  };
}

/* Commande d'un invité, appliquée par l'hôte à son joueur. `angle` : cap
   dans l'arène (l'invité a déjà tenu compte de sa caméra), ou null. */
function applyGuestCommand(game, peer, command) {
  const entity = game.entities.find((item) => item.peer === peer && item.isHuman);
  if (!entity || game.ending) return;
  if (command.type === 'steer') {
    steerHuman(entity, typeof command.angle === 'number' ? command.angle : null);
  } else if (command.type === 'ability' && entity.alive) {
    if (command.kind === 'boost') useBoost(game, entity);
    else if (command.kind === 'bomb') useBomb(game, entity);
    else if (command.kind === 'dash' && typeof command.angle === 'number') useDash(game, entity, command.angle);
  }
}

/* --- Côté invité ------------------------------------------------------ */

/* Crée le miroir à partir du message 'start'. `peer` : identifiant de cet
   invité, pour reconnaître son propre joueur. */
function createMirror(start, peer) {
  const arena = CONFIG.arenas.team;
  const game = {
    mode: 'online',
    mirror: true,
    round: 1,
    grid: createGrid(arena.size, CONFIG.resolution, ARENA_SHAPES[arena.shape](arena.size, arena)),
    lands: [],
    entities: [],
    player: null,
    projectiles: [],
    events: [],
    startCells: 0,
    ending: null,
    over: false,
    safeTrail: false,
    unranked: true,
    peer,
  };
  for (const key of start.lands) {
    const team = TEAMS.find((item) => item.key === key);
    createLand(game, team.name, team.colors, team.key);
  }
  applyState(game, start.state);
  return game;
}

function addMirrorEntity(game, description) {
  const land = game.lands[description.landId - 1];
  const entity = createEntity(game, land, description.name, description.peer === game.peer, description.isHuman, description.peer);
  Object.assign(entity, { netX: 0, netY: 0, netAngle: 0, netSpeed: 0, netAge: 0 });
  return entity;
}

/* Applique un message 'state' de l'hôte au miroir. */
function applyState(game, state) {
  const { grid } = game;
  for (let i = 0; i < state.cells.length; i += 3) {
    const [start, length, owner] = [state.cells[i], state.cells[i + 1], state.cells[i + 2]];
    for (let index = start; index < start + length; index++) setOwner(grid, index, owner);
  }
  for (const description of state.added) addMirrorEntity(game, description);

  for (const [id, alive, x, y, angle, speed, kills, charges, boostTime, dashTime, moving, halted] of state.entities) {
    const entity = game.entities[id - 1];
    const respawned = alive && !entity.alive;
    Object.assign(entity, {
      alive: Boolean(alive), netX: x, netY: y, netAngle: angle, netSpeed: speed, netAge: 0,
      kills, charges, boostTime, dashTime, halted: Boolean(halted),
      targetAngle: moving ? angle : null,
    });
    // Une tête qui apparaît, ou qui a fait un grand saut, est posée directement.
    if (respawned || Math.hypot(entity.x - x, entity.y - y) > 4) {
      entity.x = x;
      entity.y = y;
      entity.angle = angle;
    }
  }

  for (const { id, reset, points } of state.trails) {
    const entity = game.entities[id - 1];
    if (reset) entity.trailPoints = [];
    for (let i = 0; i < points.length; i += 2) entity.trailPoints.push({ x: points[i], y: points[i + 1] });
  }

  const byId = (id) => (id ? game.entities[id - 1] : null);
  for (const event of state.events) {
    const restored = { ...event, entity: byId(event.entity) };
    if (event.type === 'death') restored.killer = byId(event.killer);
    if (event.type === 'capture') restored.cells = { length: event.count };
    game.events.push(restored);
  }

  game.projectiles = state.projectiles.map(([id, fromX, fromY, toX, toY, age, duration]) => ({
    entity: game.entities[id - 1], fromX, fromY, toX, toY, age, duration,
  }));

  if (state.ending) game.ending = state.ending;
}

/* Entre deux messages, chaque tête glisse vers sa position prévue
   (dernière position reçue, prolongée selon son cap et sa vitesse) : le
   mouvement reste fluide malgré l'écart entre les messages. */
function updateMirror(game, dt) {
  const { smoothing, extrapolateMax } = CONFIG.online;
  const blend = Math.min(1, smoothing * dt);
  for (const entity of game.entities) {
    if (!entity.alive) continue;
    entity.netAge += dt;
    const ahead = entity.netSpeed * Math.min(entity.netAge, extrapolateMax);
    const targetX = entity.netX + Math.cos(entity.netAngle) * ahead;
    const targetY = entity.netY + Math.sin(entity.netAngle) * ahead;
    entity.x += (targetX - entity.x) * blend;
    entity.y += (targetY - entity.y) * blend;
    const turn = Math.atan2(Math.sin(entity.netAngle - entity.angle), Math.cos(entity.netAngle - entity.angle));
    entity.angle += turn * blend;
  }
  for (const bomb of game.projectiles) bomb.age = Math.min(bomb.duration, bomb.age + dt);
  // Comme chez l'hôte : le bilan s'affiche un court instant après la fin.
  if (game.ending && !game.over) {
    game.ending.timer -= dt;
    if (game.ending.timer <= 0) game.over = true;
  }
}

/* Le camp de cet appareil a-t-il gagné ? */
function isOnlineWin(game) {
  return Boolean(game.ending && game.player && game.lands[game.player.landId - 1].key === game.ending.winnerKey);
}

/* --- Salon ----------------------------------------------------------- */

/* Le salon, tenu par l'hôte : les joueurs humains, leur nom et leur camp.
   `players` : [{ peer, name, teamKey, isHost }], l'hôte en premier. */
function createLobby(host) {
  return { players: [{ ...host, peer: 'host', isHost: true }] };
}

/* Nom tapé par un joueur : espaces resserrés, 16 caractères au plus. */
function cleanPlayerName(text, fallback = 'Invité') {
  const name = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  return name || fallback;
}

function teamCount(lobby, teamKey) {
  return lobby.players.filter((player) => player.teamKey === teamKey).length;
}

/* Camp le moins rempli, pour un joueur dont le choix est complet. */
function emptiestTeam(lobby) {
  return TEAMS.map((team) => team.key).sort((a, b) => teamCount(lobby, a) - teamCount(lobby, b))[0];
}

/* Un invité arrive. Renvoie null, ou la raison du refus : 'full'. */
function lobbyJoin(lobby, peer, name, teamKey) {
  if (lobby.players.some((player) => player.peer === peer)) return null;
  if (lobby.players.length >= CONFIG.online.maxHumans) return 'full';
  const wanted = TEAMS.some((team) => team.key === teamKey) && teamCount(lobby, teamKey) < CONFIG.online.maxPerTeam;
  lobby.players.push({ peer, name: cleanPlayerName(name), teamKey: wanted ? teamKey : emptiestTeam(lobby), isHost: false });
  return null;
}

/* Changement de camp, s'il y reste une place. Renvoie vrai si c'est fait. */
function lobbyPick(lobby, peer, teamKey) {
  const player = lobby.players.find((item) => item.peer === peer);
  if (!player || !TEAMS.some((team) => team.key === teamKey)) return false;
  if (player.teamKey !== teamKey && teamCount(lobby, teamKey) >= CONFIG.online.maxPerTeam) return false;
  player.teamKey = teamKey;
  return true;
}

function lobbyRename(lobby, peer, name) {
  const player = lobby.players.find((item) => item.peer === peer);
  if (player) player.name = cleanPlayerName(name, player.name);
}

function lobbyLeave(lobby, peer) {
  const player = lobby.players.find((item) => item.peer === peer);
  lobby.players = lobby.players.filter((item) => item.peer !== peer);
  return player || null;
}
