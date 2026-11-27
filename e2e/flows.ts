import type {Page} from '@playwright/test';
import {expect, gotoTab} from './support';

/** Answers examiner turns: the speech stub "hears" the next utterance, then the learner taps Send. */
export async function answerTurns(page: Page, turns: number) {
  for (let i = 0; i < turns; i++) {
    const send = page.getByRole('button', {name: 'Send response'});
    await expect(send).toBeEnabled({timeout: 15_000});
    await send.click();
    await expect(page.getByTestId('call-status-line')).not.toHaveText(/Thinking|Examiner is speaking/i, {
      timeout: 15_000,
    });
  }
}

/** A short Exam-mode OPI call through to its debrief (which logs the debrief's errors). */
export async function runOpiExamCall(page: Page) {
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  await answerTurns(page, 4);
  await page.getByTestId('call-btn-end').click();
  await expect(page.getByTestId('debrief-level-card')).toBeVisible({timeout: 20_000});
}

/** A gist drill on the Spanish fixture broadcast, with an unsupported addition. */
export async function runGist(page: Page) {
  await gotoTab(page, 'Brief');
  await page.getByRole('tab', {name: 'Listening'}).click();
  await page.getByTestId('brief-gist-btn-e2e-es-audio-1').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('gist-play-once-btn').click();
  await expect(dialog.getByTestId('gist-countdown')).toBeVisible({timeout: 15_000});
  await dialog
    .getByTestId('gist-summary-input')
    .fill('The government will open new libraries. It is because of the war. Libraries will have internet.');
  await dialog.getByTestId('gist-submit-btn').click();
  await expect(dialog.getByTestId('fidelity-additions')).toBeVisible();
  return dialog;
}
