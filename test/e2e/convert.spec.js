import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cube, torus, encodeBinarySTL, encodeAsciiSTL } from '../fixtures.mjs';

// Fixtures are written to a temp dir at run time — no binaries in the repo.
const dir = mkdtempSync(join(tmpdir(), 'stl-e2e-'));
const write = (name, buf) => {
  const p = join(dir, name);
  writeFileSync(p, Buffer.from(buf));
  return p;
};
const TORUS = write('torus.stl', encodeBinarySTL(torus()));
// A part three times taller than wide — its preview must still fit its box.
const TALL = write('tall.stl', encodeBinarySTL(cube(10).map((t) => t.map(([x, y, z]) => [x, y * 3, z]))));
const CUBE_ASCII = write('cube.stl', new TextEncoder().encode(encodeAsciiSTL(cube(10))).buffer);

// "Convert to SVG" for one file, "Convert 2 files" for a batch, "Converting…" while busy.
const CONVERT = /^Convert/;

const upload = async (page, ...files) => {
  await page.setInputFiles('input[type=file]', files);
  await expect(page.locator('.file-row').first()).toBeVisible();
};
const convert = async (page) => {
  await page.getByRole('button', { name: CONVERT }).click();
  await expect(page.getByRole('button', { name: CONVERT })).toBeEnabled({ timeout: 60000 });
};

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.errors = errors;
  await page.goto('./');
});

test.afterEach(async ({ page }) => {
  expect(page.errors, 'no console errors or unhandled exceptions').toEqual([]);
});

test('loads from a sub-path with assets and worker intact', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('STL to SVG converter');
  // Proves the CSS resolved relative to the sub-path rather than the domain root.
  await expect(page.locator('.dropzone')).toHaveCSS('border-style', 'dashed');
});

test('reads binary and ASCII STL and reports their size', async ({ page }) => {
  await upload(page, TORUS, CUBE_ASCII);
  await expect(page.locator('.file-row')).toHaveCount(2);
  await expect(page.locator('.file-row').first()).toContainText('4,096 tri');
  await expect(page.locator('.file-row').first()).toContainText('40.0 × 40.0 × 10.0 mm');
  await expect(page.locator('.file-row').nth(1)).toContainText('12 tri');
});

test('intersection mode slices a torus into two closed rings', async ({ page }) => {
  await upload(page, TORUS);
  await convert(page);
  await expect(page.locator('.result-card')).toHaveCount(1);
  await expect(page.locator('.result-card .stats')).toContainText('2 paths');

  const svg = await page.locator('.result-card img').getAttribute('src');
  const text = await page.evaluate((u) => fetch(u).then((r) => r.text()), svg);
  expect(text).toContain('<svg');
  expect((text.match(/<path/g) || []).length).toBe(2);
});

test('projection mode outlines the silhouette', async ({ page }) => {
  await upload(page, TORUS);
  await page.getByRole('radio', { name: 'Projection' }).click();
  await convert(page);
  await expect(page.locator('.result-card .stats')).toContainText('2 paths');
});

test('the worker runs off the main thread — the UI stays responsive', async ({ page }) => {
  await upload(page, TORUS);
  await page.getByRole('button', { name: CONVERT }).click();
  // If conversion blocked the main thread this click could not land.
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('button', { name: CONVERT })).toBeEnabled({ timeout: 60000 });
});

test('rejects a corrupt file with a readable message', async ({ page }) => {
  const bad = write('broken.stl', new TextEncoder().encode('this is not an STL file at all').buffer);
  await upload(page, bad);
  await expect(page.locator('.file-row .err')).toBeVisible();
  await expect(page.locator('.file-row .err')).not.toContainText('DataView');
});

test('a custom plane orientation converts', async ({ page }) => {
  await upload(page, TORUS);
  await page.getByRole('button', { name: 'Custom' }).click();
  await expect(page.locator('#yaw')).toBeVisible();
  await convert(page);
  await expect(page.locator('.result-card .stats')).toContainText(/\d+ path/);
});

test('changing output units changes the SVG dimensions', async ({ page }) => {
  await upload(page, CUBE_ASCII);
  await convert(page);
  // New cuts are added in front, so the latest one is always first.
  const read = async () => {
    const src = await page.locator('.result-card img').first().getAttribute('src');
    return page.evaluate((u) => fetch(u).then((r) => r.text()), src);
  };
  expect(await read()).toContain('width="20.1mm"');

  await page.selectOption('#unit', 'in');
  await convert(page);
  expect(await read()).toContain('in"');
});

test('converts a batch of files and offers every result for download', async ({ page }) => {
  await upload(page, TORUS, CUBE_ASCII);
  await convert(page);
  await expect(page.locator('.result-card')).toHaveCount(2);
  for (const card of await page.locator('.result-card').all()) {
    await expect(card.locator('.stats')).toContainText(/\d+ path/);
    await expect(card.getByRole('button', { name: 'Download SVG' })).toBeEnabled();
  }
  await expect(page.getByRole('button', { name: 'Download all' })).toBeEnabled();
});

test('enlarging a preview opens and closes the lightbox', async ({ page }) => {
  await upload(page, CUBE_ASCII);
  await convert(page);
  await page.locator('.result-card .thumb').click();
  await expect(page.locator('dialog.lightbox')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('dialog.lightbox')).toBeHidden();
});

test('removing a file clears it from the workspace', async ({ page }) => {
  await upload(page, TORUS, CUBE_ASCII);
  await page.getByRole('button', { name: /^Remove torus/ }).click();
  await expect(page.locator('.file-row')).toHaveCount(1);
  await expect(page.locator('.file-row')).toContainText('cube.stl');
});

test('measuring view measures, switches between SVGs and closes', async ({ page }) => {
  await upload(page, CUBE_ASCII, TORUS);
  await convert(page);
  await page.locator('.result-card').first().getByRole('button', { name: 'Measure' }).click();

  const view = page.getByRole('dialog', { name: 'Measure SVG' });
  await expect(view).toBeVisible();
  await expect(view.locator('.measure-size')).toHaveText('20.00 × 20.00 mm');

  // Click two opposite corners near (not on) the vertices — snapping should
  // land on them exactly and report the diagonal of the 20 mm cube face.
  const box = await view.getByTestId('measure-canvas').boundingBox();
  const corner = (fx, fy) => page.evaluate(([fx, fy]) => {
    const svg = document.querySelector('[data-testid=measure-canvas]');
    const r = svg.querySelector('.m-bounds');
    const m = r.getScreenCTM();
    const x = +r.getAttribute('x') + fx * +r.getAttribute('width');
    const y = +r.getAttribute('y') + fy * +r.getAttribute('height');
    return { x: m.a * x + m.e + 3, y: m.d * y + m.f - 3 };
  }, [fx, fy]);
  const a = await corner(0, 1);
  const b = await corner(1, 0);
  expect(box).not.toBeNull();
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect(view.locator('.measure-list li')).toHaveCount(1);
  await expect(view.locator('.measure-list li').first()).toContainText('28.28 mm');
  await expect(view.locator('.measure-list li').first()).toContainText('Δx 20.00 mm · Δy 20.00 mm');

  await view.getByRole('button', { name: 'torus.stl' }).click();
  await expect(view.locator('.measure-title strong')).toHaveText('torus.stl');
  await expect(view.locator('.measure-list li')).toHaveCount(0);

  // A single Esc must not close the view; a quick second one does.
  await page.keyboard.press('Escape');
  await expect(view.locator('.measure-status')).toContainText('Press Esc again to close');
  await page.waitForTimeout(700);
  await expect(view).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();

  await page.locator('.result-card').first().getByRole('button', { name: 'Measure' }).click();
  await view.getByRole('button', { name: 'Close' }).click();
  await expect(view).toBeHidden();
});

test('angle tool and 45° snap measure a square exactly', async ({ page }) => {
  await upload(page, CUBE_ASCII);
  await convert(page);
  await page.getByRole('button', { name: 'Measure' }).click();
  const view = page.getByRole('dialog', { name: 'Measure SVG' });

  // Screen position of a point given as fractions of the square (0,0 = bottom left).
  const at = (fx, fy, nudge = 0) => page.evaluate(([fx, fy, nudge]) => {
    const r = document.querySelector('[data-testid=measure-canvas] .m-bounds');
    const m = r.getScreenCTM();
    const x = +r.getAttribute('x') + fx * +r.getAttribute('width');
    const y = +r.getAttribute('y') + (1 - fy) * +r.getAttribute('height');
    return { x: m.a * x + m.e + nudge, y: m.d * y + m.f - nudge };
  }, [fx, fy, nudge]);
  const click = async (p) => page.mouse.click(p.x, p.y);

  await view.getByRole('radio', { name: 'Angle' }).click();
  await click(await at(0, 0, 3)); // vertex
  await click(await at(1, 0, 3)); // along the bottom edge
  await click(await at(1, 1, 3)); // to the opposite corner
  await expect(view.locator('.measure-list li').first()).toContainText('45.0°');

  // With the lock on, a sloppy click from the left edge still measures a
  // perfectly horizontal line that ends on the right edge.
  await view.getByRole('radio', { name: 'Distance' }).click();
  await view.getByRole('button', { name: '45° snap' }).click();
  await expect(view.getByRole('button', { name: '45° snap' })).toHaveAttribute('aria-pressed', 'true');
  await click(await at(0, 0.5));
  const edge = await at(1, 0.5);
  await page.mouse.click(edge.x - 6, edge.y - 5); // Just short of the edge and off-axis.
  const li = view.locator('.measure-list li').nth(1);
  await expect(li).toContainText('20.00 mm');
  await expect(li).toContainText('Δy 0.00 mm');
  await expect(li).toContainText('∠ 0.0°');
});

test('a tall part\'s preview stays inside its thumbnail', async ({ page }) => {
  await upload(page, TALL);
  await convert(page);
  const thumb = await page.locator('.result-card .thumb').boundingBox();
  const img = await page.locator('.result-card .thumb img').boundingBox();
  expect(img.y).toBeGreaterThanOrEqual(thumb.y);
  expect(img.y + img.height).toBeLessThanOrEqual(thumb.y + thumb.height + 0.5);
  expect(img.x + img.width).toBeLessThanOrEqual(thumb.x + thumb.width + 0.5);
});

test('cuts accumulate instead of replacing each other', async ({ page }) => {
  await upload(page, CUBE_ASCII);
  await convert(page);
  await page.getByLabel('Plane offset value').fill('5');
  await convert(page);

  const cards = page.locator('.result-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.cut-label')).toHaveText('Section · XY @ 5.00 mm');
  await expect(cards.nth(1).locator('.cut-label')).toHaveText('Section · XY @ 0.00 mm');

  // The same settings again replace that cut rather than duplicating it.
  await convert(page);
  await expect(cards).toHaveCount(2);

  // Each cut downloads under its own name.
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    cards.nth(0).getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('cube-section-XY-5.00mm.svg');

  await cards.nth(1).getByRole('button', { name: /^Delete cut/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('.cut-label')).toHaveText('Section · XY @ 5.00 mm');

  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(cards).toHaveCount(0);
});

test('removing a file keeps the cuts made from it', async ({ page }) => {
  await upload(page, CUBE_ASCII);
  await convert(page);
  await page.getByRole('button', { name: /^Remove cube/ }).click();
  await expect(page.locator('.file-row')).toHaveCount(0);
  await expect(page.locator('.result-card')).toHaveCount(1);
});
