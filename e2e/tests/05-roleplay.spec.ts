import {checkScreen, expect, gotoTab, test} from '../support';

// From server/fixtures/roleplay-scenario.json: server-side secrets that must stay hidden until the debrief.
const HIDDEN_GOAL = 'The clerk needs the original receipt and will offer a same-day replacement if you ask politely.';
const COMPLICATION = "The shop's policy says no refunds after 24 hours.";

for (const level of [1, 2, 3] as const) {
  test(`role-play level ${level}: hidden goal never leaves the server before the debrief`, async ({
    page,
    api,
  }, testInfo) => {
    await page.goto('/');
    await gotoTab(page, 'Test prep');
    await page.getByRole('button', {name: `L${level}`, exact: true}).click();
    await page.getByRole('button', {name: 'Open', exact: true}).click();
    const levelRadio = page
      .getByRole('radiogroup', {name: 'Role-play ILR level'})
      .getByRole('radio', {name: new RegExp(`Level ${level}`)});
    await levelRadio.click();
    await expect(levelRadio).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('main')).toContainText('Your situation');
    await expect(page.getByRole('main')).toContainText('Shop clerk');
    if (level === 2) await checkScreen(page, testInfo, '08-roleplay-setup');

    await page.getByRole('button', {name: 'Start role-play'}).filter({visible: true}).first().click();
    await expect(page.getByTestId('opi-call-screen')).toBeVisible();
    for (let turn = 0; turn < 2; turn++) {
      const send = page.getByRole('button', {name: 'Send response'});
      await expect(send).toBeEnabled({timeout: 15_000});
      await send.click();
      await expect(page.getByTestId('call-status-line')).not.toHaveText(/Thinking/i, {timeout: 15_000});
    }
    await expect(page.getByRole('main')).not.toContainText(HIDDEN_GOAL);
    await page.getByTestId('call-btn-end').click();

    const card = page.getByTestId('roleplay-debrief-card');
    await expect(card).toBeVisible({timeout: 20_000});
    await expect(page.getByTestId('roleplay-hidden-goal')).toHaveText(HIDDEN_GOAL);
    // Level 1 is a plain survival transaction: the server replaces any complication (roleplay.ts).
    await expect(page.getByTestId('roleplay-complication')).toHaveText(level === 1 ? /no complication/ : COMPLICATION);
    await expect(card).toContainText(`Level ${level} checklist`);
    await expect(card.locator('[data-testid^="roleplay-check-"]')).toHaveCount(3);
    if (level === 2) await checkScreen(page, testInfo, '09-roleplay-debrief');

    // Network: every role-play response before the debrief is free of the secrets; the debrief carries them.
    await page.waitForLoadState('networkidle');
    const debriefIndex = api.findIndex((c) => c.path === '/api/opi/roleplay/debrief');
    expect(debriefIndex, 'debrief request was made').toBeGreaterThan(0);
    const before = api.slice(0, debriefIndex);
    expect(before.some((c) => c.path === '/api/opi/roleplay/scenario')).toBe(true);
    expect(before.some((c) => c.path === '/api/opi/roleplay/turn')).toBe(true);
    for (const call of before) {
      expect(call.responseBody, `${call.path} response`).not.toContain(HIDDEN_GOAL);
      expect(call.responseBody, `${call.path} response`).not.toContain(COMPLICATION);
      expect(call.responseBody, `${call.path} response`).not.toMatch(/"(hiddenGoal|complication)"\s*:/);
    }
    expect(api[debriefIndex].responseBody).toContain(HIDDEN_GOAL);
  });
}
