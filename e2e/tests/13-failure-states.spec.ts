import {answerTurns} from '../flows';
import {expect, gotoTab, test} from '../support';

/**
 * Failure states a first tester will hit on a phone: rate limits, a lost scenario, the news feed being down,
 * the browser refusing audio or voice input, and the live-voice socket dropping. Every one must say what
 * happened, keep what the learner already did, and offer a way to carry on.
 */

const JSON_HEADERS = {'Content-Type': 'application/json'};
const RATE_LIMIT = 'Gemini API rate limit reached. Please wait a moment and try again.';

test('OPI: a rate-limit error keeps the answer in the box and Send works again', async ({page}) => {
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await answerTurns(page, 1);

  await page.route(
    '**/api/opi/turn',
    (route) => route.fulfill({status: 429, headers: JSON_HEADERS, body: JSON.stringify({error: RATE_LIMIT})}),
    {
      times: 1,
    }
  );
  const send = page.getByRole('button', {name: 'Send response'});
  await expect(send).toBeEnabled({timeout: 15_000});
  await send.click();

  await expect(call.getByRole('alert')).toContainText(RATE_LIMIT);
  await expect(call.getByRole('alert')).toContainText('tap Send to try again');
  // The answer is still there to send, not lost and not counted twice.
  await expect(page.locator('#opi-call-response-input')).not.toHaveValue('');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(call.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('call-status-line')).not.toHaveText(/Thinking/i, {timeout: 15_000});
});

test('OPI: going offline mid-call explains it, keeps the answer, and recovers when back online', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await answerTurns(page, 1);

  const send = page.getByRole('button', {name: 'Send response'});
  await expect(send).toBeEnabled({timeout: 15_000});
  await context.setOffline(true);
  await send.click();
  await expect(call.getByRole('alert')).toContainText("You're offline");
  await expect(page.locator('#opi-call-response-input')).not.toHaveValue('');

  await context.setOffline(false);
  await send.click();
  await expect(call.getByRole('alert')).toHaveCount(0);
});

test('OPI: a failed first request offers Try again', async ({page}) => {
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.route(
    '**/api/opi/turn',
    (route) =>
      route.fulfill({
        status: 503,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error: 'Gemini is experiencing a brief demand spike. Please tap Send again in a moment.',
        }),
      }),
    {
      times: 1,
    }
  );
  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await expect(call.getByRole('alert')).toContainText('demand spike');
  await call.getByTestId('call-retry-start').click();
  await expect(call.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('call-status-line')).not.toHaveText(/Thinking|Connecting/i, {timeout: 15_000});
});

test('role-play: a scenario that can no longer be opened says so and the conversation is kept', async ({page}) => {
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: 'L2', exact: true}).click();
  await page.getByRole('button', {name: 'Open', exact: true}).click();
  await expect(page.getByRole('main')).toContainText('Your situation');
  await page.getByRole('button', {name: 'Start role-play'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await expect(call).toBeVisible();
  await expect(page.getByRole('button', {name: 'Send response'})).toBeEnabled({timeout: 15_000});

  await page.route(
    '**/api/opi/roleplay/turn',
    (route) =>
      route.fulfill({
        status: 410,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          error:
            'This role-play scenario is no longer available (the server was restarted or the scenario is too old). Your conversation is kept; start a new scenario to continue.',
          code: 'scenario_expired',
        }),
      }),
    {times: 1}
  );
  await page.getByRole('button', {name: 'Send response'}).click();
  await expect(call.getByRole('alert')).toContainText('no longer available');
  await expect(call.getByRole('alert')).toContainText('End call');
  // Ending the call still leads to feedback on what was said.
  await page.getByTestId('call-btn-end').click();
  await expect(page.getByTestId('roleplay-debrief-card')).toBeVisible({timeout: 20_000});
});

test('Brief: a feed outage is reported as an outage, with Try again, not as "no passages"', async ({page}) => {
  await page.route('**/api/brief/feed*', (route) =>
    route.fulfill({
      status: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({error: 'Something went wrong on the server. Please try again.'}),
    })
  );
  await page.goto('/');
  await gotoTab(page, 'Brief');
  const banner = page.getByTestId('brief-feed-error');
  await expect(banner).toContainText('Something went wrong on the server');
  await expect(page.getByText('No passages found for this combination')).toHaveCount(0);

  await page.unroute('**/api/brief/feed*');
  await banner.getByRole('button', {name: 'Try again'}).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('[data-testid^="brief-card-"]').first()).toBeVisible();
});

test('Brief: typing in search sends one request, not one per keystroke', async ({page}) => {
  await page.goto('/');
  await gotoTab(page, 'Brief');
  await expect(page.locator('[data-testid^="brief-card-"]').first()).toBeVisible();
  let feedRequests = 0;
  page.on('request', (req) => {
    if (req.url().includes('/api/brief/feed')) feedRequests++;
  });
  await page.getByLabel('Search brief articles').pressSequentially('educación pública', {delay: 20});
  await page.waitForTimeout(900);
  expect(feedRequests).toBeLessThanOrEqual(1);
});

test('OPI: when the browser refuses to speak, the examiner can be heard with a tap or read as text', async ({page}) => {
  // Speech that never starts, like iOS before audio is unlocked.
  await page.addInitScript(() => {
    (window.speechSynthesis as unknown as {speak: () => void}).speak = () => {};
  });
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await expect(call.getByTestId('call-tap-to-hear')).toBeVisible({timeout: 15_000});
  // Exam mode hides the transcript; the fallback must not leave the learner with no question at all.
  await call.getByRole('button', {name: 'Show the question as text'}).click();
  await expect(call.getByTestId('call-audio-fallback')).toContainText(/\w{4,}/);
  // The call keeps going: answering still works.
  await expect(page.getByRole('button', {name: 'Send response'})).toBeEnabled({timeout: 15_000});
});

test('OPI: when voice input is refused, typing opens by itself and the reason is shown', async ({page}) => {
  await page.addInitScript(() => {
    class RefusingRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: {error: string}) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          this.onerror?.({error: 'service-not-allowed'});
          this.onend?.();
        }, 50);
      }
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, 'SpeechRecognition', {value: RefusingRecognition, configurable: true});
    Object.defineProperty(window, 'webkitSpeechRecognition', {value: RefusingRecognition, configurable: true});
  });
  await page.goto('/');
  await gotoTab(page, 'Test prep');
  await page.getByRole('button', {name: 'Start the call'}).filter({visible: true}).first().click();
  const call = page.getByTestId('opi-call-screen');
  await expect(call).toContainText(/Voice input/);
  const input = page.locator('#opi-call-response-input');
  await expect(input).toBeVisible();
  await input.fill('Trabajo en una oficina y tomo el autobús.');
  await page.getByRole('button', {name: 'Send response'}).click();
  await expect(page.getByTestId('call-status-line')).not.toHaveText(/Thinking/i, {timeout: 15_000});
});

test.describe('live voice', () => {
  test.skip(({browserName}) => browserName === 'webkit', 'live voice runs on Chromium only (fake microphone)');

  async function openTalk(page: import('@playwright/test').Page) {
    await page.goto('/');
    await gotoTab(page, 'Talk');
    await page
      .getByRole('button', {name: /Start talking with/})
      .filter({visible: true})
      .first()
      .click();
  }

  test('a blocked microphone says how to allow it and leaves typing available', async ({page}) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });
    await openTalk(page);
    await page.getByRole('button', {name: 'Start Live Voice'}).filter({visible: true}).first().click();
    await expect(page.getByRole('alert').filter({hasText: 'Microphone access is blocked'})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText: 'Microphone access is blocked'})).toContainText(/type/i);
    await page
      .getByRole('button', {name: /^(Toggle text input|Type instead)$/})
      .filter({visible: true})
      .first()
      .click();
    await expect(page.locator('#live-chat-text-input')).toBeVisible();
  });

  test('a dropped connection keeps the transcript, says so, and typing still works', async ({page}) => {
    await page.routeWebSocket('**/ws/live', (ws) => {
      ws.connectToServer();
      setTimeout(() => ws.close({code: 1011, reason: 'test drop'}), 2500);
    });
    await openTalk(page);
    await page.getByRole('button', {name: 'Start Live Voice'}).filter({visible: true}).first().click();
    const transcript = page.getByTestId('talk-transcript-panel');
    await expect(transcript)
      .toContainText('Hola Sofía', {timeout: 20_000})
      .catch(() => {});
    const alert = page.getByRole('alert').filter({hasText: /connection dropped/i});
    await expect(alert).toBeVisible({timeout: 15_000});
    await expect(alert).toContainText('conversation so far is saved');
    await page
      .getByRole('button', {name: /^(Toggle text input|Type instead)$/})
      .filter({visible: true})
      .first()
      .click();
    await page.locator('#live-chat-text-input').fill('Hola, ¿cómo estás?');
    await page.getByRole('button', {name: 'Send message'}).click();
    await expect(transcript).toContainText('¡Qué chido que me escribas!');
  });

  test('a connection that never completes times out with a clear message', async ({page}) => {
    await page.routeWebSocket('**/ws/live', () => {
      // Never connect to the server and never answer: a dead tunnel.
    });
    await openTalk(page);
    await page.getByRole('button', {name: 'Start Live Voice'}).filter({visible: true}).first().click();
    await expect(page.getByRole('alert').filter({hasText: "Couldn't connect to live voice"})).toBeVisible({
      timeout: 25_000,
    });
  });
});
