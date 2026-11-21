'use strict';

/* Statistiques d'une partie : éliminations (K), morts (D) et assists (A)
   de chaque joueur, puis taux par seconde de chaque camp.

   Assist : quand un joueur est éliminé, chaque adversaire autre que
   l'auteur qui l'a « gêné » dans les CONFIG.stats.assistWindow dernières
   secondes en gagne un. Gêner, c'est prendre du territoire à son camp, ou
   le serrer de près pendant qu'il est hors de chez lui (à moins de
   pressureRadius unités de sa tête ou de sa traînée).

   Taux par seconde : une fois par seconde, on relève pour chaque camp sa
   surface, ses éliminations et ses morts dans un petit tampon. Le taux est
   (valeur actuelle - valeur la plus ancienne du tampon) / temps écoulé
   entre les deux : une moyenne glissante sur rateWindow secondes, assez
   longue pour ne pas sauter à chaque capture, assez courte pour suivre le
   rythme. En début de partie, la fenêtre se limite au temps écoulé.

   Aucune dépendance au DOM. */

function createStats() {
  return {
    clock: 0,
    pressureClock: 0,
    sampleClock: 0,
    harm: new Map(),     // victime -> Map(auteur de la gêne -> moment)
    samples: [],         // [{ time, lands: [{ cells, kills, deaths }] }], du plus ancien au plus récent
  };
}

/* K / D / A d'un joueur, créés à la volée. */
function entityStats(entity) {
  if (!entity.stats) entity.stats = { kills: 0, deaths: 0, assists: 0 };
  return entity.stats;
}

function noteHarm(game, victim, attacker) {
  const { stats } = game;
  if (!stats || victim === attacker || areAllies(victim, attacker)) return;
  if (!stats.harm.has(victim.id)) stats.harm.set(victim.id, new Map());
  stats.harm.get(victim.id).set(attacker.id, stats.clock);
}

/* Une capture a pris des cases à d'autres camps (grid.stolen) : tous
   leurs joueurs sont « gênés » par l'auteur de la capture. */
function noteSteals(game, attacker) {
  const { stolen } = game.grid;
  if (!stolen || stolen.size === 0) return;
  for (const landId of stolen.keys()) {
    for (const victim of game.entities) {
      if (victim.landId === landId && victim.alive) noteHarm(game, victim, attacker);
    }
  }
  stolen.clear();
}

/* Élimination : D pour la victime, K pour l'auteur s'il est adversaire,
   A pour les autres adversaires qui l'ont gênée récemment. */
function recordDeath(game, victim, killer) {
  entityStats(victim).deaths++;
  if (killer && killer !== victim && !areAllies(killer, victim)) entityStats(killer).kills++;
  const { stats } = game;
  if (!stats) return;
  const harm = stats.harm.get(victim.id);
  if (harm) {
    for (const [attackerId, time] of harm) {
      const attacker = game.entities[attackerId - 1];
      if (!attacker || attacker === killer || areAllies(attacker, victim)) continue;
      if (stats.clock - time <= CONFIG.stats.assistWindow) entityStats(attacker).assists++;
    }
  }
  stats.harm.delete(victim.id);
}

/* Distance d'un point à la tête ou à la traînée d'un joueur. La traînée
   est échantillonnée un point sur quatre : assez fin pour 4 unités. */
function distanceToRun(entity, x, y) {
  let best = Math.hypot(entity.x - x, entity.y - y);
  const points = entity.trailPoints;
  for (let i = 0; i < points.length; i += 4) best = Math.min(best, Math.hypot(points[i].x - x, points[i].y - y));
  return best;
}

function notePressure(game) {
  const radius = CONFIG.stats.pressureRadius;
  for (const victim of game.entities) {
    if (!victim.alive || victim.trailPoints.length === 0) continue;
    for (const attacker of game.entities) {
      if (!attacker.alive || areAllies(attacker, victim)) continue;
      if (distanceToRun(victim, attacker.x, attacker.y) <= radius) noteHarm(game, victim, attacker);
    }
  }
}

/* Relevé de chaque camp : surface, éliminations et morts de ses joueurs. */
function sampleLands(game) {
  const lands = game.lands.map((land) => ({ cells: game.grid.counts[land.id], kills: 0, deaths: 0 }));
  for (const entity of game.entities) {
    const row = lands[entity.landId - 1];
    const stats = entityStats(entity);
    row.kills += stats.kills;
    row.deaths += stats.deaths;
  }
  return lands;
}

/* À chaque image. `samplesOnly` : sur un miroir en ligne, l'hôte fait les
   comptes ; on ne tient que les relevés des taux. */
function tickStats(game, dt, samplesOnly = false) {
  if (!game.stats) game.stats = createStats();
  const stats = game.stats;
  stats.clock += dt;
  if (!samplesOnly) {
    stats.pressureClock += dt;
    if (stats.pressureClock >= CONFIG.stats.pressureEvery) {
      stats.pressureClock = 0;
      notePressure(game);
    }
  }
  stats.sampleClock -= dt;
  if (stats.sampleClock > 0) return;
  stats.sampleClock = CONFIG.stats.sampleEvery;
  stats.samples.push({ time: stats.clock, lands: sampleLands(game) });
  const keep = Math.ceil(CONFIG.stats.rateWindow / CONFIG.stats.sampleEvery) + 1;
  if (stats.samples.length > keep) stats.samples.splice(0, stats.samples.length - keep);
}

/* Taux par seconde d'un camp, sur la fenêtre glissante : part d'arène
   (en fraction, 0,01 = 1 %), éliminations et morts. Zéro tant qu'on n'a
   pas deux relevés. */
function landRates(game, landId) {
  const samples = game.stats ? game.stats.samples : [];
  if (samples.length < 2) return { share: 0, kills: 0, deaths: 0 };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.time - first.time || 1;
  const from = first.lands[landId - 1] || { cells: 0, kills: 0, deaths: 0 };
  const to = last.lands[landId - 1] || from;
  return {
    share: (to.cells - from.cells) / game.grid.playableCount / span,
    kills: (to.kills - from.kills) / span,
    deaths: (to.deaths - from.deaths) / span,
  };
}

/* Lissage d'affichage : la valeur affichée glisse vers la valeur visée
   (moyenne mobile exponentielle, ~0,3 s), pour que les chiffres ne
   sautent pas d'un relevé à l'autre. */
function easeValue(shown, target, dt, time = 0.3) {
  return shown + (target - shown) * (1 - Math.exp(-dt / time));
}
