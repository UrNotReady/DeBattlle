'use strict';

/* Contrôles : clavier, souris et tactile. Tous appellent `onHeading` avec
   un cap à l'écran en radians (0 = droite, PI / 2 = bas), ou `null` quand
   le joueur ne donne plus de direction (touches et doigt relâchés) : le jeu
   décide, selon le mode de contrôle, s'il s'arrête ou garde son cap.
   `onConfirm` répond à Entrée / Espace. Le jeu se charge d'arrondir le virage. */

/* `event.code` désigne la touche physique : KeyW / KeyA correspondent
   à Z / Q sur un clavier AZERTY, et à W / A sur un QWERTY. */
const KEY_VECTORS = Object.freeze({
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
});

const KEY_ABILITIES = Object.freeze({ Space: 'boost', KeyE: 'dash', KeyR: 'bomb', KeyV: 'radar', KeyB: 'scout' });

/* Durées et distances d'un tap, pour reconnaître le double tap (ou double clic). */
const TAP = Object.freeze({ maxDuration: 250, maxGap: 320, maxSpread: 40 });

/* Les touches enfoncées s'additionnent : haut + droite donne la diagonale.
   Une compétence part à l'appui ; `onAbilityEnd` signale qu'on la relâche
   (le dash se vise touche enfoncée et part au relâchement). F : s'arrêter.
   C : caméra libre. Tab : classement complet, tant qu'on la tient. */
function setupKeyboard({ onHeading, onConfirm, onAbility, onAbilityEnd, onHalt, onPause, onCamera, onScoreboard }) {
  const heldKeys = new Set();

  const applyHeldKeys = () => {
    let x = 0;
    let y = 0;
    for (const code of heldKeys) {
      x += KEY_VECTORS[code][0];
      y += KEY_VECTORS[code][1];
    }
    onHeading(x !== 0 || y !== 0 ? Math.atan2(y, x) : null);
  };

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Dans un champ de texte, toutes les touches servent à écrire.
    if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
    if (event.code === 'Escape' || event.code === 'KeyP') {
      if (!event.repeat && onPause()) event.preventDefault();
      return;
    }
    if (event.code === 'Tab') {
      if (onScoreboard(true)) event.preventDefault();
      return;
    }
    if (KEY_VECTORS[event.code]) {
      event.preventDefault();
      if (event.repeat) return;
      heldKeys.add(event.code);
      applyHeldKeys();
      return;
    }
    if (event.repeat) return;
    // Sur un bouton ou une case à cocher, la touche garde son rôle habituel.
    if (event.target instanceof Element && event.target.closest('button, input, label')) return;
    // Entrée / Espace lancent une partie ; en jeu, Espace, E et R déclenchent les compétences.
    if ((event.code === 'Enter' || event.code === 'Space') && onConfirm()) {
      event.preventDefault();
    } else if (KEY_ABILITIES[event.code]) {
      event.preventDefault();
      onAbility(KEY_ABILITIES[event.code]);
    } else if (event.code === 'KeyF') {
      onHalt();
    } else if (event.code === 'KeyC') {
      onCamera();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Tab') onScoreboard(false);
    if (heldKeys.delete(event.code)) applyHeldKeys();
    else if (KEY_ABILITIES[event.code]) onAbilityEnd(KEY_ABILITIES[event.code]);
  });
  window.addEventListener('blur', () => {
    if (heldKeys.size) {
      heldKeys.clear();
      onHeading(null);
    }
    onAbilityEnd('dash');
    onScoreboard(false);
  });
}

/* Un doigt pilote, deux doigts règlent la caméra (zoom, inclinaison, rotation).
   Le cube suit le mouvement du pouce, n'importe où sur l'arène. Un point
   d'appui suit le doigt comme au bout d'une laisse courte ; le cap est la
   direction qui va de ce point au doigt, donc celle du geste en cours.
   Dessiner une courbe avec le pouce fait décrire la même courbe au cube.
   Lever le doigt envoie `null` (plus de direction).
   En contrôle manuel (`followsMouse()` vrai), le clic gauche maintenu dirige
   le cube vers la souris : `pointTo()` donne sa position à l'écran.
   Deux taps rapides au même endroit (ou un double clic) : `onDoubleTap`.
   Renvoie `update()`, à appeler à chaque image : le cap vers la souris suit
   le cube qui se déplace.
   Caméra libre (`isPanning()` vrai) : un doigt, ou le clic gauche,
   fait glisser l'arène (`onPan(dx, dy)`, en pixels). */
function setupTouch(surface, { onHeading, onDoubleTap, followsMouse, pointTo, onZoom, onTilt, onRotate, isPanning, onPan }) {
  const { deadZone, leash, tiltPerPixel, twistThreshold, rotatePerPixel } = CONFIG.touch;
  const touches = new Map();    // doigts posés : identifiant -> position
  let steeringPointer = null;   // le doigt qui pilote, tant qu'il est seul
  let anchorX = 0;
  let anchorY = 0;
  let pinch = null;             // geste à deux doigts : écart, hauteur et angle précédents
  let cameraDrag = null;        // clic droit maintenu, sur ordinateur
  let mouseSteer = null;        // clic gauche maintenu en contrôle manuel : position de la souris
  let lastTap = null;           // dernier tap : moment et position
  let panPointer = null;        // caméra libre : le doigt (ou le clic) qui fait glisser l'arène

  const twoFingers = () => {
    const [first, second] = [...touches.values()];
    return {
      spread: Math.hypot(first.x - second.x, first.y - second.y),
      height: (first.y + second.y) / 2,
      angle: Math.atan2(second.y - first.y, second.x - first.x),
    };
  };

  surface.addEventListener('pointerdown', (event) => {
    if (surface.setPointerCapture) {
      try { surface.setPointerCapture(event.pointerId); } catch (error) { /* pointeur déjà relâché */ }
    }
    if (event.pointerType === 'mouse' && event.button === 2) {
      cameraDrag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    touches.set(event.pointerId, {
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, startTime: event.timeStamp,
    });
    if (touches.size === 1 && isPanning()) {
      panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      return;
    }
    if (event.pointerType === 'mouse' && followsMouse()) {
      mouseSteer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      steerToMouse();
      return;
    }
    if (touches.size === 2) {
      // Deux doigts : on règle la caméra, on ne pilote plus.
      if (steeringPointer !== null) onHeading(null);
      steeringPointer = null;
      pinch = { ...twoFingers(), twist: 0, rotating: false };
    } else if (touches.size === 1) {
      steeringPointer = event.pointerId;
      anchorX = event.clientX;
      anchorY = event.clientY;
    }
  });

  /* Deux doigts : les écarter zoome, les glisser ensemble vers le haut ou
     le bas incline la vue, les faire tourner fait pivoter la caméra. La
     rotation ne démarre qu'au-delà d'un petit angle, pour qu'un simple
     pincement ne fasse pas tourner la vue par accident. */
  function adjustCamera() {
    const now = twoFingers();
    if (pinch.spread > 0 && now.spread > 0) onZoom(now.spread / pinch.spread);
    onTilt((now.height - pinch.height) * tiltPerPixel);
    const twist = angleDifference(pinch.angle, now.angle);
    pinch.twist += twist;
    if (!pinch.rotating && Math.abs(pinch.twist) > twistThreshold) pinch.rotating = true;
    // Les doigts tournent dans un sens, le paysage les suit : la caméra tourne dans l'autre.
    if (pinch.rotating) onRotate(-twist);
    Object.assign(pinch, { spread: now.spread, height: now.height, angle: now.angle });
  }

  function steer(event) {
    const deltaX = event.clientX - anchorX;
    const deltaY = event.clientY - anchorY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < deadZone) return;
    onHeading(Math.atan2(deltaY, deltaX));
    if (distance > leash) {
      const excess = (distance - leash) / distance;
      anchorX += deltaX * excess;
      anchorY += deltaY * excess;
    }
  }

  function steerToMouse() {
    const target = pointTo();
    if (!target) return;
    const deltaX = mouseSteer.x - target.x;
    const deltaY = mouseSteer.y - target.y;
    // Souris posée sur le cube : on garde le cap en cours.
    if (Math.hypot(deltaX, deltaY) > deadZone) onHeading(Math.atan2(deltaY, deltaX));
  }

  /* Un tap : un appui court, sans glisser. Deux taps rapprochés font un double tap. */
  function checkTap(touch, event) {
    const moved = Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY);
    if (moved > deadZone || event.timeStamp - touch.startTime > TAP.maxDuration) {
      lastTap = null;
      return;
    }
    const isDouble = lastTap && event.timeStamp - lastTap.time < TAP.maxGap &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < TAP.maxSpread;
    if (isDouble) {
      lastTap = null;
      onDoubleTap();
    } else {
      lastTap = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    }
  }

  surface.addEventListener('pointermove', (event) => {
    if (cameraDrag && event.pointerId === cameraDrag.id) {
      // Clic droit glissé : à gauche ou à droite, la caméra pivote ; en haut ou en bas, elle s'incline.
      onRotate((event.clientX - cameraDrag.x) * rotatePerPixel);
      onTilt((event.clientY - cameraDrag.y) * tiltPerPixel);
      cameraDrag.x = event.clientX;
      cameraDrag.y = event.clientY;
      return;
    }
    if (mouseSteer && event.pointerId === mouseSteer.id) {
      mouseSteer.x = event.clientX;
      mouseSteer.y = event.clientY;
      steerToMouse();
      return;
    }
    const touch = touches.get(event.pointerId);
    if (!touch) return;
    touch.x = event.clientX;
    touch.y = event.clientY;
    if (panPointer && event.pointerId === panPointer.id && touches.size === 1) {
      onPan(event.clientX - panPointer.x, event.clientY - panPointer.y);
      panPointer.x = event.clientX;
      panPointer.y = event.clientY;
      return;
    }
    if (touches.size === 2) {
      if (panPointer) panPointer = null;
      if (!pinch) pinch = { ...twoFingers(), twist: 0, rotating: false };
      adjustCamera();
    }
    else if (event.pointerId === steeringPointer) steer(event);
  });

  const release = (event) => {
    if (cameraDrag && event.pointerId === cameraDrag.id) cameraDrag = null;
    const touch = touches.get(event.pointerId);
    if (touch && touches.size === 1 && !pinch && event.type === 'pointerup') checkTap(touch, event);
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (panPointer && event.pointerId === panPointer.id) panPointer = null;
    if (mouseSteer && event.pointerId === mouseSteer.id) {
      mouseSteer = null;
      onHeading(null);
    }
    if (event.pointerId === steeringPointer) {
      steeringPointer = null;
      onHeading(null);
    }
  };
  surface.addEventListener('pointerup', release);
  surface.addEventListener('pointercancel', release);

  /* Sur ordinateur, la molette zoome ; avec Maj enfoncée, elle incline la caméra. */
  surface.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.shiftKey) onTilt((event.deltaY || event.deltaX) * 0.001);
    else onZoom(Math.exp(-event.deltaY * 0.0015));
  }, { passive: false });

  /* Aucun défilement, zoom ni menu contextuel pendant la partie. */
  surface.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  surface.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    update() {
      if (mouseSteer) steerToMouse();
    },
  };
}
