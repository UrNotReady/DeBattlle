'use strict';

/* Mini-carte : la caméra 3D ne montre que ce qui est devant ; la mini-carte
   montre toute l'arène, un pixel par unité, et la position du joueur. */

const MINIMAP_REFRESH = 0.25;   // secondes entre deux mises à jour
const LAND_RGB = [238, 249, 252];   // sol libre
const BORDER_RGB = [176, 208, 222]; // limite entre deux régions

function createMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  let size = 0;                 // côté de la carte : un pixel par unité d'arène
  let image = null;
  let paintedYaw = 0;
  const rgbByColor = new Map();
  let wait = 0;

  function toRgb(hex) {
    if (!rgbByColor.has(hex)) {
      rgbByColor.set(hex, [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)));
    }
    return rgbByColor.get(hex);
  }

  function fitTo(grid) {
    if (size === grid.arenaSize) return;
    size = grid.arenaSize;
    canvas.width = size;
    canvas.height = size;
    image = ctx.createImageData(size, size);
  }

  function paintTerritories(game) {
    const { grid, lands } = game;
    fitTo(grid);
    const middle = Math.floor(grid.resolution / 2);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const owner = grid.owner[(y * grid.resolution + middle) * grid.size + x * grid.resolution + middle];
        const pixel = (y * size + x) * 4;
        const index = (y * grid.resolution + middle) * grid.size + x * grid.resolution + middle;
        if (grid.playable[index] === 0) {
          image.data[pixel + 3] = 0;   // hors de l'arène : on voit l'eau
          continue;
        }
        const region = grid.regionOf[index];
        const onBorder = owner === 0 && region !== 0 && x + 1 < size && y + 1 < size &&
          ((grid.regionOf[index + grid.resolution] || region) !== region || (grid.regionOf[index + grid.resolution * grid.size] || region) !== region);
        const [red, green, blue] = owner !== 0 ? toRgb(lands[owner - 1].colors.main) : onBorder ? BORDER_RGB : LAND_RGB;
        image.data[pixel] = red;
        image.data[pixel + 1] = green;
        image.data[pixel + 2] = blue;
        image.data[pixel + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  /* Le joueur, et un cône dans la direction où regarde la caméra. */
  function paintPlayer(player, yaw) {
    const reach = size * 0.11;
    const forward = yaw - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.arc(player.x, player.y, reach, forward - 0.45, forward + 0.45);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(player.x, player.y, size * 0.037, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = size * 0.02;
    ctx.strokeStyle = PALETTE.ink;
    ctx.stroke();
  }

  /* Repeinte quatre fois par seconde, et aussitôt que la caméra pivote. */
  function update(game, dt, yaw) {
    wait -= dt;
    if (wait > 0 && Math.abs(angleDifference(paintedYaw, yaw)) < 0.03) return;
    wait = MINIMAP_REFRESH;
    paintedYaw = yaw;
    paintTerritories(game);
    if (game.player && game.player.alive) paintPlayer(game.player, yaw);
  }

  return { update, refreshNow: () => { wait = 0; } };
}
