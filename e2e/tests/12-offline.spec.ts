import {checkScreen, expect, gotoTab, test} from '../support';

const OFFLINE = /You're offline\. Reconnect to the internet and try again/;

test.describe('offline', () => {
  test.use({serviceWorkers: 'allow'});

  test('the app shell loads from the PWA cache and requests say they are offline', async ({
    page,
    context,
  }, testInfo) => {
    await page.goto('/');
    // Let the service worker install and precache, then take control of the page.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    await context.setOffline(true);
    await page.reload();

    // Shell and local data come from the cache.
    await expect(page.getByTestId('ilr-profile-card')).toBeVisible();
    await expect(page.getByText('Offline Mode — Local Vocab & cached drills active')).toBeVisible();
    await checkScreen(page, testInfo, '25-offline-today');
    await gotoTab(page, 'Vocab');
    await expect(page.getByRole('main')).toContainText('no obstante');

    // Talk: a typed turn fails with a clear message, and no "replying…" spinner is left behind.
    await gotoTab(page, 'Talk');
    await page
      .getByRole('button', {name: /Start talking with/})
      .filter({visible: true})
      .first()
      .click();
    await page
      .getByRole('button', {name: /^(Toggle text input|Type instead)$/})
      .filter({visible: true})
      .first()
      .click();
    await page.locator('#live-chat-text-input').fill('Hola, ¿cómo estás?');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(page.getByRole('alert')).toHaveText(OFFLINE);
    await expect(page.getByText(/is replying…/)).toHaveCount(0);
    await checkScreen(page, testInfo, '26-offline-talk');

    // OPI: the call can't reach the examiner and says why instead of spinning.
    await gotoTab(page, 'Test prep');
    await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
    await expect(page.getByTestId('opi-call-screen').getByRole('alert')).toHaveText(OFFLINE);
    await expect(page.getByTestId('call-status-line')).not.toHaveText(/Thinking|Connecting/i);
    await page.getByTestId('call-btn-end').click();

    // Back online, the same turn goes through.
    await context.setOffline(false);
    await gotoTab(page, 'Talk');
    await expect(page.getByText('Offline Mode — Local Vocab & cached drills active')).toHaveCount(0);
  });
});
