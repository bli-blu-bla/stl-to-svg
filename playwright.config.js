import { defineConfig, devices } from '@playwright/test';

// The production build is served from a sub-path on purpose: GitHub Pages
// project sites live at /<repo>/, and that is exactly where relative asset
// URLs and the module worker are most likely to break.
const PORT = 4178;
const BASE_PATH = '/stl-to-svg-test';

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit approximates Safari, where module workers and <dialog> have the
    // shakiest history — the reason this project is here at all.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `node test/serve.mjs ${PORT} ${BASE_PATH}`,
    url: `http://127.0.0.1:${PORT}${BASE_PATH}/`,
    reuseExistingServer: !process.env.CI,
  },
});
