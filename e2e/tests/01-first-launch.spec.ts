import {checkScreen, expect, gotoTab, test} from '../support';

test.describe('first launch', () => {
  test.use({freshInstall: true});

  test('data-safety notice, empty estimates, mission sheet that persists across reload', async ({page}, testInfo) => {
    await page.goto('/');

    const notice = page.getByRole('dialog');
    await expect(notice).toContainText('Unclassified, open-source material only');
    await checkScreen(page, testInfo, '01-data-safety-notice');
    await page.getByRole('button', {name: 'I Understand — Continue'}).click();
    await expect(page.getByRole('button', {name: 'I Understand — Continue'})).toHaveCount(0);

    // Today: a brand-new user has no estimates yet (REVIEW H-7).
    const dismissIntro = page.getByRole('button', {name: /Got it|Start|Skip/}).first();
    if (await page.getByRole('dialog').count()) await dismissIntro.click();
    const profile = page.getByText('ILR profile').locator('xpath=ancestor::section[1]');
    await expect(profile).toBeVisible();
    for (const skill of ['Listening', 'Reading', 'Speaking']) {
      await expect(profile.getByText(skill, {exact: true})).toBeVisible();
    }
    await expect(profile.getByText('—', {exact: true})).toHaveCount(3);
    await expect(profile.getByText('Do 1 drill to estimate')).toHaveCount(3);
    await checkScreen(page, testInfo, '02-today-first-launch');

    // Mission chip -> sheet: change language, dialect and live voice.
    await page.getByRole('button', {name: /change mission context/i}).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await checkScreen(page, testInfo, '03-mission-sheet');
    await sheet
      .getByRole('group', {name: 'Target language'})
      .getByRole('button', {name: /Portuguese|PT/})
      .click();
    await sheet.locator('#mission-sheet-dialect').selectOption('br_bahian');
    await sheet.locator('#mission-sheet-live-voice').selectOption('Kore');
    await sheet.getByRole('button', {name: 'Apply Mission Context'}).click();

    const chip = page.getByRole('button', {name: /change mission context/i});
    await expect(chip).toHaveAccessibleName(/PT/);
    await expect(chip).toContainText('BR Bahian');

    await page.reload();
    await expect(page.getByRole('button', {name: 'I Understand — Continue'})).toHaveCount(0);
    await expect(chip).toHaveAccessibleName(/PT/);
    await expect(chip).toContainText('BR Bahian');
    await chip.click();
    await expect(page.locator('#mission-sheet-dialect')).toHaveValue('br_bahian');
    await expect(page.locator('#mission-sheet-live-voice')).toHaveValue('Kore');
    await expect(page.getByRole('group', {name: 'Target language'}).getByRole('button', {pressed: true})).toContainText(
      /Portuguese|PT/
    );
    await page.getByRole('button', {name: 'Apply Mission Context'}).click();
    await gotoTab(page, 'Today');
  });
});
