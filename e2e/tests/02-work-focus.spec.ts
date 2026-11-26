import type {Page} from '@playwright/test';
import {checkScreen, expect, gotoTab, openSettings, test} from '../support';

const DOMAIN_TEXT =
  /Maritime|Interdiction|Aviation|Logistics|C2 & Comms|Cyber|Delegation|General Policy|military|Work focus domain/i;

async function setWorkFocus(page: Page, on: boolean) {
  await openSettings(page);
  const toggle = page.locator('#settings-work-focus');
  await expect(toggle).toHaveAttribute('aria-checked', String(!on));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
  await page.getByRole('button', {name: 'Close settings'}).click();
}

async function expectTestPrepHasNoDomainContent(page: Page) {
  await gotoTab(page, 'Test prep');
  await expect(page.getByRole('main')).toContainText(/OPI/);
  await expect(page.getByRole('main')).not.toContainText(DOMAIN_TEXT);
}

test('Work focus is off by default and gates Work talk and the Brief Work chip', async ({page}, testInfo) => {
  await page.goto('/');

  await openSettings(page);
  await expect(page.locator('#settings-work-focus')).toHaveAttribute('aria-checked', 'false');
  await checkScreen(page, testInfo, '04-settings');
  await page.getByRole('button', {name: 'Close settings'}).click();

  // Off: no Work talk scene, no Work chip, no domain anywhere in Test prep.
  await gotoTab(page, 'Talk');
  await expect(page.getByTestId('talk-work-chip')).toHaveCount(0);
  await gotoTab(page, 'Brief');
  await expect(page.getByRole('button', {name: 'Work focus'})).toHaveCount(0);
  await expectTestPrepHasNoDomainContent(page);

  // On: both appear; Test prep still never shows domain content.
  await setWorkFocus(page, true);
  await gotoTab(page, 'Talk');
  await expect(page.getByTestId('talk-work-chip')).toBeVisible();
  await page.getByTestId('talk-work-chip').click();
  await expect(page.getByRole('group', {name: 'Work talk focus domain'})).toBeVisible();
  await gotoTab(page, 'Brief');
  await expect(page.getByRole('button', {name: 'Work focus'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Work focus'})).toHaveAttribute('aria-pressed', 'false');
  await expectTestPrepHasNoDomainContent(page);

  // Off again: hidden again.
  await setWorkFocus(page, false);
  await gotoTab(page, 'Talk');
  await expect(page.getByTestId('talk-work-chip')).toHaveCount(0);
  await expect(page.getByRole('group', {name: 'Work talk focus domain'})).toHaveCount(0);
  await gotoTab(page, 'Brief');
  await expect(page.getByRole('button', {name: 'Work focus'})).toHaveCount(0);
  await expectTestPrepHasNoDomainContent(page);
});
