import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import {expect, type Page, type Request, test as base, type TestInfo} from '@playwright/test';

/**
 * Shared fixtures for the e2e suite.
 * - Browser speech APIs are stubbed: SpeechRecognition "hears" the next queued utterance shortly after
 *   start() (window.e2eSpeech.say(...) queues more), and speechSynthesis finishes each utterance at
 *   once, so OPI and role-play calls move on without real audio.
 * - The data-safety notice is pre-acknowledged unless a test opts out with `freshInstall`.
 * - `api` records every /api request and response body, for assertions on real network payloads.
 */

export const DEFAULT_UTTERANCES = [
  'Trabajo en una oficina en el centro y tomo el autobús todos los días.',
  'El fin de semana pasado fui al mercado con mi familia y compramos fruta.',
  'Para las vacaciones voy a viajar a la playa con mis amigos.',
  'Si las oficinas cierran, la gente va a usar menos el metro.',
  'Muchas gracias a usted.',
];

function installSpeechStubs(utterances: string[]) {
  type Listener = ((event?: unknown) => void) | null;
  const queue = [...utterances];
  (window as unknown as {e2eSpeech: unknown}).e2eSpeech = {
    say: (text: string) => queue.unshift(text),
    remaining: () => queue.length,
  };
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = 'es-ES';
    onresult: Listener = null;
    onerror: Listener = null;
    onend: Listener = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    start() {
      this.timer = setTimeout(() => {
        const text = queue.shift() ?? 'Sí, claro.';
        const result = Object.assign([{transcript: text, confidence: 0.95}], {isFinal: true});
        this.onresult?.({resultIndex: 0, results: [result]});
      }, 300);
    }
    stop() {
      if (this.timer) clearTimeout(this.timer);
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.stop();
    }
  }
  Object.defineProperty(window, 'SpeechRecognition', {value: FakeRecognition, configurable: true});
  Object.defineProperty(window, 'webkitSpeechRecognition', {value: FakeRecognition, configurable: true});

  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null as Listener,
    getVoices: () => [],
    cancel() {},
    pause() {},
    resume() {},
    speak(utterance: {onstart?: Listener; onend?: Listener}) {
      setTimeout(() => utterance.onstart?.(), 0);
      setTimeout(() => utterance.onend?.(), 50);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', {value: synth, configurable: true});
  if (!('SpeechSynthesisUtterance' in window)) {
    (window as unknown as {SpeechSynthesisUtterance: unknown}).SpeechSynthesisUtterance = class {
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    };
  }
}

export interface ApiCall {
  method: string;
  path: string;
  requestBody: string;
  status: number;
  responseBody: string;
}

type Fixtures = {
  freshInstall: boolean;
  utterances: string[];
  api: ApiCall[];
};

export const test = base.extend<Fixtures>({
  freshInstall: [false, {option: true}],
  utterances: [DEFAULT_UTTERANCES, {option: true}],
  api: async ({page}, provide) => {
    const calls: ApiCall[] = [];
    const pending: Promise<void>[] = [];
    page.on('requestfinished', (req: Request) => {
      const url = new URL(req.url());
      if (!url.pathname.startsWith('/api/')) return;
      pending.push(
        (async () => {
          const res = await req.response();
          calls.push({
            method: req.method(),
            path: url.pathname,
            requestBody: req.postData() ?? '',
            status: res?.status() ?? 0,
            responseBody: res ? await res.text().catch(() => '') : '',
          });
        })()
      );
    });
    await provide(calls);
    await Promise.all(pending);
  },
  page: async ({page, freshInstall, utterances, request}, provide) => {
    // Every test starts each canned Gemini sequence from its first answer.
    await request.post('/__fixtures/reset');
    await page.addInitScript(installSpeechStubs, utterances);
    if (!freshInstall) {
      await page.addInitScript(() => {
        if (!localStorage.getItem('linguaforge_data_safety_v1')) {
          localStorage.setItem('linguaforge_data_safety_v1', 'true');
          // Tab intros are covered by first launch; other tests start past them.
          localStorage.setItem(
            'linguaforge_seen_tabs_v2',
            JSON.stringify(['today', 'talk', 'test_prep', 'brief', 'vocab'])
          );
        }
      });
    }
    await provide(page);
  },
});

export {expect};

/** Waits for every recorded /api response body to be readable. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
}

export async function gotoTab(page: Page, tab: 'Today' | 'Talk' | 'Test prep' | 'Brief' | 'Vocab') {
  await page
    .getByRole('button', {name: new RegExp(`^${tab}(\\s*\\d+)?$`)})
    .filter({visible: true})
    .first()
    .click();
}

export async function openSettings(page: Page) {
  await page
    .getByRole('button', {name: /mission settings/i})
    .filter({visible: true})
    .first()
    .click();
  await expect(page.locator('#settings-work-focus')).toBeVisible();
}

/**
 * Saves what the user sees on a main screen (the viewport, like a device mockup) for design review;
 * uploaded as a CI artifact. Full-page captures would paint sticky headers mid-page.
 */
export async function screen(page: Page, testInfo: TestInfo, name: string) {
  const dir = path.join('e2e', 'screens', testInfo.project.name);
  fs.mkdirSync(dir, {recursive: true});
  await page.waitForTimeout(250);
  await page.screenshot({path: path.join(dir, `${name}.png`), animations: 'disabled'});
}

/** Runs axe on the current screen and fails on serious or critical violations. */
export async function expectAccessible(page: Page, testInfo: TestInfo, name: string) {
  const results = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  await testInfo.attach(`axe-${name}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    blocking.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`
    ),
    `axe on ${name}`
  ).toEqual([]);
}

/** Screenshot + axe for a main screen. */
export async function checkScreen(page: Page, testInfo: TestInfo, name: string) {
  await screen(page, testInfo, name);
  await expectAccessible(page, testInfo, name);
}

export const isWebKit = (testInfo: TestInfo) => testInfo.project.name.startsWith('webkit');
export const isMobile = (testInfo: TestInfo) => testInfo.project.name.endsWith('mobile');

/** Switches the target language through the mission chip sheet. */
export async function setLanguage(page: Page, language: 'es' | 'pt') {
  await page.getByRole('button', {name: /change mission context/i}).click();
  await page
    .getByRole('group', {name: 'Target language'})
    .getByRole('button')
    .nth(language === 'es' ? 0 : 1)
    .click();
  await page.getByRole('button', {name: 'Apply Mission Context'}).click();
  await expect(page.getByRole('button', {name: /change mission context/i})).toHaveAccessibleName(
    new RegExp(`^${language.toUpperCase()} `)
  );
}
