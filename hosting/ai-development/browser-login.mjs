import { chromium } from 'playwright';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [directory, userId] = process.argv.slice(2);
if (!directory || !/^[a-f0-9-]{36}$/i.test(userId || '')) throw new Error('Profilo non valido.');
const context = await chromium.launchPersistentContext(join(resolve(directory), 'browser-profiles', userId), { channel: 'chrome', headless: false, acceptDownloads: false });
try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://workspace.progre.it/activities/dashboard');
  for (let elapsed = 0; elapsed < 1800 && !page.isClosed(); elapsed++) {
    if (await page.locator('html').getAttribute('data-workspace-user-id') === userId) {
      await delay(2000);
      break;
    }
    await delay(1000);
  }
} finally { await context.close(); }
