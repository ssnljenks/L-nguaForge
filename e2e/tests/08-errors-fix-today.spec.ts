import type {Page} from '@playwright/test';
import {runGist, runOpiExamCall} from '../flows';
import {checkScreen, expect, gotoTab, test} from '../support';

const DAY_1 = new Date('2026-11-26T10:00:00-05:00');
const DAY_2 = new Date('2026-11-27T10:00:00-05:00');

async function planProgress(page: Page) {
  return page.getByTestId('today-plan-progress');
}

test('recurring errors from OPI and Gist rank on Today, the 2-min fix reaches 8/8, and the plan resets daily', async ({
  page,
}, testInfo) => {
  test.slow();
  await page.clock.install({time: DAY_1});
  await page.goto('/');

  await test.step('produce errors in an OPI debrief and a gist', async () => {
    await runOpiExamCall(page);
    const gist = await runGist(page);
    await gist.getByRole('button', {name: 'Done'}).click();
  });

  await test.step('recurring errors are ranked on Today', async () => {
    await gotoTab(page, 'Today');
    await page
      .getByRole('button', {name: /Recurring errors/})
      .first()
      .click();
    const view = page.getByTestId('recurring-errors-view');
    await expect(view).toBeVisible();
    const cards = view.locator('[data-testid="top-recurring-error-card"], [data-testid^="recurring-error-card-"]');
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toHaveAttribute('data-testid', 'top-recurring-error-card');
    await expect(cards.first()).toContainText('Top priority');
    for (const source of ['OPI', 'Gist']) await expect(view).toContainText(source);
    await checkScreen(page, testInfo, '22-recurring-errors');
  });

  await test.step('the 2-min fix runs to 8/8', async () => {
    await page
      .getByTestId('top-recurring-error-card')
      .getByRole('button', {name: /2-min fix/})
      .click();
    const modal = page.getByTestId('fix-drill-modal');
    await expect(modal.getByTestId('fix-progress-counter')).toContainText('1');
    for (let i = 1; i <= 8; i++) {
      await modal.locator('textarea').fill('Si tuviera más tiempo, viajaría por todo el país.');
      await modal.getByTestId('fix-submit-answer').click();
      await expect(modal.getByTestId('fix-turn-feedback')).toContainText('Correct si-clause.');
      if (i === 1) await checkScreen(page, testInfo, '23-fix-drill');
      await modal.getByTestId('fix-next-prompt').click();
    }
    await expect(modal.getByTestId('fix-drill-summary')).toContainText('8 / 8 nailed');
    await modal.getByRole('button', {name: 'Done'}).click();
    await page.getByRole('button', {name: 'Back to Today'}).click();
  });

  await test.step('Today builds a 3-item plan; completion persists across reload', async () => {
    for (const id of ['vocab', 'brief', 'speaking']) await expect(page.getByTestId(`plan-item-${id}`)).toBeVisible();
    await expect(await planProgress(page)).toContainText('0 of 3 done');
    await checkScreen(page, testInfo, '24-today-plan');

    await page.getByTestId('plan-item-vocab').click();
    const warmup = page.getByRole('dialog');
    for (let card = 0; card < 10 && !(await warmup.getByTestId('vocab-warmup-complete').count()); card++) {
      await warmup.getByTestId('vocab-warmup-reveal').click();
      await warmup.getByTestId('vocab-warmup-rate-good').click();
    }
    await expect(warmup.getByTestId('vocab-warmup-complete')).toBeVisible();
    await warmup.getByTestId('vocab-warmup-return-btn').click();
    await expect(await planProgress(page)).toContainText('1 of 3 done');

    await page.reload();
    await expect(await planProgress(page)).toContainText('1 of 3 done');
  });

  await test.step('the next day starts a fresh plan', async () => {
    await page.clock.setSystemTime(DAY_2);
    await page.reload();
    await expect(await planProgress(page)).toContainText('0 of 3 done');
  });
});
