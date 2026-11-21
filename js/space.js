'use strict';

/* Le fond vivant, derrière l'arène : un ciel en dégradé, de grands halos
   qui dérivent, des étoiles qui scintillent (la nuit) ou des poussières
   claires (le jour), une étoile filante de temps en temps, et des
   enveloppes, urnes et bulletins qui flottent dans le vide.

   Il est peint sur son propre canvas, sous celui du jeu, à 30 images par
   seconde au plus : il bouge lentement et ne doit rien coûter au jeu.
   Quand la caméra pivote ou s'incline, il glisse un peu (parallaxe), pour
   qu'on sente l'espace autour du plateau. Les objets restent pâles et
   lents : ils ne doivent jamais attirer l'œil plus qu'un joueur.
   Avec « réduire les animations », tout est figé. */

const SPACE = Object.freeze({
  frameTime: 1 / 30,
  stars: 170,
  motes: 46,
  objects: 11,
  shootingEvery: [5, 11],     // secondes entre deux étoiles filantes
  parallax: 0.22,             // décalage, en largeur d'écran, pour un tour de caméra complet
});

function createSpace(canvas) {
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theme = THEMES.night;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let backdrop = null;          // dégradé du ciel, peint à l'avance
  let clock = Math.random() * 100;
  let elapsed = 0;
  let dirty = true;               // à repeindre même figé (taille, thème)
  let shooting = null;
  let nextShooting = 4;
  let yaw = 0;
  let pitch = 0;

  const random = Math.random;
  const stars = Array.from({ length: SPACE.stars }, () => ({
    x: random(), y: random(), size: 0.5 + random() ** 3 * 1.6, phase: random() * Math.PI * 2,
    speed: 0.6 + random() * 2.2, depth: 0.3 + random() * 0.7,
  }));
  const motes = Array.from({ length: SPACE.motes }, () => ({
    x: random(), y: random(), size: 1.5 + random() * 3.5, drift: 0.004 + random() * 0.01, phase: random() * Math.PI * 2, depth: 0.4 + random() * 0.6,
  }));
  const KINDS = ['envelope', 'urn', 'ballot', 'envelope', 'star'];
  const objects = Array.from({ length: SPACE.objects }, (_, index) => ({
    kind: KINDS[index % KINDS.length], x: random(), y: random(),
    vx: (random() - 0.5) * 0.012, vy: (random() - 0.5) * 0.008,
    angle: random() * Math.PI * 2, spin: (random() - 0.5) * 0.25,
    size: 18 + random() * 26, depth: 0.5 + random() * 0.8, bob: random() * Math.PI * 2,
  }));

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.round(canvas.clientWidth * dpr);
    height = Math.round(canvas.clientHeight * dpr);
    canvas.width = width;
    canvas.height = height;
    paintBackdrop();
    dirty = true;
  }

  function paintBackdrop() {
    backdrop = document.createElement('canvas');
    backdrop.width = 1;
    backdrop.height = Math.max(1, height);
    const target = backdrop.getContext('2d');
    const gradient = target.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, theme.space.top);
    gradient.addColorStop(0.55, theme.space.middle);
    gradient.addColorStop(1, theme.space.bottom);
    target.fillStyle = gradient;
    target.fillRect(0, 0, 1, height);
  }

  function setTheme(next) {
    theme = next;
    paintBackdrop();
    dirty = true;
  }

  /* Position à l'écran d'un point du fond, décalée par la caméra selon sa profondeur. */
  function place(x, y, depth) {
    const shiftX = (-yaw / (Math.PI * 2)) * SPACE.parallax * depth;
    const shiftY = pitch * 0.12 * depth;
    const wrap = (value) => value - Math.floor(value);
    return { x: wrap(x + shiftX) * width, y: wrap(y + shiftY) * height };
  }

  function drawHalos() {
    const { halos } = theme.space;
    const radius = Math.max(width, height) * 0.55;
    halos.forEach((color, index) => {
      const t = clock * (0.018 + index * 0.007) + index * 2.1;
      const center = place(0.5 + Math.cos(t) * 0.32, 0.45 + Math.sin(t * 1.3) * 0.25, 0.3);
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    });
  }

  function drawStars() {
    ctx.fillStyle = '#FFFCF4';
    for (const star of stars) {
      const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(clock * star.speed * 0.5 + star.phase));
      const { x, y } = place(star.x, star.y, star.depth);
      const size = star.size * dpr;
      ctx.globalAlpha = twinkle * (0.4 + star.depth * 0.6);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      // Les plus grosses ont une petite croix, comme dans L'Avenir en commun.
      if (star.size > 1.6) {
        ctx.globalAlpha *= 0.45;
        ctx.fillRect(x - size * 2, y - dpr / 2, size * 4, dpr);
        ctx.fillRect(x - dpr / 2, y - size * 2, dpr, size * 4);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMotes() {
    ctx.fillStyle = '#ffffff';
    for (const mote of motes) {
      const y = mote.y - clock * mote.drift;
      const { x, y: screenY } = place(mote.x + Math.sin(clock * 0.3 + mote.phase) * 0.01, y, mote.depth);
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(clock + mote.phase);
      ctx.beginPath();
      ctx.arc(x, screenY, mote.size * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function updateShooting(dt) {
    if (!theme.space.stars) return;
    nextShooting -= dt;
    if (!shooting && nextShooting <= 0) {
      const [low, high] = SPACE.shootingEvery;
      nextShooting = low + Math.random() * (high - low);
      shooting = { x: Math.random() * 0.7, y: Math.random() * 0.4, age: 0, duration: 0.9 };
    }
    if (shooting) {
      shooting.age += dt;
      if (shooting.age > shooting.duration) shooting = null;
    }
  }

  function drawShooting() {
    if (!shooting) return;
    const progress = shooting.age / shooting.duration;
    const headX = (shooting.x + progress * 0.28) * width;
    const headY = (shooting.y + progress * 0.14) * height;
    const tail = 0.09 * width;
    const gradient = ctx.createLinearGradient(headX - tail, headY - tail / 2, headX, headY);
    gradient.addColorStop(0, 'rgba(255, 252, 244, 0)');
    gradient.addColorStop(1, `rgba(255, 252, 244, ${0.9 * (1 - progress)})`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX - tail, headY - tail / 2);
    ctx.lineTo(headX, headY);
    ctx.stroke();
  }

  /* Les objets flottants : dessinés au trait, sur une case de 2 x 2 autour de leur centre. */
  function drawObject(object) {
    const { objectInk, objectAccent, objectAlpha } = theme.space;
    const { x, y } = place(object.x, object.y + Math.sin(clock * 0.5 + object.bob) * 0.01, object.depth);
    const size = object.size * dpr * (0.7 + object.depth * 0.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(object.angle);
    ctx.scale(size / 2, size / 2);
    ctx.globalAlpha = objectAlpha * (0.5 + object.depth * 0.5);
    ctx.lineWidth = 0.09;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = objectInk;
    ctx.fillStyle = objectAccent;
    ctx.beginPath();
    if (object.kind === 'envelope') {
      ctx.rect(-1, -0.65, 2, 1.3);
      ctx.moveTo(-1, -0.65);
      ctx.lineTo(0, 0.1);
      ctx.lineTo(1, -0.65);
      ctx.stroke();
    } else if (object.kind === 'urn') {
      ctx.rect(-0.8, -0.5, 1.6, 1.3);
      ctx.moveTo(-0.35, -0.5);
      ctx.lineTo(0.35, -0.5);
      ctx.stroke();
      ctx.fillRect(-0.3, -1, 0.6, 0.62);   // le bulletin qui entre
    } else if (object.kind === 'ballot') {
      ctx.rect(-0.6, -0.85, 1.2, 1.7);
      ctx.moveTo(-0.35, -0.4);
      ctx.lineTo(0.35, -0.4);
      ctx.moveTo(-0.35, 0);
      ctx.lineTo(0.2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-0.2, 0.45, 0.17, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let point = 0; point < 10; point++) {
        const angle = -Math.PI / 2 + point * Math.PI / 5;
        const radius = point % 2 ? 0.42 : 1;
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      ctx.closePath();
      ctx.globalAlpha *= 0.8;
      ctx.fill();
    }
    ctx.restore();
  }

  function moveObjects(dt) {
    for (const object of objects) {
      object.x += object.vx * dt;
      object.y += object.vy * dt;
      object.angle += object.spin * dt;
    }
  }

  function paint() {
    ctx.drawImage(backdrop, 0, 0, width, height);
    drawHalos();
    if (theme.space.stars) {
      drawStars();
      drawShooting();
    } else {
      drawMotes();
    }
    for (const object of objects) drawObject(object);
  }

  /* À chaque image ; `camera` : { yaw, pitch } de la caméra du jeu. */
  function update(dt, camera) {
    const moved = camera && (Math.abs(camera.yaw - yaw) > 0.002 || Math.abs(camera.pitch - pitch) > 0.002);
    if (camera) {
      yaw = camera.yaw;
      pitch = camera.pitch;
    }
    elapsed += dt;
    if (still) {
      if (moved || dirty) paint();
      dirty = false;
      return;
    }
    if (elapsed < SPACE.frameTime && !moved && !dirty) return;
    const step = Math.min(elapsed, 0.1);
    elapsed = 0;
    dirty = false;
    clock += step;
    moveObjects(step);
    updateShooting(step);
    paint();
  }

  resize();
  return { resize, setTheme, update, redraw: paint };
}
