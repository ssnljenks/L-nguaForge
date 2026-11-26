import {checkScreen, expect, gotoTab, isWebKit, test} from '../support';

test('Talk: tutor + scene, live and typed turns, save a dotted word, wrap up into Vocab', async ({page}, testInfo) => {
  await page.goto('/');
  await gotoTab(page, 'Talk');

  // Pick a partner and a scene.
  await page.getByRole('button', {name: /^Mateo · Buenos Aires/}).click();
  await page.getByRole('button', {name: /^Sofía · Mexico City/}).click();
  await expect(page.getByRole('button', {name: /^Sofía · Mexico City/})).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Street tacos'}).click();
  await expect(page.getByRole('button', {name: 'Street tacos'})).toHaveAttribute('aria-pressed', 'true');
  await checkScreen(page, testInfo, '10-talk-setup');
  await page
    .getByRole('button', {name: /Start talking with Sofía/})
    .filter({visible: true})
    .first()
    .click();
  await expect(page.getByRole('heading', {name: 'Sofía · Mexico City'})).toBeVisible();
  await expect(page.getByRole('main')).toContainText('Street tacos');

  const transcript = page.getByTestId('talk-transcript-panel');

  // Live voice over /ws/live (canned exchange) with Chromium's fake microphone.
  if (!isWebKit(testInfo)) {
    await page.getByRole('button', {name: 'Start Live Voice'}).filter({visible: true}).first().click();
    await expect(transcript).toContainText('Hola Sofía, hoy fui al mercado con mi hermana.', {timeout: 20_000});
    await expect(transcript).toContainText('¿Y qué compraron en el mercado?');
    await checkScreen(page, testInfo, '11-talk-live');
    await page.getByRole('button', {name: 'End live voice conversation'}).click();
    await expect(page.getByRole('button', {name: 'Start Live Voice'}).filter({visible: true})).toHaveCount(1);
  }

  // Typed turns over REST.
  await page
    .getByRole('button', {name: /^(Toggle text input|Type instead)$/})
    .filter({visible: true})
    .first()
    .click();
  await page.locator('#live-chat-text-input').fill('Hola, ¿cómo estás? Hoy comí tacos.');
  await page.getByRole('button', {name: 'Send message'}).click();
  await expect(transcript).toContainText('¡Qué chido que me escribas!');
  await expect(page.getByTestId('talk-recast-note')).toContainText('chido');
  await page.locator('#live-chat-text-input').fill('Muy bien, gracias.');
  await page.getByRole('button', {name: 'Send message'}).click();
  await expect(transcript).toContainText('tacos al pastor');
  await checkScreen(page, testInfo, '12-talk-chat');

  // Tap the dotted local expression -> save to Vocab.
  await transcript
    .getByRole('button', {name: /^Local expression chido/})
    .last()
    .click();
  const card = page.getByRole('region', {name: 'Local expression: chido'});
  await expect(card).toContainText('cool, great');
  await card.getByRole('button', {name: 'Save to Vocab'}).click();
  await expect(card.getByRole('button', {name: 'Already in Vocab'})).toBeDisabled();

  // Wrap up -> add the items -> Vocab shows them with the sentence from the conversation.
  await page.getByTestId('talk-wrap-up-btn').click();
  await expect(page.getByRole('main')).toContainText('You talked with Sofía about your day and weekend plans.');
  await checkScreen(page, testInfo, '13-talk-wrap-up');
  await page
    .getByRole('button', {name: /^Add \d+ to Vocab$/})
    .first()
    .click();
  await expect(page.getByRole('main')).toContainText(/Already in Vocab|Added/);

  await gotoTab(page, 'Vocab');
  const main = page.getByRole('main');
  for (const [term, sentence] of [
    ['chido', '¡Qué chido que me escribas!'],
    ['ándale', '¡Qué chido que me escribas! Yo ando bien, aquí en la colonia.'],
    ['al pastor', 'Mañana vamos por unos tacos al pastor, ¿te late?'],
  ]) {
    const entry = main
      .getByRole('heading', {name: term, exact: true})
      .locator('xpath=ancestor::*[descendant::p[contains(@class, "italic")]][1]');
    await expect(entry).toContainText(sentence);
  }
  await checkScreen(page, testInfo, '14-vocab');
});
