import { defineConfig, devices } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${PORT}/FocusPocus/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}/FocusPocus/`,
    reuseExistingServer: !process.env.CI,
  },
});
