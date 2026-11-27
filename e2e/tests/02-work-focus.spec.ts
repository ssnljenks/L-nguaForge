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

// Seed item in the Operational/Military Terms category (src/data/seedData.ts).
const SAVED_MILITARY_TERM = 'conciencia del dominio marítimo';

/** Vocab with Work focus off: no Military Dict view, no military category chip, saved military items still listed. */
async function expectVocabWorkContentHidden(page: Page) {
  await gotoTab(page, 'Vocab');
  const main = page.getByRole('main');
  await expect(main).toContainText('no obstante');
  await expect(page.getByRole('tab', {name: /Military Dict/})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: /Library/})).toBeVisible();
  await expect(page.getByRole('tab', {name: /Recall/})).toBeVisible();
  const categories = page.getByRole('group', {name: 'Filter by category'});
  await expect(categories.getByRole('button', {name: 'Operational/Military Terms'})).toHaveCount(0);
  await expect(categories.getByRole('button', {name: 'All Categories'})).toHaveAttribute('aria-pressed', 'true');
  await expect(categories.getByRole('button', {name: 'Regional Idioms'})).toBeVisible();
  // Nothing saved is hidden: the military item is in the normal list.
  await expect(main).toContainText(SAVED_MILITARY_TERM);
}

/** Vocab with Work focus on: both are back, as before. */
async function expectVocabWorkContentShown(page: Page) {
  await gotoTab(page, 'Vocab');
  await expect(page.getByRole('tab', {name: /Military Dict/})).toBeVisible();
  const chip = page
    .getByRole('group', {name: 'Filter by category'})
    .getByRole('button', {name: 'Operational/Military Terms'});
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole('main')).toContainText(SAVED_MILITARY_TERM);
  await expect(page.getByRole('main')).not.toContainText('no obstante');
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
  await expectVocabWorkContentHidden(page);

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
  await expectVocabWorkContentShown(page);

  // Off again: hidden again.
  await setWorkFocus(page, false);
  await gotoTab(page, 'Talk');
  await expect(page.getByTestId('talk-work-chip')).toHaveCount(0);
  await expect(page.getByRole('group', {name: 'Work talk focus domain'})).toHaveCount(0);
  await gotoTab(page, 'Brief');
  await expect(page.getByRole('button', {name: 'Work focus'})).toHaveCount(0);
  await expectTestPrepHasNoDomainContent(page);
  await expectVocabWorkContentHidden(page);
});

test('Work focus switched off while the Military Dict or its filter is open falls back to the normal list', async ({
  page,
}) => {
  await page.goto('/');
  await setWorkFocus(page, true);
  await gotoTab(page, 'Vocab');
  await page.getByRole('tab', {name: /Military Dict/}).click();
  await expect(page.getByRole('tab', {name: /Military Dict/})).toHaveAttribute('aria-selected', 'true');

  await setWorkFocus(page, false);
  await expect(page.getByRole('tab', {name: /Military Dict/})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: /Library/})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('main')).toContainText(SAVED_MILITARY_TERM);

  // The same for the category filter. (Turning Work focus back on returns to the Military Dict, where the
  // selection was left, so go back to the library first.)
  await setWorkFocus(page, true);
  await expect(page.getByRole('tab', {name: /Military Dict/})).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', {name: /Library/}).click();
  await page
    .getByRole('group', {name: 'Filter by category'})
    .getByRole('button', {name: 'Operational/Military Terms'})
    .click();
  await setWorkFocus(page, false);
  await expect(
    page.getByRole('group', {name: 'Filter by category'}).getByRole('button', {name: 'All Categories'})
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('main')).toContainText('no obstante');
  await expect(page.getByRole('main')).toContainText(SAVED_MILITARY_TERM);
});
