import type {Page} from '@playwright/test';
import {checkScreen, expect, gotoTab, setLanguage, test} from '../support';

const cards = (page: Page) => page.getByRole('main').getByRole('heading', {level: 2});

async function answerAll(page: Page, option: string) {
  const questions = page.locator('fieldset');
  const n = await questions.count();
  for (let i = 0; i < n; i++) {
    await questions
      .nth(i)
      .getByText(`${option} ${i + 1}`, {exact: true})
      .click();
  }
  return n;
}

test('Brief feed filters', async ({page}, testInfo) => {
  await page.goto('/');
  await gotoTab(page, 'Brief');
  await page.getByRole('tab', {name: 'Listening'}).click();
  await expect(cards(page)).toHaveText(['Boletín: bibliotecas en los barrios', 'Boletín: horarios extendidos']);
  await checkScreen(page, testInfo, '15-brief-listening');

  const level = page.getByRole('radiogroup', {name: 'ILR Level filter'});
  await level.getByRole('radio', {name: /Level 2\+/}).click();
  await expect(cards(page)).toHaveText(['Boletín: bibliotecas en los barrios']);
  await level.getByRole('radio', {name: /All levels/}).click();
  await page.getByRole('radiogroup', {name: 'Topic filter'}).getByRole('radio', {name: 'Society'}).click();
  await expect(cards(page)).toHaveText(['Boletín: horarios extendidos']);
  await page
    .getByRole('radiogroup', {name: 'Topic filter'})
    .getByRole('radio', {name: /All topics/})
    .click();

  await page.getByRole('tab', {name: 'Reading'}).click();
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByRole('main')).toContainText('LinguaForge practice story');
  await expect(page.getByRole('main')).not.toContainText('Boletín');
  await page.getByRole('searchbox').or(page.getByLabel('Search brief articles')).fill('zzzz-no-match');
  await expect(page.getByRole('main')).toContainText('No passages found');
  await checkScreen(page, testInfo, '16-brief-reading-empty');
});

test('Spanish DLPT listening: audio plays once, no Back, Next hidden until answered', async ({page}, testInfo) => {
  await page.goto('/');
  await gotoTab(page, 'Brief');
  await page.getByRole('tab', {name: 'Listening'}).click();
  await page
    .getByRole('main')
    .locator('article, section, div')
    .filter({has: page.getByRole('heading', {name: 'Boletín: bibliotecas en los barrios'})})
    .getByRole('button', {name: /DLPT drill/})
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ES · DLPT5-CA rules');
  await dialog.getByRole('button', {name: 'Test', exact: true}).click();
  await expect(dialog.locator('fieldset')).toHaveCount(3);

  const play = dialog.getByTestId('dlpt-play-audio-btn');
  await play.click();
  await expect(play).toHaveText(/Played once · no replay in test conditions/, {timeout: 15_000});
  await expect(play).toBeDisabled();
  await checkScreen(page, testInfo, '17-dlpt-es-listening');

  // DLPT5-CA: no going back, and Next appears only once every question is answered.
  await expect(dialog.getByRole('button', {name: 'Previous'})).toHaveCount(0);
  await expect(dialog.getByTestId('dlpt-next-btn')).toHaveCount(0);
  await dialog.locator('fieldset').first().getByText('Alpha 1', {exact: true}).click();
  await expect(dialog.getByTestId('dlpt-next-btn')).toHaveCount(0);
  await answerAll(page, 'Alpha');
  await expect(dialog.getByTestId('dlpt-next-btn')).toBeVisible();

  for (let p = 0; p < 4 && (await dialog.getByTestId('dlpt-next-btn').count()); p++) {
    await dialog.getByTestId('dlpt-next-btn').click();
    if (await dialog.getByText(/Drill complete/).count()) break;
    await expect(dialog.locator('fieldset').first()).toBeVisible();
    await expect(dialog.getByRole('button', {name: 'Previous'})).toHaveCount(0);
    await expect(dialog.getByTestId('dlpt-next-btn')).toHaveCount(0);
    await answerAll(page, 'Bravo');
  }
  await expect(dialog).toContainText('Drill complete');
  await expect(dialog).toContainText(/DLPT Listening Summary · Test conditions/i);
  await expect(dialog).toContainText(/\d+ of \d+ correct/);
  await checkScreen(page, testInfo, '18-dlpt-summary');
});

test('Portuguese DLPT reading: flag a passage and use the end-of-session review', async ({page}, testInfo) => {
  await page.goto('/');
  await setLanguage(page, 'pt');
  await gotoTab(page, 'Brief');
  await page.getByRole('tab', {name: 'Reading'}).click();
  await page
    .getByRole('button', {name: /DLPT drill/})
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('PT · DLPT5 Lower-Range rules');
  await dialog.getByRole('button', {name: 'Test', exact: true}).click();
  await expect(dialog.locator('fieldset').first()).toBeVisible();

  await dialog.locator('fieldset').first().getByText('Alpha 1', {exact: true}).click();
  await dialog.getByText('Flag to return').click();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  // Lower-Range allows moving on with unanswered questions.
  for (let p = 0; p < 5; p++) {
    await dialog.getByTestId('dlpt-next-btn').click();
    if (await dialog.getByText('End-of-session review').count()) break;
    await expect(dialog.locator('fieldset').first()).toBeVisible();
  }
  await expect(dialog).toContainText('Review before submitting');
  await expect(dialog.getByTestId('pt-unanswered-warning')).toContainText('No guessing penalty');
  const first = dialog.getByRole('button', {name: /^Passage 1/});
  await expect(first).toContainText('Flagged');
  await checkScreen(page, testInfo, '19-dlpt-pt-review');

  // Back into a flagged passage, then submit with unanswered questions after confirming.
  await first.click();
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByRole('button', {name: 'Previous'})).toHaveCount(0);
  for (let p = 0; p < 5 && !(await dialog.getByText('End-of-session review').count()); p++) {
    await dialog.getByTestId('dlpt-next-btn').click();
  }
  await dialog.getByTestId('pt-final-submit-btn').click();
  await expect(dialog).toContainText(/Submit with \d+ unanswered/);
  await dialog.getByRole('button', {name: 'Submit anyway'}).click();
  await expect(dialog).toContainText('Drill complete');
});

test('Gist: listen once, summarize, the addition is flagged first', async ({page}, testInfo) => {
  await page.goto('/');
  await gotoTab(page, 'Brief');
  await page.getByRole('tab', {name: 'Listening'}).click();
  await page.getByTestId('brief-gist-btn-e2e-es-audio-1').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Step 1 of 2 · Listen once');
  await dialog.getByTestId('gist-play-once-btn').click();
  // The 2 s clip ends and the 60 s summary starts by itself.
  await expect(dialog.getByTestId('gist-countdown')).toBeVisible({timeout: 15_000});
  await dialog
    .getByTestId('gist-summary-input')
    .fill('The government will open new libraries. It is because of the war. Libraries will have internet.');
  await expect(dialog).toContainText('3 / 3 sentences');
  await checkScreen(page, testInfo, '20-gist-write');
  await dialog.getByTestId('gist-submit-btn').click();

  await expect(dialog.getByTestId('gist-learner-text').locator('mark')).toHaveText('because of the war');
  const sections = dialog.locator('[data-testid^="fidelity-"]');
  await expect(sections).toHaveCount(3);
  await expect(sections.nth(0)).toHaveAttribute('data-testid', 'fidelity-additions');
  await expect(sections.nth(0)).toContainText('The source never says the plan is because of the war.');
  await expect(sections.nth(1)).toHaveAttribute('data-testid', 'fidelity-omissions');
  await expect(dialog.getByTestId('gist-stat-main-point')).toContainText('Partial');
  await expect(dialog.getByTestId('gist-stat-key-details')).toContainText('1 of 3');
  await checkScreen(page, testInfo, '21-gist-result');
});
