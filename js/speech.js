'use strict';

/* Répliques des adversaires : de temps en temps, un adversaire lance une
   phrase, affichée dans une bulle au-dessus de son cube. Après avoir
   éliminé quelqu'un, il savoure. Aucune dépendance au DOM : le rendu lit
   `bubbles` (identifiant du joueur -> { text, age }). */

const SPEECH = Object.freeze({
  pause: Object.freeze([16, 32]),  // secondes entre deux répliques d'un même adversaire
  duration: 3.2,                   // durée d'affichage d'une bulle
  maxVisible: 2,                   // bulles visibles en même temps, au plus
});

function createSpeech(random = Math.random) {
  const bubbles = new Map();
  const timers = new Map();

  const nextPause = () => SPEECH.pause[0] + random() * (SPEECH.pause[1] - SPEECH.pause[0]);

  /* En équipes, les camps sont de vrais partis : seulement des répliques neutres. */
  function linesFor(game, entity) {
    return SPEECH_LINES[isTeamMode(game) ? 'neutre' : entity.voice || 'neutre'];
  }

  function say(entity, lines) {
    bubbles.set(entity.id, { text: pickFrom(lines, random), age: 0 });
  }

  function reset() {
    bubbles.clear();
    timers.clear();
  }

  /* Réactions aux événements : un adversaire qui élimine quelqu'un se réjouit. */
  function handleEvents(game) {
    for (const event of game.events) {
      const killer = event.type === 'death' ? event.killer : null;
      if (!killer || killer.isHuman || !killer.alive) continue;
      // Une réaction remplace la bulle en cours, ou prend une place libre.
      if (bubbles.has(killer.id) || bubbles.size < SPEECH.maxVisible) say(killer, SPEECH_LINES.kill);
    }
  }

  function update(game, dt) {
    for (const [id, bubble] of bubbles) {
      bubble.age += dt;
      const speaker = game.entities[id - 1];
      if (bubble.age > SPEECH.duration || !speaker || !speaker.alive) bubbles.delete(id);
    }
    for (const entity of game.entities) {
      if (entity.isHuman || !entity.alive) continue;
      // Premier délai tiré au hasard, pour que tout le monde ne parle pas en même temps.
      const left = (timers.has(entity.id) ? timers.get(entity.id) : random() * SPEECH.pause[1]) - dt;
      if (left > 0) {
        timers.set(entity.id, left);
        continue;
      }
      timers.set(entity.id, nextPause());
      if (bubbles.size < SPEECH.maxVisible && !bubbles.has(entity.id)) {
        say(entity, linesFor(game, entity));
      }
    }
  }

  return { bubbles, reset, handleEvents, update };
}
