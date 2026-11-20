'use strict';

/* Caméra en perspective. Elle se tient derrière le point suivi, en
   hauteur, et regarde devant elle en plongée. Le joueur peut l'incliner,
   l'approcher et la faire pivoter (`yaw`) : à 0, elle regarde vers le nord.

   Repère de l'arène : x vers l'est, y vers le sud, z vers le haut.
   Repère de la caméra : `side` vers la droite, `up` vers le haut de l'écran,
   `depth` vers l'avant. Un point n'est visible que si `depth` dépasse `near`.
   Au sol, `ahead` est la distance devant la caméra, dans la direction où
   elle regarde. */

const CAMERA = Object.freeze({
  distance: 26.6,         // distance entre la caméra et le point suivi, en unités
  pitch: 0.3,             // inclinaison de départ vers le bas, en radians (environ 17°)
  minPitch: 0.24,         // vue la plus rasante
  maxPitch: 1.25,         // vue la plus plongeante (environ 72°), presque du dessus
  aimOffset: 0.045,       // le point suivi est visé un peu sous le centre de l'écran
  focalFactor: 1.07,      // focale = 1,07 x hauteur d'écran (champ vertical d'environ 50°)
  minPixelsPerUnit: 26,   // taille minimale d'une unité à hauteur du joueur, en pixels CSS
  near: 1,                // rien n'est dessiné plus près que cette distance
  minZoom: 0.4,           // zoom arrière maximal
  maxZoom: 1.8,           // zoom avant maximal
});

function createProjection() {
  const projection = {
    width: 0, height: 0, dpr: 1, focal: 1, centerX: 0, centerY: 0, horizonY: 0,
    x: 0, y: 0, z: 0, zoom: 1, pitch: CAMERA.pitch, yaw: 0,
    rightX: 1, rightY: 0,          // direction « droite de l'écran », au sol
    forwardX: 0, forwardY: -1,     // direction « devant », au sol
  };
  let sin = Math.sin(CAMERA.pitch);
  let cos = Math.cos(CAMERA.pitch);

  const updateHorizon = () => {
    projection.horizonY = projection.centerY - projection.focal * Math.tan(projection.pitch);
  };

  projection.configure = (width, height, dpr) => {
    projection.width = width;
    projection.height = height;
    projection.dpr = dpr;
    projection.focal = Math.max(CAMERA.focalFactor * height, CAMERA.minPixelsPerUnit * dpr * CAMERA.distance);
    projection.centerX = width / 2;
    projection.centerY = height / 2;
    updateHorizon();
  };

  /* Zoom : la caméra s'approche ou s'éloigne du point suivi, sans changer d'angle. */
  projection.zoomBy = (factor) => {
    projection.zoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, projection.zoom * factor));
  };

  /* Inclinaison : la caméra tourne autour du point suivi, de la vue rasante
     à la vue presque du dessus. Renvoie vrai si l'angle a changé. */
  projection.tiltBy = (angle) => {
    const pitch = Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, projection.pitch + angle));
    if (pitch === projection.pitch) return false;
    projection.pitch = pitch;
    sin = Math.sin(pitch);
    cos = Math.cos(pitch);
    updateHorizon();
    return true;
  };

  /* Orientation : la caméra pivote autour du point suivi. Angle en radians,
     dans le sens des aiguilles d'une montre vu du dessus ; 0 = vers le nord. */
  projection.setYaw = (yaw) => {
    projection.yaw = angleDifference(0, yaw);
    projection.rightX = Math.cos(projection.yaw);
    projection.rightY = Math.sin(projection.yaw);
    projection.forwardX = Math.sin(projection.yaw);
    projection.forwardY = -Math.cos(projection.yaw);
  };

  /* Place la caméra derrière le point (x, y) du sol, à la distance voulue. */
  projection.follow = (x, y) => {
    const distance = CAMERA.distance / projection.zoom;
    const elevation = projection.pitch + CAMERA.aimOffset;
    const behind = Math.cos(elevation) * distance;
    projection.x = x - projection.forwardX * behind;
    projection.y = y - projection.forwardY * behind;
    projection.z = Math.sin(elevation) * distance;
  };

  /* Coordonnées d'un point dans le repère de la caméra. */
  projection.side = (x, y) => (x - projection.x) * projection.rightX + (y - projection.y) * projection.rightY;
  projection.ahead = (x, y) => (x - projection.x) * projection.forwardX + (y - projection.y) * projection.forwardY;
  projection.up = (x, y, z) => projection.ahead(x, y) * sin + (z - projection.z) * cos;
  projection.depth = (x, y, z) => projection.ahead(x, y) * cos - (z - projection.z) * sin;

  /* Position à l'écran d'un point de l'arène, ou null s'il est trop près
     ou derrière la caméra. `scale` : pixels par unité à cette distance. */
  projection.toScreen = (x, y, z) => {
    const ahead = projection.ahead(x, y);
    const height = z - projection.z;
    const depth = ahead * cos - height * sin;
    if (depth < CAMERA.near) return null;
    const scale = projection.focal / depth;
    return {
      x: projection.centerX + projection.side(x, y) * scale,
      y: projection.centerY - (ahead * sin + height * cos) * scale,
      scale,
    };
  };

  /* Direction au sol (angle de l'arène) qui correspond à une direction de
     l'écran : « haut de l'écran » = devant la caméra. */
  projection.screenToWorldAngle = (screenAngle) => screenAngle + projection.yaw;

  /* Ligne du sol (hauteur 0) visible sur une ligne de l'écran : sa distance
     `ahead` devant la caméra et l'échelle `scale` (pixels par unité) à
     cette distance. Renvoie null au-dessus de l'horizon. */
  projection.groundRow = (screenY) => {
    const slope = (projection.centerY - screenY) / projection.focal;
    const denominator = sin - slope * cos;
    if (denominator <= 1e-4) return null;
    const depth = projection.z / denominator;
    return { ahead: depth * (cos + slope * sin), scale: projection.focal / depth };
  };

  /* Ajoute au tracé un polygone horizontal [x0, y0, x1, y1, ...] situé à la
     hauteur z, en coupant ce qui dépasse derrière la caméra. Le polygone
     peut être décalé de (offsetX, offsetY) dans l'arène. */
  projection.addPolygon = (path, coords, z, offsetX = 0, offsetY = 0) => {
    const { focal, centerX, centerY } = projection;
    const count = coords.length / 2;
    let started = false;
    const emit = (side, up, depth) => {
      const scale = focal / depth;
      const screenX = centerX + side * scale;
      const screenY = centerY - up * scale;
      if (started) path.lineTo(screenX, screenY);
      else path.moveTo(screenX, screenY);
      started = true;
    };

    const height = z - projection.z;
    const lastX = coords[count * 2 - 2] + offsetX;
    const lastY = coords[count * 2 - 1] + offsetY;
    let lastSide = projection.side(lastX, lastY);
    let lastAhead = projection.ahead(lastX, lastY);
    let lastUp = lastAhead * sin + height * cos;
    let lastDepth = lastAhead * cos - height * sin;
    for (let i = 0; i < count; i++) {
      const x = coords[i * 2] + offsetX;
      const y = coords[i * 2 + 1] + offsetY;
      const side = projection.side(x, y);
      const ahead = projection.ahead(x, y);
      const up = ahead * sin + height * cos;
      const depth = ahead * cos - height * sin;
      const isVisible = depth >= CAMERA.near;
      if (isVisible !== (lastDepth >= CAMERA.near)) {
        // L'arête traverse le plan de coupe : on ajoute le point d'intersection.
        const ratio = (CAMERA.near - lastDepth) / (depth - lastDepth);
        emit(lastSide + (side - lastSide) * ratio, lastUp + (up - lastUp) * ratio, CAMERA.near);
      }
      if (isVisible) emit(side, up, depth);
      lastSide = side;
      lastUp = up;
      lastDepth = depth;
    }
    if (started) path.closePath();
  };

  return projection;
}
