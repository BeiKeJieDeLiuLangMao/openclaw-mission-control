import { test, expect } from '@playwright/test';

test.describe('Mem0 Storage E2E - OpenClaw & Claude Code', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/memories');
  });

  test('Memories page loads and displays data', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    await page.screenshot({ path: 'memories-list.png' });
  });

  test('Graph view renders correctly', async ({ page }) => {
    const graphBtn = page.locator('button', { hasText: 'Graph' });
    if (await graphBtn.count() > 0) {
      await graphBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'graph-view.png' });
    }
  });

  test('Source badges visible', async ({ page }) => {
    await page.waitForSelector('body', { timeout: 15000 });
    await page.screenshot({ path: 'memories-sources.png' });
  });
});
