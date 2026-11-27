import type {APIRequestContext} from '@playwright/test';
import {checkScreen, expect, gotoTab, test} from '../support';

const REJECT =
  /Unclassified, open-source material only\. It looks like your text contains classification or control markings/;

async function modelCalls(request: APIRequestContext, fixture: string): Promise<number> {
  const counts = (await (await request.get('/__fixtures/calls')).json()) as Record<string, number>;
  return counts[fixture] ?? 0;
}

test('Talk: a marked line gets the friendly message and no model call; option lists go through', async ({
  page,
  request,
}) => {
  await page.goto('/');
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

  await page.locator('#live-chat-text-input').fill('SECRET//NOFORN resumen de la patrulla de anoche');
  await page.getByRole('button', {name: 'Send message'}).click();
  await expect(page.getByRole('alert')).toHaveText(REJECT);
  expect(await modelCalls(request, 'chat-turn.json')).toBe(0);

  await page.locator('#live-chat-text-input').fill('Option (A) is cheaper, pero la opción (B) es más rápida.');
  await page.getByRole('button', {name: 'Send message'}).click();
  await expect(page.getByTestId('talk-transcript-panel')).toContainText('¡Qué chido que me escribas!');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await modelCalls(request, 'chat-turn.json')).toBe(1);
});

test('PREP: a portion-marked monologue is rejected before grading; normal text is graded', async ({
  page,
  request,
}, testInfo) => {
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: /PREP & Interp Lab/}).click();
  const transcript = page.locator('#prep-transcript-area');
  await expect(transcript).toBeVisible();
  await checkScreen(page, testInfo, '27-prep-lab');

  await transcript.fill('(S) El patrullaje conjunto se realizó en la zona norte.\n(C) Detalles del operativo.');
  await page.getByRole('button', {name: 'Grade PREP Structure'}).click();
  await expect(page.getByRole('alert')).toHaveText(REJECT);
  expect(await modelCalls(request, 'lab-prep-grade.json')).toBe(0);

  await transcript.fill(
    'Creo que la ciudad debería limitar los autos. Option (A) is cheaper: más ciclovías. No obstante, hay que escuchar a los comerciantes.'
  );
  await page.getByRole('button', {name: 'Grade PREP Structure'}).click();
  await expect(page.getByRole('main')).toContainText(
    'Por consiguiente, es fundamental que la ciudad actúe con prudencia.'
  );
  expect(await modelCalls(request, 'lab-prep-grade.json')).toBe(1);
});
