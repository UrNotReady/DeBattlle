'use strict';

/* Relief du terrain : de petites collines douces. Le relief est rendu par
   l'éclairage du sol (voir ground.js) : les pentes tournées vers la lumière
   sont claires, les autres bleutées. Il ne change ni les déplacements ni
   les règles. */

const TERRAIN = Object.freeze({
  amplitude: 0.55,        // hauteur des ondulations, en unités (le relief varie d'environ ± 1)
});

function terrainHeight(x, y) {
  return TERRAIN.amplitude * (
    Math.sin(x * 0.23 + 1.3) * Math.cos(y * 0.19 - 0.6) +
    0.55 * Math.sin(x * 0.11 - y * 0.27 + 2.1) +
    0.35 * Math.cos(x * 0.47 + y * 0.41)
  );
}
