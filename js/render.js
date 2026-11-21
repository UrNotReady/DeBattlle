'use strict';

/* Rendu Canvas en 3D. Le monde est projeté en perspective (voir
   projection.js) puis dessiné du fond vers l'avant : ciel, eau, sol,
   flancs des territoires, dessus des territoires, effets au sol,
   traînées, têtes, brume, textes.

   Tous les territoires ont la même hauteur et la caméra est au-dessus :
   dessiner toutes les tranches puis tous les dessus suffit à obtenir les
   bons recouvrements, sans tri. */

const RENDER = Object.freeze({
  slabHeight: 0.85,       // épaisseur des blocs de territoire, en unités
  platformDepth: 4.5,     // épaisseur du plateau qui flotte dans le vide, en unités
  lightDirection: Object.freeze({ x: 0.99, y: 0.15 }),   // la lumière vient de la droite
  wallTones: 5,           // nombre de nuances d'un flanc, de l'ombre à la lumière
  wallOverlap: 0.06,      // les flancs montent un peu sous le dessus, pour un bloc sans joint
  /* Bord bombé des territoires : les flancs s'arrêtent `radius` sous le
     dessus, puis `steps` couches de plus en plus hautes et en retrait
     suivent un quart de cercle jusqu'au dessus. Toutes ont la couleur du
     dessus ; seul l'anneau extérieur est ombré de `rimShade`. Distances en unités. */
  bevel: Object.freeze({ radius: 0.4, steps: 3, rimShade: 0.07 }),
  warmShade: '#3b2418',   // les ombres des blocs tirent vers un brun chaud plutôt que vers le noir
  groundBand: 2,          // le sol est dessiné par bandes horizontales de 2 pixels
  slabShadow: Object.freeze({ x: -0.55, y: 0.18, alpha: 0.13 }),
  sparkle: Object.freeze({ spacing: 2.4, speed: 2.1, threshold: 0.86, size: 0.16 }),
  trailWidth: 0.5,
  trailHeight: 0.22,
  headSize: 0.8,
  headHeight: 0.7,
  /* Arrondis de la tête : rayon des arêtes verticales (`corner`) et du
     bord du dessus (`top`) ; `cornerSteps` : segments par quart de cercle. */
  headRound: Object.freeze({ corner: 0.22, top: 0.15, cornerSteps: 4 }),
  /* La tête suit le relief comme un flotteur : un ressort amorti (raideur,
     amortissement) la ramène à la surface. En entrant dans un territoire,
     elle s'y enfonce puis remonte doucement (`rise`) ; en sortant, elle
     retombe plus vite (`fall`) et rebondit un peu sur la banquise. */
  float: Object.freeze({
    rise: Object.freeze({ stiffness: 45, damping: 7.5 }),
    fall: Object.freeze({ stiffness: 120, damping: 16 }),
    bounce: 0.25, step: 1 / 120, waterAlpha: 0.86,
  }),
  shadowOffset: Object.freeze({ x: -0.35, y: 0.12 }),
  fogDepth: 0.17,         // épaisseur de la brume sous l'horizon, en fraction d'écran
  /* Secousse de l'écran : amplitude en pixels CSS, amortie en `decay` s. */
  shake: Object.freeze({ playerDeath: 14, playerKill: 8, nearbyDeath: 4, decay: 0.35, radius: 16 }),
  freeCameraSpeed: 34,    // caméra libre au clavier, en unités par seconde (à zoom 1)
  fogLift: 0.06,          // le brouillard est posé juste au-dessus des territoires
  beacon: Object.freeze({ height: 6, width: 0.35 }),   // tour de vision : un faisceau au-dessus de la région
  cameraStiffness: 9,
  minFlashCells: 12,      // en dessous, une capture ne déclenche pas d'éclair
  minPopupShare: 0.0005,  // en dessous de 0,05 % d'arène gagnée, pas de pop-up
  bubble: Object.freeze({ appear: 0.18, fade: 0.35, opacity: 0.78 }),   // bulles de dialogue : durées en secondes, opacité du fond
  popup: Object.freeze({ duration: 1.3, startLift: 70, rise: 46, fadeTime: 0.4, stackGap: 24 }),   // en pixels CSS
  /* Onde de choc au départ d'un dash : son rayon final va de `growth` à
     `growth + growthPerPower` selon la puissance du dash. */
  dashWave: Object.freeze({ duration: 0.5, growth: 1.8, growthPerPower: 3.2, alpha: 0.9, width: 3, points: 28 }),
  streakEvery: 0.035,     // secondes entre deux éclats laissés par un boost
  aim: Object.freeze({ ring: 1.15, dotEvery: 0.9, head: 1, headWidth: 0.6 }),   // flèche de visée du dash, en unités
  bombArc: 4,             // hauteur de la cloche décrite par une bombe, en unités
  captureFlash: Object.freeze({ duration: 0.45, alpha: 0.75 }),
  releaseFade: Object.freeze({ duration: 0.5, alpha: 0.6 }),
  burst: Object.freeze({ count: 14, duration: 0.6, speed: 7 }),
});

/* Paliers de l'arrondi, du bord du flanc (palier 0) au dessus (dernier) :
   retrait et hauteur gagnée. */
const BEVEL_PROFILE = Object.freeze(Array.from({ length: RENDER.bevel.steps + 1 }, (_, step) => {
  const angle = step / RENDER.bevel.steps * Math.PI / 2;
  const { radius } = RENDER.bevel;
  return Object.freeze({ inset: radius * (1 - Math.cos(angle)), rise: radius * Math.sin(angle) });
}));

function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = createProjection();
  const camera = { x: 0, y: 0 };
  let territoryLoops = new Map();   // identifiant du camp -> boucles de contour [x0, y0, x1, y1, ...]
  let territoryInsets = new Map();  // identifiant du camp -> mêmes boucles, en retrait (bord bombé)
  let arenaLoops = [];              // boucles du contour de l'arène
  let arenaRule = 'evenodd';        // règle de remplissage : pair-impair (trous), ou non nulle (îles)
  let platformNormals = [];         // normale extérieure de chaque côté du plateau, ou null (côté intérieur)
  let theme = THEMES.night;
  let freeCamera = null;            // caméra libre : { x, y }, ou null quand elle suit le joueur
  let shake = 0;                    // amplitude de la secousse en cours, en pixels CSS
  let vision = null;                // brouillard de la partie affichée (voir vision.js), ou null
  const fog = { canvas: null, small: null, version: -1 };   // texture du brouillard, vue du dessus
  const alignedFog = { canvas: null, yaw: null, source: null, version: -1 };
  let groundTexture = null;         // texture du sol, vue du dessus
  let groundTextureGrid = null;     // forme d'arène pour laquelle elle a été peinte
  const alignedGround = { canvas: null, yaw: null, source: null };   // la même, tournée dans l'axe de la caméra
  let yawResetting = false;         // la caméra revient vers le nord
  let sparkles = [];                // points du sol qui peuvent scintiller
  let clock = 0;                    // temps écoulé, pour les scintillements
  const tonesByColor = new Map();   // nuances dérivées de la couleur d'un camp
  let flashes = [];                 // éclairs de capture
  let fades = [];                   // fondus de territoires libérés
  let particles = [];
  let waves = [];                   // ondes de choc des dashs
  let popups = [];                  // textes brefs : « Vote +1,2 % », renfort
  let streakClock = 0;
  let cliffTones = wallTones(theme.cliff.shade, theme.cliff.lit);
  let fogStrip = null;              // brume du lointain

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    view.configure(canvas.width, canvas.height, dpr);
    prepareBackdrop();
  }

  /* --- Caméra ------------------------------------------------------- */

  function cameraTarget(game) {
    if (freeCamera) return freeCamera;
    const focus = game.player || game.entities.find((entity) => entity.alive);
    return focus && focus.alive ? focus : null;
  }

  /* Points répartis sur l'arène, chacun avec son rythme : ceux qui se
     trouvent sur un territoire scintillent tour à tour. */
  function buildSparkles(arenaSize) {
    const { spacing } = RENDER.sparkle;
    const points = [];
    for (let y = spacing / 2; y < arenaSize; y += spacing) {
      for (let x = spacing / 2; x < arenaSize; x += spacing) {
        points.push({
          x: x + (Math.random() - 0.5) * spacing * 0.8,
          y: y + (Math.random() - 0.5) * spacing * 0.8,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    return points;
  }

  function reset(game) {
    floats = new Map();
    territoryLoops = new Map();
    territoryInsets = new Map();
    const size = game.grid.arenaSize;
    arenaLoops = game.grid.outlines || [[0, 0, size, 0, size, size, 0, size]];
    arenaRule = game.grid.union ? 'nonzero' : 'evenodd';
    platformNormals = buildPlatformNormals(game.grid);
    // La texture ne dépend que de la forme de l'arène : on la garde d'une partie à l'autre.
    const sameShape = groundTextureGrid && groundTextureGrid.zoneKind === game.grid.zoneKind &&
      groundTextureGrid.playableCount === game.grid.playableCount && groundTextureGrid.arenaSize === game.grid.arenaSize &&
      groundTextureGrid.regions.length === game.grid.regions.length;
    if (!sameShape || !groundTexture) groundTexture = buildGroundTexture(game.grid, theme.ground);
    groundTextureGrid = game.grid;
    // Dézoom maximal : tout le plateau tient à l'écran.
    view.setMinZoom(CAMERA.distance / (size * 1.3));
    freeCamera = null;
    shake = 0;
    fog.version = -1;
    alignedFog.version = -1;
    sparkles = buildSparkles(game.grid.arenaSize);
    flashes = [];
    fades = [];
    particles = [];
    waves = [];
    popups = [];
    const target = cameraTarget(game);
    if (target) {
      camera.x = target.x;
      camera.y = target.y;
    }
  }

  function updateCamera(game, dt) {
    if (yawResetting) {
      const yaw = view.yaw * Math.exp(-dt * 9);
      yawResetting = Math.abs(yaw) > 0.003;
      view.setYaw(yawResetting ? yaw : 0);
    }
    const target = cameraTarget(game);
    if (target) {
      const blend = freeCamera ? 1 - Math.exp(-dt * 20) : 1 - Math.exp(-dt * RENDER.cameraStiffness);
      camera.x += (target.x - camera.x) * blend;
      camera.y += (target.y - camera.y) * blend;
    }
    view.follow(camera.x, camera.y);
  }

  function zoomBy(factor) {
    view.zoomBy(factor);
  }

  /* --- Caméra libre --------------------------------------------------- */

  /* La caméra quitte le joueur et se promène sur l'arène ; appelée de
     nouveau, elle revient sur lui. Renvoie vrai si elle est libre. */
  function toggleFreeCamera() {
    freeCamera = freeCamera ? null : { x: camera.x, y: camera.y };
    return Boolean(freeCamera);
  }

  const isFreeCamera = () => Boolean(freeCamera);

  function clampFreeCamera() {
    const size = groundTextureGrid ? groundTextureGrid.arenaSize : 100;
    freeCamera.x = Math.max(0, Math.min(size, freeCamera.x));
    freeCamera.y = Math.max(0, Math.min(size, freeCamera.y));
  }

  /* Glisser : le sol suit le doigt (ou la souris), de (dx, dy) pixels CSS. */
  function panBy(dx, dy) {
    if (!freeCamera) return;
    const scale = view.focal / (CAMERA.distance / view.zoom) / view.dpr;   // pixels CSS par unité, au centre
    const side = -dx / scale;
    const ahead = dy / scale / Math.max(0.3, Math.sin(view.pitch + CAMERA.aimOffset));
    freeCamera.x += view.rightX * side + view.forwardX * ahead;
    freeCamera.y += view.rightY * side + view.forwardY * ahead;
    clampFreeCamera();
  }

  /* Au clavier : la caméra file dans une direction de l'écran. */
  function panToward(screenAngle, dt) {
    if (!freeCamera) return;
    const distance = RENDER.freeCameraSpeed / view.zoom * dt;
    const worldAngle = view.screenToWorldAngle(screenAngle);
    freeCamera.x += Math.cos(worldAngle) * distance;
    freeCamera.y += Math.sin(worldAngle) * distance;
    clampFreeCamera();
  }

  function addShake(amount) {
    shake = Math.max(shake, amount);
  }

  /* --- Thème ---------------------------------------------------------- */

  function setTheme(next) {
    theme = next;
    cliffTones = wallTones(theme.cliff.shade, theme.cliff.lit);
    if (groundTextureGrid) groundTexture = buildGroundTexture(groundTextureGrid, theme.ground);
    alignedGround.source = null;
    fog.version = -1;
    prepareBackdrop();
  }

  /* Normale extérieure de chaque côté du plateau : le côté du segment où
     l'on sort de l'arène. Un côté qui a l'arène des deux côtés (bout d'un
     pont dans une île) n'a pas de flanc : null. */
  function buildPlatformNormals(grid) {
    const shape = { outlines: grid.outlines, union: grid.union };
    return arenaLoops.map((loop) => {
      const count = loop.length / 2;
      const normals = [];
      for (let i = 0; i < count; i++) {
        const from = (i - 1 + count) % count;
        const dx = loop[i * 2] - loop[from * 2];
        const dy = loop[i * 2 + 1] - loop[from * 2 + 1];
        const length = Math.hypot(dx, dy) || 1;
        const normalX = dy / length;
        const normalY = -dx / length;
        const middleX = (loop[i * 2] + loop[from * 2]) / 2;
        const middleY = (loop[i * 2 + 1] + loop[from * 2 + 1]) / 2;
        const probe = 0.15;
        const ahead = isInsideShape(shape, middleX + normalX * probe, middleY + normalY * probe);
        const behind = isInsideShape(shape, middleX - normalX * probe, middleY - normalY * probe);
        if (ahead === behind) normals.push(null);
        else normals.push(ahead ? { x: -normalX, y: -normalY } : { x: normalX, y: normalY });
      }
      return normals;
    });
  }

  /* Incline la caméra. Le ciel et la brume dépendent de la hauteur de
     l'horizon : ils sont repeints quand l'angle change. */
  function tiltBy(angle) {
    if (view.tiltBy(angle)) prepareBackdrop();
  }

  /* Fait pivoter la caméra autour du joueur. */
  function rotateBy(angle) {
    yawResetting = false;
    view.setYaw(view.yaw + angle);
  }

  /* Ramène la caméra vers le nord, en douceur (voir updateCamera). */
  function resetYaw() {
    yawResetting = view.yaw !== 0;
  }

  const getYaw = () => view.yaw;
  const toWorldAngle = (screenAngle) => view.screenToWorldAngle(screenAngle);

  /* Position à l'écran (pixels CSS) d'un point de l'arène, ou null s'il
     est hors de vue. Sert à diriger le joueur vers la souris. */
  function toCssPoint(x, y) {
    const point = view.toScreen(x, y, RENDER.slabHeight);
    return point ? { x: point.x / view.dpr, y: point.y / view.dpr } : null;
  }

  /* Hauteur de la surface sous un point : le dessus d'un bloc s'il y a un
     territoire, le sol sinon. */
  function groundHeight(grid, x, y) {
    return ownerAt(grid, x, y) !== 0 ? RENDER.slabHeight : 0;
  }

  /* --- Flottaison des têtes ------------------------------------------ */

  /* Hauteur affichée de chaque tête : { z, velocity, x, y } par joueur. Une
     tête qui réapparaît (ou fait un grand saut) est posée directement. */
  let floats = new Map();

  function updateFloats(game, dt) {
    const { bounce, step } = RENDER.float;
    for (const entity of game.entities) {
      if (!entity.alive) {
        floats.delete(entity.id);
        continue;
      }
      const target = groundHeight(game.grid, entity.x, entity.y);
      let state = floats.get(entity.id);
      if (!state || Math.hypot(entity.x - state.x, entity.y - state.y) > 3) {
        state = { z: target, velocity: 0, x: entity.x, y: entity.y };
        floats.set(entity.id, state);
      }
      const { stiffness, damping } = target < state.z ? RENDER.float.fall : RENDER.float.rise;
      // Petits pas fixes : le ressort reste stable même si une image tarde.
      for (let remaining = dt; remaining > 0; remaining -= step) {
        const slice = Math.min(step, remaining);
        state.velocity += (stiffness * (target - state.z) - damping * state.velocity) * slice;
        state.z += state.velocity * slice;
      }
      if (state.z < 0) {
        state.z = 0;
        state.velocity *= -bounce;
      }
      state.x = entity.x;
      state.y = entity.y;
    }
  }

  function headBase(grid, entity) {
    const state = floats.get(entity.id);
    return state ? state.z : groundHeight(grid, entity.x, entity.y);
  }

  /* --- Couleurs ------------------------------------------------------ */

  function mixColors(from, to, amount) {
    const channel = (start) => {
      const a = parseInt(from.slice(start, start + 2), 16);
      const b = parseInt(to.slice(start, start + 2), 16);
      return Math.round(a + (b - a) * amount).toString(16).padStart(2, '0');
    };
    return `#${channel(1)}${channel(3)}${channel(5)}`;
  }

  /* Nuances de flanc entre deux couleurs, de l'ombre à la lumière. */
  function wallTones(shade, lit) {
    const tones = [];
    for (let level = 0; level < RENDER.wallTones; level++) tones.push(mixColors(shade, lit, level / (RENDER.wallTones - 1)));
    return tones;
  }

  /* Nuances d'un camp, toutes tirées de sa couleur pour que le bloc paraisse
     d'un seul tenant : des flancs plus sombres, un dessus en léger dégradé. */
  function tonesOf(colors) {
    if (!tonesByColor.has(colors.main)) {
      const shade = RENDER.warmShade;
      tonesByColor.set(colors.main, {
        walls: wallTones(mixColors(colors.main, shade, 0.4), mixColors(colors.main, shade, 0.14)),
        topFar: mixColors(colors.main, '#fff3dc', 0.2),
        topNear: mixColors(colors.main, shade, 0.06),
      });
    }
    return tonesByColor.get(colors.main);
  }

  /* --- Territoires -------------------------------------------------- */

  function refreshTerritoryLoops(grid) {
    if (grid.dirty.size === 0) return;
    const bounds = findTerritoryBounds(grid, grid.dirty);
    for (const id of grid.dirty) {
      if (id === 0) continue;
      if (grid.counts[id] === 0) {
        territoryLoops.delete(id);
        continue;
      }
      const loops = buildTerritoryLoops(grid, id, bounds.get(id));
      territoryLoops.set(id, loops);
      territoryInsets.set(id, BEVEL_PROFILE.map(({ inset }) => loops.map((loop) => insetLoop(grid, id, loop, inset))));
    }
    grid.dirty.clear();
  }

  /* Contour décalé de `distance` vers l'intérieur du territoire. Le bon côté
     est trouvé en regardant, juste à côté du premier segment, à qui
     appartient le terrain. Une boucle trop petite pour être décalée est
     gardée telle quelle. */
  function insetLoop(grid, id, loop, distance) {
    const count = loop.length / 2;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      minX = Math.min(minX, loop[i * 2]);
      maxX = Math.max(maxX, loop[i * 2]);
      minY = Math.min(minY, loop[i * 2 + 1]);
      maxY = Math.max(maxY, loop[i * 2 + 1]);
    }
    if (Math.min(maxX - minX, maxY - minY) < distance * 4) return loop;

    // À gauche du premier segment, est-on chez le camp ?
    const dx = loop[2] - loop[0];
    const dy = loop[3] - loop[1];
    const length = Math.hypot(dx, dy) || 1;
    const probeX = (loop[0] + loop[2]) / 2 - dy / length * 0.3;
    const probeY = (loop[1] + loop[3]) / 2 + dx / length * 0.3;
    const side = ownerAt(grid, probeX, probeY) === id ? 1 : -1;

    const inset = new Float32Array(loop.length);
    for (let i = 0; i < count; i++) {
      const previous = (i - 1 + count) % count;
      const next = (i + 1) % count;
      const tangentX = loop[next * 2] - loop[previous * 2];
      const tangentY = loop[next * 2 + 1] - loop[previous * 2 + 1];
      const tangentLength = Math.hypot(tangentX, tangentY) || 1;
      inset[i * 2] = loop[i * 2] - tangentY / tangentLength * distance * side;
      inset[i * 2 + 1] = loop[i * 2 + 1] + tangentX / tangentLength * distance * side;
    }
    return inset;
  }

  /* Surface délimitée par un ensemble de boucles, à la hauteur `height`. */
  function buildSurfacePath(loops, height, offsetX = 0, offsetY = 0) {
    const path = new Path2D();
    for (const loop of loops) view.addPolygon(path, loop, height, offsetX, offsetY);
    return path;
  }

  /* Flancs d'un ensemble de boucles : un quadrilatère par segment, entre
     les hauteurs `base` et `top`. Chaque flanc est rangé dans le tracé de
     sa nuance, selon son orientation par rapport à la lumière ; `all` les
     réunit tous. Seuls les flancs tournés vers la caméra comptent : les
     autres finissent sous le dessus. Les calculs sont faits sans objets
     intermédiaires : cette fonction traite des milliers de segments par image. */
  function buildWallPaths(loops, top, base, normals = null) {
    const all = new Path2D();
    const levels = [];
    for (let level = 0; level < RENDER.wallTones; level++) levels.push(new Path2D());
    const light = RENDER.lightDirection;
    const { focal, centerX, centerY, width, height } = view;

    loops.forEach((xy, loopIndex) => {
      const count = xy.length / 2;
      let fromX = 0;
      let fromY = 0;
      let fromTopX = 0;
      let fromTopY = 0;
      let fromBaseX = 0;
      let fromBaseY = 0;
      let fromVisible = false;
      // Un tour de plus que de sommets : le premier passage ne fait qu'amorcer.
      for (let step = 0; step <= count; step++) {
        const i = (step + count - 1) % count;
        const toX = xy[i * 2];
        const toY = xy[i * 2 + 1];
        const side = view.side(toX, toY);
        const topDepth = view.depth(toX, toY, top);
        const baseDepth = view.depth(toX, toY, base);
        const toVisible = topDepth >= CAMERA.near && baseDepth >= CAMERA.near;
        const toTopX = centerX + side * focal / topDepth;
        const toTopY = centerY - view.up(toX, toY, top) * focal / topDepth;
        const toBaseX = centerX + side * focal / baseDepth;
        const toBaseY = centerY - view.up(toX, toY, base) * focal / baseDepth;

        const onScreen = fromVisible && toVisible &&
          Math.max(fromTopX, toTopX, fromBaseX, toBaseX) >= 0 && Math.min(fromTopX, toTopX, fromBaseX, toBaseX) <= width &&
          Math.max(fromBaseY, toBaseY) >= 0 && Math.min(fromTopY, toTopY) <= height;
        // Côtés du plateau : seuls ceux qui regardent vers l'extérieur et vers la caméra ont un flanc visible.
        const outward = normals && step > 0 ? normals[loopIndex][i] : null;
        const facing = !normals || (outward && outward.x * (view.x - toX) + outward.y * (view.y - toY) > 0);
        if (step > 0 && onScreen && facing) {
          // Normale du flanc, choisie du côté de la caméra.
          let normalX = outward ? outward.x : toY - fromY;
          let normalY = outward ? outward.y : fromX - toX;
          if (!outward && normalX * (view.x - fromX) + normalY * (view.y - fromY) < 0) {
            normalX = -normalX;
            normalY = -normalY;
          }
          const lighting = (normalX * light.x + normalY * light.y) / (Math.hypot(normalX, normalY) || 1);
          const level = Math.round((lighting + 1) / 2 * (RENDER.wallTones - 1));
          for (const path of [all, levels[level]]) {
            path.moveTo(fromTopX, fromTopY);
            path.lineTo(toTopX, toTopY);
            path.lineTo(toBaseX, toBaseY);
            path.lineTo(fromBaseX, fromBaseY);
            path.closePath();
          }
        }
        fromX = toX;
        fromY = toY;
        fromTopX = toTopX;
        fromTopY = toTopY;
        fromBaseX = toBaseX;
        fromBaseY = toBaseY;
        fromVisible = toVisible;
      }
    });
    return { all, levels };
  }

  /* Un aplat de la nuance moyenne sous les flancs évite tout jour entre eux. */
  function fillWalls(paths, tones) {
    ctx.fillStyle = tones[Math.floor(tones.length / 2)];
    ctx.fill(paths.all);
    paths.levels.forEach((path, level) => {
      ctx.fillStyle = tones[level];
      ctx.fill(path);
    });
  }

  /* Les territoires sont des blocs posés sur le sol, d'un seul tenant et
     aux bords bombés : une ombre portée, des flancs de la même teinte que le
     dessus, plus sombres et nuancés selon la lumière, puis une épaule, un
     reflet chaud et un dessus en léger dégradé (plus clair au loin), chacun
     un peu plus haut et en retrait. Renvoie, par camp, la surface entière
     du bloc vue de dessus, réutilisée par les éclairs. */
  function drawTerritories(game) {
    const { slabHeight, slabShadow, bevel } = RENDER;
    const shoulderHeight = slabHeight - bevel.radius;
    ctx.fillStyle = PALETTE.ink;
    ctx.globalAlpha = slabShadow.alpha;
    for (const loops of territoryLoops.values()) {
      ctx.fill(buildSurfacePath(loops, 0, slabShadow.x, slabShadow.y), 'evenodd');
    }
    ctx.globalAlpha = 1;

    const tops = new Map();
    for (const [id, loops] of territoryLoops) {
      fillWalls(buildWallPaths(loops, shoulderHeight + RENDER.wallOverlap, 0), tonesOf(game.lands[id - 1].colors).walls);
      tops.set(id, buildSurfacePath(loops, shoulderHeight));
    }
    for (const [id, shoulder] of tops) {
      const colors = game.lands[id - 1].colors;
      const tones = tonesOf(colors);
      const insets = territoryInsets.get(id);
      // Un seul dégradé (plus clair au loin) pour l'arrondi et le dessus :
      // le bord a exactement la couleur de la zone.
      const surface = ctx.createLinearGradient(0, Math.max(0, view.horizonY), 0, view.height);
      surface.addColorStop(0, tones.topFar);
      surface.addColorStop(0.5, colors.main);
      surface.addColorStop(1, tones.topNear);
      ctx.fillStyle = surface;
      ctx.fill(shoulder, 'evenodd');
      ctx.fillStyle = RENDER.warmShade;
      ctx.globalAlpha = bevel.rimShade;
      ctx.fill(shoulder, 'evenodd');
      ctx.globalAlpha = 1;
      ctx.fillStyle = surface;
      for (let step = 1; step < BEVEL_PROFILE.length; step++) {
        ctx.fill(buildSurfacePath(insets[step], shoulderHeight + BEVEL_PROFILE[step].rise), 'evenodd');
      }
    }
    return tops;
  }

  /* Scintillement : de petits éclats blancs s'allument et s'éteignent sur
     les territoires. */
  function drawSparkles(grid) {
    const { speed, threshold, size } = RENDER.sparkle;
    ctx.fillStyle = '#ffffff';
    for (const sparkle of sparkles) {
      const glow = Math.sin(clock * speed + sparkle.phase);
      if (glow < threshold || ownerAt(grid, sparkle.x, sparkle.y) === 0) continue;
      const point = view.toScreen(sparkle.x, sparkle.y, groundHeight(grid, sparkle.x, sparkle.y));
      if (!point || point.y < 0 || point.y > view.height) continue;
      const strength = (glow - threshold) / (1 - threshold);
      const arm = size * point.scale * (0.5 + strength);
      const thin = Math.max(1, arm * 0.22);
      ctx.globalAlpha = 0.85 * strength;
      ctx.fillRect(point.x - arm, point.y - thin / 2, arm * 2, thin);
      ctx.fillRect(point.x - thin / 2, point.y - arm * 0.6, thin, arm * 1.2);
    }
    ctx.globalAlpha = 1;
  }

  /* --- Effets ------------------------------------------------------- */

  /* Les pop-up apparaissent au-dessus du joueur ; ceux qui arrivent en même
     temps s'empilent au lieu de se recouvrir. */
  function addPopup(text, x, y) {
    const recent = popups.filter((popup) => popup.age < 0.5).length;
    popups.push({ text, x, y, row: recent, age: 0 });
  }

  /* Pop-up de capture, pour le joueur seulement : la part d'arène gagnée. */
  function announceGain(game, event) {
    const share = event.cells.length / game.grid.playableCount;
    if (event.entity !== game.player || share < RENDER.minPopupShare) return;
    const amount = `+${(share * 100).toFixed(1).replace('.', ',')} %`;
    addPopup(isTeamMode(game) ? `VOTE ${amount}` : amount, game.player.x, game.player.y);
  }

  function handleEvents(game) {
    for (const event of game.events) {
      if (event.entity && event.type !== 'death' && isHidden(event.entity)) continue;
      if (event.type === 'capture') {
        announceGain(game, event);
        if (event.cells.length < RENDER.minFlashCells) continue;
        flashes.push({ id: event.landId, before: territoryLoops.get(event.landId) || [], age: 0 });
      } else if (event.type === 'recruit') {
        const recruit = event.entity;
        if (game.player && areAllies(recruit, game.player)) {
          addPopup(`RENFORT : ${recruit.name.toUpperCase()}`, game.player.x, game.player.y);
        }
      } else if (event.type === 'dash') {
        // Plus le dash est puissant, plus l'onde et la gerbe d'éclats sont grandes.
        const { entity, power } = event;
        waves.push({ x: entity.x, y: entity.y, color: entity.colors.light, power, age: 0 });
        for (let i = 0; i < 1 + Math.round(power * 3); i++) spawnBurst(entity.x, entity.y, entity.colors);
      } else if (event.type === 'splash') {
        for (let i = 0; i < 4; i++) spawnBurst(event.x, event.y, event.entity.colors);
      } else if (event.type === 'death') {
        const loops = event.landReleased ? territoryLoops.get(event.landId) : null;
        if (loops) fades.push({ loops, color: event.entity.colors.main, age: 0 });
        if (event.hidden || (vision && !isVisibleAt(vision, event.x, event.y))) continue;
        // Impact : deux gerbes d'éclats et une onde aux couleurs de la victime.
        spawnBurst(event.x, event.y, event.entity.colors);
        spawnBurst(event.x, event.y, event.entity.colors);
        waves.push({ x: event.x, y: event.y, color: event.entity.colors.main, power: 0.6, age: 0 });
        const { shake: shaking } = RENDER;
        if (event.entity === game.player) addShake(shaking.playerDeath);
        else if (event.killer && event.killer === game.player) {
          addShake(shaking.playerKill);
          addPopup(event.reason === 'cut' ? 'COUPÉ !' : 'ÉLIMINÉ !', event.x, event.y);
        } else if (Math.hypot(event.x - camera.x, event.y - camera.y) < shaking.radius) addShake(shaking.nearbyDeath);
      } else if (event.type === 'reveal' && game.player && event.entity === game.player) {
        addPopup(event.kind === 'radar' ? 'RADAR' : 'ÉCLAIREUR', game.player.x, game.player.y);
      }
    }
  }

  function spawnBurst(x, y, colors) {
    for (let i = 0; i < RENDER.burst.count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = RENDER.burst.speed * (0.35 + Math.random() * 0.65);
      particles.push({
        x, y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        size: 0.18 + Math.random() * 0.2,
        color: i % 3 === 0 ? colors.dark : colors.main,
        age: 0,
      });
    }
  }

  /* Effets attachés aux têtes : éclats en boost ; en dash, une traînée
     d'éclats plus gros à chaque image. */
  function emitHeadEffects(game, dt) {
    streakClock += dt;
    const emitStreaks = streakClock >= RENDER.streakEvery;
    if (emitStreaks) streakClock = 0;
    for (const entity of game.entities) {
      if (!entity.alive || isHidden(entity)) continue;
      if (isDashing(entity)) {
        particles.push({ x: entity.x, y: entity.y, velocityX: 0, velocityY: 0, size: 0.5, color: entity.colors.light, age: 0 });
      } else if (emitStreaks && entity.boostTime > 0) {
        particles.push({ x: entity.x, y: entity.y, velocityX: 0, velocityY: 0, size: 0.3, color: entity.colors.light, age: 0 });
      }
    }
  }

  function updateEffects(game, dt) {
    clock += dt;
    updateFloats(game, dt);
    emitHeadEffects(game, dt);
    const age = (items, duration) => {
      for (const item of items) item.age += dt;
      return items.filter((item) => item.age < duration);
    };
    waves = age(waves, RENDER.dashWave.duration);
    shake *= Math.exp(-dt / RENDER.shake.decay);
    if (shake < 0.3) shake = 0;
    popups = age(popups, RENDER.popup.duration);
    flashes = age(flashes, RENDER.captureFlash.duration);
    fades = age(fades, RENDER.releaseFade.duration);

    const drag = Math.exp(-dt * 4);
    for (const particle of particles) {
      particle.x += particle.velocityX * dt;
      particle.y += particle.velocityY * dt;
      particle.velocityX *= drag;
      particle.velocityY *= drag;
    }
    particles = age(particles, RENDER.burst.duration);
  }

  function fadingAlpha(age, { duration, alpha }) {
    const remaining = 1 - age / duration;
    return alpha * remaining * remaining;
  }

  /* Territoires libérés : l'ancienne forme s'efface. */
  function drawFades() {
    for (const fade of fades) {
      ctx.globalAlpha = fadingAlpha(fade.age, RENDER.releaseFade);
      ctx.fillStyle = fade.color;
      ctx.fill(buildSurfacePath(fade.loops, RENDER.slabHeight), 'evenodd');
    }
    ctx.globalAlpha = 1;
  }

  /* Captures : un éclair blanc sur la zone gagnée, c'est-à-dire le dessus
     actuel du territoire moins celui d'avant la capture. */
  function drawFlashes(tops) {
    for (const flash of flashes) {
      const top = tops.get(flash.id);
      if (!top) continue;
      // Même hauteur que `top` (le pied de l'arrondi), sinon un liseré blanc
      // apparaît tout le long des bords déjà possédés.
      const outsideBefore = buildSurfacePath(flash.before, RENDER.slabHeight - RENDER.bevel.radius);
      outsideBefore.rect(0, 0, view.width, view.height);
      ctx.save();
      ctx.clip(top, 'evenodd');
      ctx.clip(outsideBefore, 'evenodd');
      ctx.globalAlpha = fadingAlpha(flash.age, RENDER.captureFlash);
      ctx.fillStyle = PALETTE.flash;
      ctx.fillRect(0, 0, view.width, view.height);
      ctx.restore();
    }
  }

  /* Onde de choc d'un dash : un anneau qui s'élargit très vite puis s'efface. */
  function drawWaves() {
    const { duration, growth, growthPerPower, alpha, width, points } = RENDER.dashWave;
    for (const wave of waves) {
      const progress = wave.age / duration;
      const eased = 1 - (1 - progress) ** 3;
      const radius = 0.4 + eased * (growth + growthPerPower * wave.power);
      const circle = [];
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        circle.push(wave.x + Math.cos(angle) * radius, wave.y + Math.sin(angle) * radius);
      }
      const path = new Path2D();
      view.addPolygon(path, circle, RENDER.slabHeight + 0.05);
      ctx.globalAlpha = alpha * (1 - progress);
      ctx.lineWidth = Math.max(1, width * (1 - progress * 0.6) * view.dpr);
      ctx.strokeStyle = wave.color;
      ctx.stroke(path);
    }
    ctx.globalAlpha = 1;
  }

  /* Visée du dash : un anneau autour du joueur, des points jusqu'à
     l'endroit où le dash l'emmènera, et une flèche au bout. La longueur
     montre la puissance gagnée par les éliminations. */
  function drawAim(game, aim) {
    const player = game.player;
    if (!aim || !player || !player.alive) return;
    const { ring, dotEvery, head, headWidth } = RENDER.aim;
    const z = RENDER.slabHeight + 0.08;
    const directionX = Math.cos(aim.angle);
    const directionY = Math.sin(aim.angle);
    const at = (distance, side = 0) => [
      player.x + directionX * distance - directionY * side,
      player.y + directionY * distance + directionX * side,
    ];
    const reach = Math.max(ring + head, dashProfile(game, player).distance);

    const circle = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      circle.push(player.x + Math.cos(angle) * ring, player.y + Math.sin(angle) * ring);
    }
    const ringPath = new Path2D();
    view.addPolygon(ringPath, circle, z);
    ctx.lineWidth = Math.max(1.5, 2.5 * view.dpr);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke(ringPath);

    // Points sombres : lisibles sur la banquise claire comme sur les territoires.
    ctx.fillStyle = 'rgba(35, 49, 79, 0.6)';
    for (let distance = ring + dotEvery; distance < reach - head; distance += dotEvery) {
      const [x, y] = at(distance);
      const point = view.toScreen(x, y, z);
      if (!point) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(2, point.scale * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }

    const arrow = new Path2D();
    view.addPolygon(arrow, [...at(reach), ...at(reach - head, headWidth), ...at(reach - head, -headWidth)], z);
    ctx.fillStyle = player.colors.light;
    ctx.fill(arrow);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PALETTE.ink;
    ctx.stroke(arrow);
  }

  function drawParticles(grid) {
    for (const particle of particles) {
      const point = view.toScreen(particle.x, particle.y, groundHeight(grid, particle.x, particle.y) + 0.15);
      if (!point) continue;
      const side = particle.size * point.scale * (1 - particle.age / RENDER.burst.duration);
      ctx.fillStyle = particle.color;
      ctx.fillRect(point.x - side / 2, point.y - side / 2, side, side);
    }
  }

  /* Bombe en vol : une goutte qui décrit une cloche, et son ombre au sol. */
  function drawProjectiles(game) {
    for (const projectile of game.projectiles) {
      const progress = projectile.age / projectile.duration;
      const x = projectile.fromX + (projectile.toX - projectile.fromX) * progress;
      const y = projectile.fromY + (projectile.toY - projectile.fromY) * progress;
      const shadow = view.toScreen(x, y, groundHeight(game.grid, x, y));
      const drop = view.toScreen(x, y, Math.sin(progress * Math.PI) * RENDER.bombArc + 0.5);
      if (!shadow || !drop) continue;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = PALETTE.ink;
      ctx.beginPath();
      ctx.ellipse(shadow.x, shadow.y, shadow.scale * 0.4, shadow.scale * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = projectile.entity.colors.light;
      ctx.strokeStyle = projectile.entity.colors.dark;
      ctx.lineWidth = Math.max(2, drop.scale * 0.1);
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, drop.scale * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /* --- Décor : ciel, eau, sol en relief, brume ----------------------- */

  /* Le ciel et l'eau autour de l'arène ne dépendent que de la taille de
     l'écran : ils sont peints une fois, sur une bande d'un pixel de large
     qu'il suffit ensuite d'étirer. Idem pour la brume. */
  function paintStrip(height, paint) {
    const strip = document.createElement('canvas');
    strip.width = 1;
    strip.height = Math.max(1, Math.round(height));
    const stripCtx = strip.getContext('2d');
    paint(stripCtx, strip.height);
    return strip;
  }

  function fillGradient(target, fromY, toY, fromColor, toColor) {
    const gradient = target.createLinearGradient(0, fromY, 0, toY);
    gradient.addColorStop(0, fromColor);
    gradient.addColorStop(1, toColor);
    target.fillStyle = gradient;
    target.fillRect(0, fromY, 1, toY - fromY);
  }

  function prepareBackdrop() {
    fogStrip = paintStrip(view.height * RENDER.fogDepth, (target, height) => {
      fillGradient(target, 0, height, theme.haze, theme.haze.replace(/[\d.]+\)$/, '0)'));
    });
  }

  /* Texture du sol tournée dans l'axe de la caméra : sa ligne du haut est
     ce qui se trouve le plus loin devant elle. Refaite seulement quand la
     caméra pivote ; le centre de l'image est le centre de l'arène. */
  function alignedGroundTexture() {
    return alignTexture(alignedGround, groundTexture);
  }

  /* Copie d'une texture vue du dessus, tournée dans l'axe de la caméra. */
  function alignTexture(cache, source) {
    if (cache.yaw === view.yaw && cache.source === source && cache.version === source.version) return cache.canvas;
    const size = source.width;
    const span = Math.ceil(size * Math.SQRT2) + 2;
    const canvas = cache.canvas || document.createElement('canvas');
    if (canvas.width !== span) {
      canvas.width = span;
      canvas.height = span;
    }
    const target = canvas.getContext('2d');
    const half = size / 2;
    const { rightX, rightY, forwardX, forwardY } = view;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, span, span);
    target.setTransform(rightX, -forwardX, rightY, -forwardY,
      span / 2 - (rightX + rightY) * half, span / 2 + (forwardX + forwardY) * half);
    target.drawImage(source, 0, 0);
    Object.assign(cache, { canvas, yaw: view.yaw, source, version: source.version });
    return canvas;
  }

  /* Le sol : une île posée sur l'eau. La caméra ne penche jamais sur le
     côté : chaque ligne de l'écran montre une ligne du sol perpendiculaire
     à son regard. La texture, tournée dans l'axe de la caméra, est donc
     recopiée bande par bande, chacune à son échelle. C'est exact en
     perspective, et sans aucun joint. Un voile bleuté assombrit ensuite le
     premier plan, l'eau recouvre ce qui dépasse du contour de l'arène, et
     la falaise vient border le tout. */
  function drawGround() {
    drawProjectedTexture(alignedGroundTexture(), groundTexture.width, 0);
    // Le plateau flotte : tout ce qui dépasse de son contour disparaît, le
    // fond spatial apparaît ; ses flancs plongent dans le vide.
    const surface = buildSurfacePath(arenaLoops, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fill(surface, arenaRule);
    ctx.restore();
    // Les flancs passent derrière le sol déjà peint : dans un creux de la
    // côte, le sol du premier plan cache le flanc du fond.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    fillWalls(buildWallPaths(arenaLoops, 0, -RENDER.platformDepth, platformNormals), cliffTones);
    ctx.restore();
    ctx.lineWidth = Math.max(1, 1.5 * view.dpr);
    ctx.strokeStyle = theme.rim;
    ctx.stroke(buildRimPath());
  }

  /* Liseré du bord du plateau : seulement les côtés qui donnent sur le
     vide (pas le bout d'un pont, caché dans une île). */
  function buildRimPath() {
    const path = new Path2D();
    arenaLoops.forEach((loop, loopIndex) => {
      const count = loop.length / 2;
      for (let i = 0; i < count; i++) {
        if (!platformNormals[loopIndex][i]) continue;
        const from = (i - 1 + count) % count;
        const start = view.toScreen(loop[from * 2], loop[from * 2 + 1], 0);
        const end = view.toScreen(loop[i * 2], loop[i * 2 + 1], 0);
        if (!start || !end) continue;
        path.moveTo(start.x, start.y);
        path.lineTo(end.x, end.y);
      }
    });
    return path;
  }

  /* Recopie une texture vue du dessus (déjà tournée dans l'axe de la
     caméra) sur le plan horizontal de hauteur `height`, bande par bande. */
  function drawProjectedTexture(texture, sourceSize, height) {
    const band = RENDER.groundBand;
    const span = texture.width;
    const middle = span / 2;
    const scaleToTexture = sourceSize / groundTextureGrid.arenaSize;   // pixels de texture par unité
    // Position de la caméra dans le repère de la texture tournée, depuis le centre de l'arène.
    const center = groundTextureGrid.arenaSize / 2;
    const cameraSide = (view.x - center) * view.rightX + (view.y - center) * view.rightY;
    const cameraAhead = (view.x - center) * view.forwardX + (view.y - center) * view.forwardY;
    const firstRow = Math.max(0, Math.ceil(view.horizonY) + 1);
    let far = view.groundRow(firstRow, height);
    for (let row = firstRow; row < view.height; row += band) {
      const near = view.groundRow(row + band, height);
      if (far && near) {
        // Bande du sol entre deux lignes d'écran : du plus loin (far) au plus près (near).
        const sourceTop = Math.max(0, middle - (cameraAhead + far.ahead) * scaleToTexture);
        const sourceBottom = Math.min(span, middle - (cameraAhead + near.ahead) * scaleToTexture);
        const sourceLeft = Math.max(0, middle + (cameraSide - view.centerX / near.scale) * scaleToTexture);
        const sourceRight = Math.min(span, middle + (cameraSide + (view.width - view.centerX) / near.scale) * scaleToTexture);
        if (sourceBottom > sourceTop && sourceRight > sourceLeft) {
          const left = view.centerX + ((sourceLeft - middle) / scaleToTexture - cameraSide) * near.scale;
          const right = view.centerX + ((sourceRight - middle) / scaleToTexture - cameraSide) * near.scale;
          ctx.drawImage(texture, sourceLeft, sourceTop, sourceRight - sourceLeft, Math.max(0.01, sourceBottom - sourceTop),
            left, row, right - left, band);
        }
      }
      far = near;
    }
  }

  /* --- Brouillard de guerre ------------------------------------------- */

  /* Texture du brouillard, vue du dessus, une case par unité : transparente
     là où le camp voit, voilée là où il a déjà vu (la carte y est celle de
     sa dernière visite), presque opaque ailleurs. Agrandie avec lissage,
     pour des bords doux. */
  function refreshFogTexture() {
    if (fog.version === vision.version && fog.canvas) return;
    const size = groundTextureGrid.arenaSize;
    if (!fog.small || fog.small.width !== size) {
      fog.small = document.createElement('canvas');
      fog.small.width = size;
      fog.small.height = size;
      fog.canvas = document.createElement('canvas');
      fog.canvas.width = size * 4;
      fog.canvas.height = size * 4;
    }
    const smallCtx = fog.small.getContext('2d');
    const image = smallCtx.createImageData(size, size);
    const { seen, unseen } = theme.fog;
    for (let cell = 0; cell < size * size; cell++) {
      if (vision.visible[cell]) continue;
      const tone = vision.seen && vision.seen[cell] ? seen : unseen;
      const pixel = cell * 4;
      image.data[pixel] = tone[0];
      image.data[pixel + 1] = tone[1];
      image.data[pixel + 2] = tone[2];
      image.data[pixel + 3] = Math.round(tone[3] * 255);
    }
    smallCtx.putImageData(image, 0, 0);
    const bigCtx = fog.canvas.getContext('2d');
    bigCtx.clearRect(0, 0, fog.canvas.width, fog.canvas.height);
    bigCtx.imageSmoothingEnabled = true;
    bigCtx.filter = 'blur(3px)';
    bigCtx.drawImage(fog.small, 0, 0, fog.canvas.width, fog.canvas.height);
    bigCtx.filter = 'none';
    fog.version = vision.version;
    fog.canvas.version = vision.version;
  }

  function drawFog(game) {
    if (!vision) return;
    refreshFogTexture();
    const lift = RENDER.slabHeight + RENDER.fogLift;
    ctx.save();
    ctx.clip(buildSurfacePath(arenaLoops, lift), arenaRule);
    drawProjectedTexture(alignTexture(alignedFog, fog.canvas), fog.canvas.width, lift);
    ctx.restore();
  }

  /* Tours de vision : un faisceau monte de chaque région tenue par le camp. */
  function drawBeacons(game) {
    if (!vision || !game.player) return;
    const colors = game.player.colors;
    const { height, width } = RENDER.beacon;
    for (const tower of vision.towers) {
      const bottom = view.toScreen(tower.x, tower.y, RENDER.slabHeight);
      const top = view.toScreen(tower.x, tower.y, RENDER.slabHeight + height);
      if (!bottom || !top) continue;
      const beam = Math.max(2, width * bottom.scale);
      const pulse = 0.55 + 0.25 * Math.sin(clock * 3 + tower.x);
      const gradient = ctx.createLinearGradient(0, bottom.y, 0, top.y);
      gradient.addColorStop(0, colors.light);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.globalAlpha = pulse;
      ctx.fillStyle = gradient;
      ctx.fillRect(bottom.x - beam / 2, top.y, beam, bottom.y - top.y);
      ctx.beginPath();
      ctx.ellipse(bottom.x, bottom.y, beam * 1.6, beam * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = colors.main;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* Radars (une onde qui s'étend) et éclaireurs (un drone qui plane, et le
     cercle qu'il révèle) du camp. */
  function drawReveals(game) {
    if (!game.player || !game.reveals) return;
    const colors = game.player.colors;
    for (const reveal of game.reveals) {
      if (reveal.landId !== game.player.landId) continue;
      const radius = revealRadius(reveal);
      const fade = Math.min(1, (reveal.duration - reveal.age) / 0.6);
      const circle = [];
      for (let i = 0; i < 48; i++) {
        const angle = (i / 48) * Math.PI * 2;
        circle.push(reveal.x + Math.cos(angle) * radius, reveal.y + Math.sin(angle) * radius);
      }
      const path = new Path2D();
      view.addPolygon(path, circle, RENDER.slabHeight + 0.08);
      ctx.globalAlpha = 0.8 * fade;
      ctx.lineWidth = Math.max(1, 2.5 * view.dpr);
      ctx.setLineDash(reveal.kind === 'scout' ? [8 * view.dpr, 6 * view.dpr] : []);
      ctx.strokeStyle = colors.light;
      ctx.stroke(path);
      ctx.setLineDash([]);
      if (reveal.kind === 'scout') {
        const drone = view.toScreen(reveal.x, reveal.y, RENDER.slabHeight + 2.4 + Math.sin(clock * 4) * 0.15);
        if (drone) {
          const size = Math.max(4, 0.45 * drone.scale);
          ctx.globalAlpha = fade;
          ctx.fillStyle = colors.main;
          ctx.strokeStyle = PALETTE.ink;
          ctx.lineWidth = Math.max(1, view.dpr * 1.5);
          ctx.beginPath();
          ctx.moveTo(drone.x, drone.y - size);
          ctx.lineTo(drone.x + size, drone.y);
          ctx.lineTo(drone.x, drone.y + size);
          ctx.lineTo(drone.x - size, drone.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /* Un adversaire hors de vue : sa tête (et son nom) ne sont pas dessinés. */
  function isHidden(entity) {
    return Boolean(entity.hidden || (vision && vision.hidden.has(entity.id)));
  }

  function isTrailHidden(entity) {
    return Boolean(entity.hidden && entity.trailPoints.length === 0) || Boolean(vision && vision.trailHidden.has(entity.id));
  }

  /* La brume fond le lointain dans le ciel. */
  function drawHaze() {
    if (view.horizonY + fogStrip.height <= 0) return;
    ctx.drawImage(fogStrip, 0, view.horizonY, view.width, fogStrip.height);
  }

  /* --- Traînées ------------------------------------------------------ */

  /* Ruban le long de la traînée : pour chaque point, ses deux bords. */
  function buildRibbon(grid, entity) {
    const points = [...entity.trailPoints, entity];
    const half = RENDER.trailWidth / 2;
    const edges = [];
    for (let i = 0; i < points.length; i++) {
      const before = points[Math.max(0, i - 1)];
      const after = points[Math.min(points.length - 1, i + 1)];
      const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
      const normalX = -(after.y - before.y) / length * half;
      const normalY = (after.x - before.x) / length * half;
      const { x, y } = points[i];
      edges.push({ leftX: x + normalX, leftY: y + normalY, rightX: x - normalX, rightY: y - normalY, z: groundHeight(grid, x, y) });
    }
    return edges;
  }

  /* Le ruban est dessiné tronçon par tronçon : ceux qui passent derrière
     la caméra sont simplement ignorés. */
  function addRibbonPath(path, edges, lift) {
    let previous = null;
    for (const edge of edges) {
      const left = view.toScreen(edge.leftX, edge.leftY, edge.z + lift);
      const right = view.toScreen(edge.rightX, edge.rightY, edge.z + lift);
      const current = left && right ? { left, right } : null;
      if (previous && current) {
        path.moveTo(previous.left.x, previous.left.y);
        path.lineTo(current.left.x, current.left.y);
        path.lineTo(current.right.x, current.right.y);
        path.lineTo(previous.right.x, previous.right.y);
        path.closePath();
      }
      previous = current;
    }
  }

  function drawTrail(grid, entity) {
    if (entity.trailPoints.length === 0) return;
    const edges = buildRibbon(grid, entity);
    const side = new Path2D();
    const top = new Path2D();
    addRibbonPath(side, edges, 0);
    addRibbonPath(top, edges, RENDER.trailHeight);
    ctx.fillStyle = entity.colors.dark;
    ctx.strokeStyle = entity.colors.dark;
    ctx.lineWidth = Math.max(1, view.dpr);
    ctx.fill(side);
    ctx.stroke(side);
    ctx.fillStyle = entity.colors.main;
    ctx.strokeStyle = entity.colors.main;
    ctx.fill(top);
    ctx.stroke(top);
  }

  /* --- Têtes --------------------------------------------------------- */

  function fillPolygon(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fill();
  }

  /* Contour d'un carré aux coins arrondis, tourné selon le cap : points de
     l'arène et normales vers l'extérieur. `inset` le rétrécit d'autant. */
  function roundedSquare(x, y, angle, size, radius, inset = 0) {
    const half = size / 2 - inset;
    const round = Math.max(0.01, radius - inset);
    const reach = half - round;
    const { cornerSteps } = RENDER.headRound;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const points = [];
    const centers = [[reach, reach], [-reach, reach], [-reach, -reach], [reach, -reach]];
    centers.forEach(([centerX, centerY], corner) => {
      for (let i = 0; i <= cornerSteps; i++) {
        const turn = (corner + i / cornerSteps) * Math.PI / 2;
        const normalX = Math.cos(turn);
        const normalY = Math.sin(turn);
        const localX = centerX + normalX * round;
        const localY = centerY + normalY * round;
        points.push({
          x: x + localX * cos - localY * sin,
          y: y + localX * sin + localY * cos,
          normalX: normalX * cos - normalY * sin,
          normalY: normalX * sin + normalY * cos,
        });
      }
    });
    return points;
  }

  function projectCorners(corners, z, offsetX = 0, offsetY = 0) {
    const projected = corners.map((corner) => view.toScreen(corner.x + offsetX, corner.y + offsetY, z));
    return projected.every(Boolean) ? projected : null;
  }

  /* Teinte d'un flanc selon son orientation : la lumière vient de l'est.
     Quelques nuances seulement, gardées en mémoire. */
  const flankTones = new Map();
  function flankColor(colors, normalX, toward = null) {
    const level = Math.round((normalX + 1) * 2);   // 0 (ouest, à l'ombre) à 4 (est, au soleil)
    const key = `${colors.main}${level}${toward || ''}`;
    if (!flankTones.has(key)) {
      const flank = mixColors(colors.dark, colors.main, level / 4);
      // `toward` : l'arrondi du dessus, à mi-chemin entre le flanc et le dessus.
      flankTones.set(key, toward ? mixColors(flank, colors.light, 0.55) : flank);
    }
    return flankTones.get(key);
  }

  /* Une tête : un bloc aux arêtes arrondies. Son ombre reste au sol ; ses
     flancs tournés vers la caméra, du plus lointain au plus proche ; un
     arrondi entre flancs et dessus ; puis le dessus. Quand elle flotte plus
     bas que la surface du territoire où elle se trouve (elle vient d'y
     entrer), sa partie immergée prend la couleur du territoire, avec une
     ligne de flottaison claire. */
  function drawHead(game, entity) {
    const grid = game.grid;
    const base = headBase(grid, entity);
    const surface = groundHeight(grid, entity.x, entity.y);
    const { headSize, headHeight, shadowOffset } = RENDER;
    const { corner, top } = RENDER.headRound;
    const outline = roundedSquare(entity.x, entity.y, entity.angle, headSize, corner);
    const crownOutline = roundedSquare(entity.x, entity.y, entity.angle, headSize, corner, top);
    const shoulderZ = base + headHeight - top;
    const bottom = projectCorners(outline, base);
    const shoulder = projectCorners(outline, shoulderZ);
    const crown = projectCorners(crownOutline, base + headHeight);
    const shadow = projectCorners(outline, surface, shadowOffset.x, shadowOffset.y);
    if (!bottom || !shoulder || !crown || !shadow) return;

    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.2;
    fillPolygon(shadow, PALETTE.ink);
    ctx.globalAlpha = alpha;

    // Un flanc est visible quand il fait face à la caméra.
    const count = outline.length;
    const faces = [];
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      const normalX = outline[i].normalX + outline[next].normalX;
      const normalY = outline[i].normalY + outline[next].normalY;
      faces.push({
        i, next, normalX,
        front: normalX * view.forwardX + normalY * view.forwardY < 0,
        nearness: bottom[i].y + bottom[next].y,
      });
    }
    faces.sort((a, b) => a.nearness - b.nearness);
    for (const face of faces) {
      if (!face.front) continue;
      const color = flankColor(entity.colors, face.normalX / 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      fillPolygon([bottom[face.i], bottom[face.next], shoulder[face.next], shoulder[face.i]], color);
      ctx.stroke();   // referme les joints entre segments
    }
    for (const face of faces) {
      const color = flankColor(entity.colors, face.normalX / 2, 'top');
      ctx.strokeStyle = color;
      fillPolygon([shoulder[face.i], shoulder[face.next], crown[face.next], crown[face.i]], color);
      ctx.stroke();
    }
    fillPolygon(crown, entity.colors.light);
    if (entity.isPlayer) {
      // Un liseré contrasté distingue le joueur de ses alliés, qui portent la même couleur.
      ctx.strokeStyle = entity.colors.text;
      ctx.lineWidth = Math.max(2, crown[0].scale * 0.08);
      ctx.stroke();
    }

    if (surface > base + 0.02) drawImmersion(game, entity, outline, faces, bottom, Math.min(surface, shoulderZ));
  }

  /* Partie immergée d'une tête : recouverte de la couleur du territoire,
     sous une ligne de flottaison claire. */
  function drawImmersion(game, entity, outline, faces, bottom, waterZ) {
    const owner = game.lands[ownerAt(game.grid, entity.x, entity.y) - 1];
    const water = projectCorners(outline, waterZ);
    if (!owner || !water) return;
    ctx.globalAlpha = RENDER.float.waterAlpha;
    for (const face of faces) {
      if (!face.front) continue;
      ctx.strokeStyle = owner.colors.main;
      ctx.lineWidth = 1;
      fillPolygon([bottom[face.i], bottom[face.next], water[face.next], water[face.i]], owner.colors.main);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = owner.colors.light;
    ctx.lineWidth = Math.max(1.5, water[0].scale * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const face of faces) {
      if (!face.front) continue;
      ctx.moveTo(water[face.i].x, water[face.i].y);
      ctx.lineTo(water[face.next].x, water[face.next].y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawHeads(game, living) {
    living.sort((a, b) => view.ahead(b.x, b.y) - view.ahead(a.x, a.y));   // du plus lointain au plus proche
    for (const entity of living) {
      drawHead(game, entity);
    }
  }

  /* --- Textes -------------------------------------------------------- */

  function labelFont(size, weight = 600) {
    return `${weight} ${Math.round(size * view.dpr)}px "Public Sans", "Inter", "Segoe UI", sans-serif`;
  }

  /* Texte détouré de clair, lisible sur n'importe quel territoire. */
  function drawOutlinedText(text, x, y) {
    ctx.strokeStyle = PALETTE.ground;
    ctx.lineWidth = Math.round(3 * view.dpr);
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(text, x, y);
  }

  /* Bulle de pourcentage au-dessus du joueur, pointe vers le bas. */
  function drawShareBubble(text, x, y, colors) {
    const height = Math.round(20 * view.dpr);
    const width = Math.round(ctx.measureText(text).width + 16 * view.dpr);
    const tip = Math.round(6 * view.dpr);
    const left = Math.round(x - width / 2);
    const top = Math.round(y - tip - height);
    const radius = height / 2;
    ctx.fillStyle = colors.dark;
    ctx.beginPath();
    ctx.moveTo(left + radius, top);
    ctx.arcTo(left + width, top, left + width, top + height, radius);
    ctx.arcTo(left + width, top + height, left, top + height, radius);
    ctx.lineTo(x + tip, top + height);
    ctx.lineTo(x, top + height + tip);
    ctx.lineTo(x - tip, top + height);
    ctx.arcTo(left, top + height, left, top, radius);
    ctx.arcTo(left, top, left + width, top, radius);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, top + height - Math.round(5.5 * view.dpr));
    return top;
  }

  /* Le nom de chaque joueur ; pour le tien, la part d'arène de ton camp en
     plus. Renvoie, par joueur, le point au-dessus de son nom (pour les bulles). */
  function drawLabels(game, living) {
    const totalCells = game.grid.playableCount;
    const tops = new Map();
    ctx.font = labelFont(12);
    for (const entity of living) {
      const base = headBase(game.grid, entity);
      const anchor = view.toScreen(entity.x, entity.y, base + RENDER.headHeight + 0.55);
      if (!anchor) continue;
      let nameY = Math.round(anchor.y);
      if (entity.isPlayer) {
        const share = (game.grid.counts[entity.landId] / totalCells * 100).toFixed(1).replace('.', ',');
        nameY = drawShareBubble(`${share} %`, Math.round(anchor.x), nameY, entity.colors) - Math.round(5 * view.dpr);
      }
      drawOutlinedText(entity.name.toUpperCase(), Math.round(anchor.x), nameY);
      tops.set(entity.id, { x: Math.round(anchor.x), y: nameY - Math.round(15 * view.dpr) });
    }
    return tops;
  }

  /* Découpe une réplique en lignes d'au plus `maxWidth` pixels. */
  function wrapText(text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const attempt = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(attempt).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* Bulle de dialogue au-dessus du nom d'un adversaire : elle apparaît d'un
     petit bond, puis s'efface. */
  function drawSpeechBubble(text, x, bottom, age) {
    const { dpr } = view;
    const padding = 8 * dpr;
    const lineHeight = 15 * dpr;
    const tail = 7 * dpr;
    const lines = wrapText(text, 150 * dpr);
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + padding * 2;
    const height = lines.length * lineHeight + padding * 1.4;
    const appear = Math.min(1, age / RENDER.bubble.appear);
    const scale = 0.7 + 0.3 * (1 - (1 - appear) * (1 - appear));
    ctx.save();
    ctx.globalAlpha = Math.min(1, (SPEECH.duration - age) / RENDER.bubble.fade);
    ctx.translate(x, bottom);
    ctx.scale(scale, scale);
    // La bulle reste dans l'écran ; sa pointe, elle, désigne toujours l'orateur.
    const margin = 8 * dpr;
    const shift = Math.max(margin - x + width / 2, Math.min(view.width - margin - x - width / 2, 0));
    const left = -width / 2 + shift;
    const top = -tail - height;
    const radius = 10 * dpr;
    const tailX = Math.max(left + radius + tail, Math.min(left + width - radius - tail, 0));
    ctx.beginPath();
    ctx.moveTo(left + radius, top);
    ctx.arcTo(left + width, top, left + width, top + height, radius);
    ctx.arcTo(left + width, top + height, left, top + height, radius);
    ctx.lineTo(tailX + tail, top + height);
    ctx.lineTo(0, 0);
    ctx.lineTo(tailX - tail * 0.4, top + height);
    ctx.arcTo(left, top + height, left, top, radius);
    ctx.arcTo(left, top, left + width, top, radius);
    ctx.closePath();
    // Fond légèrement transparent : la bulle ne masque pas le jeu derrière.
    // Un fin liseré remplace l'ombre portée, qui se verrait à travers.
    ctx.fillStyle = `rgba(255, 255, 255, ${RENDER.bubble.opacity})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(35, 49, 79, 0.2)';
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
    ctx.fillStyle = PALETTE.ink;
    lines.forEach((line, index) => ctx.fillText(line, left + width / 2, top + padding * 0.7 + (index + 0.78) * lineHeight));
    ctx.restore();
  }

  function drawBubbles(bubbles, labelTops) {
    if (!bubbles || bubbles.size === 0) return;
    ctx.font = labelFont(12, 500);
    for (const [id, bubble] of bubbles) {
      const anchor = labelTops.get(id);
      if (anchor) drawSpeechBubble(bubble.text, anchor.x, anchor.y, bubble.age);
    }
  }

  function drawPopups(grid) {
    const { duration, startLift, rise, fadeTime, stackGap } = RENDER.popup;
    ctx.font = labelFont(15);
    for (const popup of popups) {
      const anchor = view.toScreen(popup.x, popup.y, groundHeight(grid, popup.x, popup.y));
      if (!anchor) continue;
      const lift = (startLift + popup.row * stackGap + rise * (popup.age / duration)) * view.dpr;
      ctx.globalAlpha = Math.min(1, (duration - popup.age) / fadeTime);
      drawOutlinedText(popup.text, Math.round(anchor.x), Math.round(anchor.y - lift));
    }
    ctx.globalAlpha = 1;
  }

  /* --- Image complète ------------------------------------------------ */

  /* `bubbles` : répliques en cours (voir speech.js), ou null ; `aim` :
     visée du dash en cours ({ angle }, cap en radians), ou null. */
  /* `fogVision` : brouillard du camp de cet appareil (voir vision.js), ou
     null hors équipes ; la partie affichée est alors ce que le camp connaît. */
  function draw(game, dt, bubbles = null, aim = null, fogVision = null) {
    vision = fogVision;
    updateCamera(game, dt);
    updateEffects(game, dt);
    refreshTerritoryLoops(game.grid);
    const grid = game.grid;
    const living = game.entities.filter((entity) => entity.alive && !isHidden(entity));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.width, view.height);
    if (shake > 0) {
      const amount = shake * view.dpr;
      ctx.setTransform(1, 0, 0, 1, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    }
    drawGround();
    drawFades();
    const tops = drawTerritories(game);
    drawSparkles(grid);
    drawFlashes(tops);
    drawWaves();
    for (const entity of game.entities) {
      if (entity.alive && !isTrailHidden(entity)) drawTrail(grid, entity);
    }
    drawAim(game, aim);
    drawHeads(game, living);
    drawParticles(grid);
    drawProjectiles(game);
    drawFog(game);
    drawReveals(game);
    drawBeacons(game);
    drawHaze();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labelTops = drawLabels(game, living);
    drawBubbles(bubbles, labelTops);
    drawPopups(grid);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  resize();
  const getPitch = () => view.pitch;
  return {
    resize, reset, zoomBy, tiltBy, rotateBy, resetYaw, getYaw, getPitch, toWorldAngle, toCssPoint, handleEvents, draw,
    setTheme, toggleFreeCamera, isFreeCamera, panBy, panToward, addShake,
  };
}
