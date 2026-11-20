'use strict';

/* Texture du sol, vue du dessus : un dégradé bleuté lisse, éclairé selon le
   relief (c'est cet éclairage qui dessine les collines), où les limites de
   régions sont tracées en filigrane. Elle est peinte une fois par forme
   d'arène, puis mise en perspective par le rendu. */

const GROUND = Object.freeze({
  textureSize: 640,            // côté de la texture, en pixels, quelle que soit la taille de l'arène
  shadow: [142, 190, 212],     // creux et pentes à l'ombre
  light: [250, 254, 255],      // pentes éclairées
  border: [104, 160, 190],     // limites de régions
  borderStrength: 0.42,
});

function buildGroundTexture(grid) {
  const size = GROUND.textureSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const unit = grid.arenaSize / size;   // côté d'un pixel, en unités d'arène
  // Région de chaque pixel, calculée directement d'après les villes : les
  // limites sont ainsi des droites nettes, sans l'escalier de la grille.
  const regionOfPixel = new Uint8Array(size * size);
  if (grid.regions.length > 0) {
    for (let pixel = 0; pixel < regionOfPixel.length; pixel++) {
      regionOfPixel[pixel] = nearestRegion(grid.regions, (pixel % size + 0.5) * unit, (Math.floor(pixel / size) + 0.5) * unit);
    }
  }

  for (let pixelY = 0; pixelY < size; pixelY++) {
    for (let pixelX = 0; pixelX < size; pixelX++) {
      const x = (pixelX + 0.5) * unit;
      const y = (pixelY + 0.5) * unit;
      // La lumière vient de la droite : les pentes tournées vers l'est sont claires.
      const slopeEast = (terrainHeight(x + 0.5, y) - terrainHeight(x - 0.5, y));
      const slopeSouth = (terrainHeight(x, y + 0.5) - terrainHeight(x, y - 0.5));
      const light = Math.max(0, Math.min(1, 0.64 - slopeEast * 2.3 + slopeSouth * 1.3));

      const here = pixelY * size + pixelX;
      const onBorder = pixelX + 1 < size && pixelY + 1 < size &&
        (regionOfPixel[here + 1] !== regionOfPixel[here] || regionOfPixel[here + size] !== regionOfPixel[here]);
      const pixel = here * 4;
      for (let channel = 0; channel < 3; channel++) {
        let value = GROUND.shadow[channel] + (GROUND.light[channel] - GROUND.shadow[channel]) * light;
        if (onBorder) value += (GROUND.border[channel] - value) * GROUND.borderStrength;
        image.data[pixel + channel] = value;
      }
      image.data[pixel + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
