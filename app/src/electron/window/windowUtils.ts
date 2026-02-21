// This file provides geometric window shape utilities for rounded corners on Windows.

/**
 * Creates the rounded window shape for Windows
 */
export function createRoundedShape(
  width: number,
  height: number,
  radius: number = 4,
) {
  const shapes = [];

  for (let y = 0; y < height; y++) {
    let startX = 0;
    let endX = width;

    // Top-left and Top-right corners
    if (y < radius) {
      const offset = Math.ceil(
        radius - Math.sqrt(radius * radius - (radius - y) * (radius - y)),
      );
      startX = offset;
      endX = width - offset;
    }

    // Bottom-left and Bottom-right corners
    if (y >= height - radius) {
      const offset = Math.ceil(
        radius -
          Math.sqrt(
            radius * radius - (y - (height - radius)) * (y - (height - radius)),
          ),
      );
      startX = offset;
      endX = width - offset;
    }

    if (endX > startX) {
      shapes.push({ x: startX, y, width: endX - startX, height: 1 });
    }
  }

  return shapes;
}
