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
const CUBE_ASCII = write('cube.stl', new TextEncoder().encode(encodeAsciiSTL(cube(10))).buffer);

const upload = async (page, ...files) => {
  await page.setInputFiles('input[type=file]', files);
  await expect(page.locator('.file-row').first()).toBeVisible();
};
const convert = async (page) => {
  await page.getByRole('button', { name: /^Convert to SVG/ }).click();
  await expect(page.getByRole('button', { name: /^Convert to SVG/ })).toBeEnabled({ timeout: 60000 });
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
  await expect(page.locator('h1')).toHaveText('STL to SVG Converter');
  // Proves the CSS resolved relative to the sub-path rather than the domain root.
  await expect(page.locator('.dropzone')).toHaveCSS('border-style', 'dashed');
});

test('reads binary and ASCII STL and reports their size', async ({ page }) => {
  await upload(page, TORUS, CUBE_ASCII);
  await expect(page.locator('.file-row')).toHaveCount(2);
  await expect(page.locator('.file-row').first()).toContainText('4,096 triangles');
  await expect(page.locator('.file-row').first()).toContainText('40.0 × 40.0 × 10.0 mm');
  await expect(page.locator('.file-row').nth(1)).toContainText('12 triangles');
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
  await page.getByRole('tab', { name: 'Projection Outline' }).click();
  await convert(page);
  await expect(page.locator('.result-card .stats')).toContainText('2 paths');
});

test('the worker runs off the main thread — the UI stays responsive', async ({ page }) => {
  await upload(page, TORUS);
  await page.getByRole('button', { name: /^Convert to SVG/ }).click();
  // If conversion blocked the main thread this click could not land.
  await page.getByRole('button', { name: 'Reset View' }).click();
  await expect(page.getByRole('button', { name: /^Convert to SVG/ })).toBeEnabled({ timeout: 60000 });
});

test('rejects a corrupt file with a readable message', async ({ page }) => {
  const bad = write('broken.stl', new TextEncoder().encode('this is not an STL file at all').buffer);
  await upload(page, bad);
  await expect(page.locator('.file-row .err')).toBeVisible();
  await expect(page.locator('.file-row .err')).not.toContainText('DataView');
});

test('a custom plane orientation converts', async ({ page }) => {
  await upload(page, TORUS);
  await page.selectOption('#plane', 'custom');
  await expect(page.locator('#yaw')).toBeVisible();
  await convert(page);
  await expect(page.locator('.result-card .stats')).toContainText(/\d+ path/);
});

test('changing output units changes the SVG dimensions', async ({ page }) => {
  await upload(page, CUBE_ASCII);
  await convert(page);
  const read = async () => {
    const src = await page.locator('.result-card img').getAttribute('src');
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
  await expect(page.getByRole('button', { name: 'Download All SVG' })).toBeEnabled();
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
