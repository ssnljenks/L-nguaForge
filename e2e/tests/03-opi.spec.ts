import {answerTurns} from '../flows';
import {checkScreen, expect, gotoTab, test} from '../support';

test('OPI Exam mode: phone-call screen, debrief auto-opens, redo, past sessions', async ({page}, testInfo) => {
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await expect(page.getByTestId('opi-mode-description')).toContainText('No hints, no level badge, no live transcript');
  await checkScreen(page, testInfo, '05-test-prep-opi-setup');

  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await expect(call).toContainText('OPI Exam Call');
  await answerTurns(page, 4);

  // Exam conditions: no transcript, no hint, no phase/level shown.
  await expect(page.getByTestId('opi-practice-transcript')).toHaveCount(0);
  await expect(page.getByTestId('opi-hint-toggle')).toHaveCount(0);
  await expect(page.getByTestId('opi-practice-phase')).toHaveCount(0);
  await expect(call).not.toContainText('día típico');
  await expect(call).not.toContainText(/ILR [0-3]|Level [0-3]/);
  await checkScreen(page, testInfo, '06-opi-exam-call');

  await page.getByTestId('call-btn-end').click();

  // Debrief opens on its own.
  await expect(page.getByTestId('debrief-level-card')).toBeVisible({timeout: 20_000});
  await expect(page.getByTestId('debrief-level-card')).toContainText(/ILR (0\+|1\+?|2\+?|3)/);
  await expect(page.getByTestId('debrief-estimate-disclaimer')).toHaveText('Practice estimate, not an official rating');
  const ceiling = page.getByTestId('debrief-ceiling-card');
  await expect(ceiling).toContainText('Where it broke down');
  await expect(page.getByTestId('ceiling-problem-span')).toHaveText('Si las oficinas cierran');
  await expect(page.getByTestId('debrief-functions-grid')).toContainText(/Level [123] functions/);
  await expect(page.getByTestId('debrief-functions-grid').locator('[data-testid^="fn-card-"]')).toHaveCount(6);
  await checkScreen(page, testInfo, '07-debrief');

  // Redo this answer
  await page.getByTestId('debrief-redo-answer-btn').click();
  await page.locator('#redo-answer-textarea').fill('Si las oficinas cerraran, la gente usaría menos el metro.');
  await page.getByRole('button', {name: 'Grade Redo vs Original'}).click();
  await expect(ceiling).toContainText('Stronger answer');

  // Past sessions lists this call (today) next to the sample session.
  await page.getByRole('button', {name: 'Back to Test prep'}).click();
  await expect(page.getByRole('button', {name: /Past sessions/})).toContainText('2 debriefs available');
  await page.getByRole('button', {name: /Past sessions/}).click();
  // The browser context runs in America/New_York (playwright.config.ts), so "today" must be computed there, not in the host's timezone.
  const today = new Date().toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'America/New_York'});
  await expect(page.locator('#debrief-session-select option')).toHaveCount(2);
  await expect(page.locator('#debrief-session-select option').first()).toContainText(`OPI · ${today}`);
  await expect(page.getByTestId('debrief-redo-answer-btn')).toHaveText(/View \/ Redo this answer/);
});

for (const level of ['1', '3'] as const) {
  test(`OPI Practice mode, focus level ${level}: transcript and hint visible`, async ({page}) => {
    await page.goto('/');
    await gotoTab(page, 'Test prep');
    await page.getByRole('tab', {name: /Practice mode/}).click();
    await page.getByTestId(`focus-level-${level}`).click();
    await expect(page.getByTestId(`focus-level-${level}`)).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();

    await expect(page.getByTestId('opi-call-screen')).toContainText('Practice');
    const transcript = page.getByTestId('opi-practice-transcript');
    await expect(transcript).toContainText('día típico');
    await answerTurns(page, 1);
    await expect(transcript).toContainText(/Trabajo en una oficina/);
    await expect(page.getByTestId('opi-practice-phase')).toBeVisible();

    await page.getByTestId('opi-hint-toggle').click();
    await expect(page.getByTestId('opi-practice-hint-drawer')).toBeVisible();
    await page.getByTestId('call-btn-end').click();
  });
}
