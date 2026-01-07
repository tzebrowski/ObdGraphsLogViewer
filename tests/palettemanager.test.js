import { PaletteManager } from '../src/palettemanager.js';

test('PaletteManager returns consistent colors for the same index', () => {
  const color1 = PaletteManager.getColorForSignal(0, 1);
  const color2 = PaletteManager.getColorForSignal(0, 1);
  expect(color1).toBe(color2);
  expect(color1).toMatch(/^#/); // Should be a hex code
});
