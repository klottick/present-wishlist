import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1280x800', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone-390x844', use: { viewport: { width: 390, height: 844 } } },
  ],
})
