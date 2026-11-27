import fs from 'node:fs';
import {expect, gotoTab, openSettings, test} from '../support';

// The same pre-883e95d snapshot the unit test uses (src/utils/storageMigration.test.ts).
const snapshot = JSON.parse(
  fs.readFileSync(new URL('../../src/utils/__fixtures__/pre-883e95d-storage.json', import.meta.url), 'utf8')
) as Record<string, unknown>;
type Vocab = {term: string; language: string; contextSentence: string};
const vocab = snapshot.linguaforge_vocab_v1 as Vocab[];

test.describe('storage migration', () => {
  test.use({freshInstall: true});

  test('a pre-883e95d user loads with config, vocab, sessions and threads intact', async ({page}) => {
    await page.addInitScript((data) => {
      if (localStorage.getItem('__e2e_seeded')) return;
      localStorage.setItem('__e2e_seeded', '1');
      for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value));
    }, snapshot);
    await page.goto('/');

    // The data-safety notice is new since that version, so it is shown once.
    await page.getByRole('button', {name: 'I Understand — Continue'}).click();

    // Config: Spanish, Rioplatense, Work focus off by default after migration.
    await expect(page.getByRole('button', {name: /change mission context/i})).toHaveAccessibleName(/^ES Rioplatense/);
    await openSettings(page);
    await expect(page.locator('#settings-work-focus')).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', {name: 'Close settings'}).click();

    // Vocab: every Spanish item with its sentence (Portuguese ones are in the PT deck).
    await gotoTab(page, 'Vocab');
    for (const item of vocab.filter((v) => v.language === 'es')) {
      await expect(page.getByRole('main')).toContainText(item.term);
      await expect(page.getByRole('main')).toContainText(item.contextSentence);
    }

    // Sessions: both past OPI calls are listed with their debriefs.
    await gotoTab(page, 'Test prep');
    await expect(page.getByRole('button', {name: /Past sessions/})).toContainText('2 debriefs available');

    // Talk: the old chat thread can be resumed.
    await gotoTab(page, 'Talk');
    await expect(page.getByRole('main')).toContainText('2 messages saved locally');

    // Storage was migrated in place: every vocab item kept, now with an FSRS schedule.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('linguaforge_vocab_v2') ?? '[]'));
    expect(stored).toHaveLength(vocab.length);
    expect(stored.every((v: {fsrs?: {dueAt?: string}}) => Boolean(v.fsrs?.dueAt))).toBe(true);
    expect(stored.map((v: Vocab) => v.term).sort()).toEqual(vocab.map((v) => v.term).sort());

    await page.reload();
    await expect(page.getByRole('button', {name: 'I Understand — Continue'})).toHaveCount(0);
    await gotoTab(page, 'Vocab');
    await expect(page.getByRole('main')).toContainText(vocab[0].term);
  });
});
