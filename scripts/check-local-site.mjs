import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalPreview } from './lib/local-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--site')) throw new Error('Usage: npm run test:site -- --site ../skills-hub-web');
const siteDir = path.resolve(args[1] ?? path.join(root, '../skills-hub-web'));
const externalCovers = {
  engineering: 'https://res.cloudinary.com/total-typescript/image/upload/v1777382277/skill-repo-light_2x.png',
  taste: 'https://raw.githubusercontent.com/Leonxlnx/taste-skill/ce26fc25c0e5e8cab638f883de62d9a86ee5e45b/assets/readme-banner.webp',
};
const temporary = await mkdtemp(path.join(os.tmpdir(), 'skills-hub-local-site-'));
let preview, browser;
try {
  await cp(path.join(root, 'collections'), path.join(temporary, 'collections'), { recursive: true });
  await cp(path.join(root, '.catalog'), path.join(temporary, '.catalog'), { recursive: true });
  preview = await startLocalPreview({ rootDir: temporary, siteDir, sitePort: 0, dataPort: 0, watch: false, sourceRevision: 'a'.repeat(40), log: () => {} });
  const first = preview.lastPublication;
  assert.equal(first.count, 3);
  assert.equal(first.uploadedImages, 1);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const remoteFixture = await readFile(path.join(root, 'tests/fixtures/migrated/collections/engineering/cover.png'));
  for (const url of Object.values(externalCovers)) await page.route(url, route => route.fulfill({ status: 200, contentType: 'image/png', body: remoteFixture }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('skills-hub-language', 'zh'));
  await page.goto(preview.siteUrl);
  await page.locator('main a.mc-card[href="/collections/taste"]').waitFor({ timeout: 3000 });
  await page.goto(`${preview.siteUrl}/collections`);
  await page.locator('#collection-grid > a').nth(2).waitFor();
  assert.equal(await page.locator('#collection-grid > a').count(), 3);
  assert.equal(await page.locator('#collection-grid img').count(), 3);
  await page.waitForFunction(() => [...document.querySelectorAll('#collection-grid img')].every(image => image.complete && image.naturalWidth > 0));
  for (const [slug, url] of Object.entries(externalCovers)) assert.equal(await page.locator(`a[href="/collections/${slug}"] img`).getAttribute('src'), url);
  const titleSelector = 'a[href="/collections/taste"] h3';
  const originalTitle = (await page.locator(titleSelector).innerText()).replace('↗', '').trim();
  const videoCover = 'a[href="/collections/product-video"] img';
  const originalImage = await page.locator(videoCover).getAttribute('src');
  for (const [slug, displayed, installed] of [['taste', 13, 13], ['engineering', 31, 31], ['product-video', 3, 14]]) {
    const pointer = await (await fetch(`${preview.dataUrl}/current.json`)).json();
    const index = await (await fetch(`${preview.dataUrl}/${pointer.snapshotPath}index.json`)).json();
    const item = index.collections.find(item => item.slug === slug);
    assert.equal(item.itemCount, displayed);
    assert.equal(item.installationCount, installed);
    await page.goto(`${preview.siteUrl}/collections/${slug}`);
    await page.locator('#collection-title').waitFor();
    assert.ok((await page.locator('.rc-overview').innerText()).trim());
    if (displayed > 8) await page.locator('.mc-expand').click();
    assert.equal(await page.locator('.rc-skill-row').count(), displayed);
    if (slug === 'product-video') {
      assert.equal(await page.locator('.rc-package-count').count(), 1);
      await page.locator('.rc-skill-row details').first().locator('summary').click();
      assert.equal(await page.locator('.rc-package li').count(), 12);
    }
  }
  await page.goto(`${preview.siteUrl}/collections`);
  await page.locator(titleSelector).waitFor();
  const tasteZh = path.join(temporary, 'collections/design/taste/README.zh.md');
  const tasteEn = path.join(temporary, 'collections/design/taste/README.md');
  await writeFile(tasteZh, (await readFile(tasteZh, 'utf8')).replace(/^# .+$/m, '# Taste Skill · 本地更新验证'));
  await writeFile(tasteEn, (await readFile(tasteEn, 'utf8')).replace(/^# .+$/m, '# Taste Skill · Local update verification'));
  const textUpdate = await preview.publish();
  assert.notEqual(textUpdate.version, first.version);
  assert.equal(textUpdate.uploadedImages, 0);
  assert.equal(textUpdate.reusedImages, 1);
  await page.waitForFunction(() => document.querySelector('a[href="/collections/taste"] h3')?.textContent.includes('本地更新验证'));
  assert.equal(await page.locator(videoCover).getAttribute('src'), originalImage);
  const imageFile = path.join(temporary, 'collections/media/product-video/cover.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBv8AAAAASUVORK5CYII=', 'base64');
  await writeFile(imageFile, png);
  const imageUpdate = await preview.publish();
  assert.equal(imageUpdate.uploadedImages, 1);
  assert.equal(imageUpdate.reusedImages, 0);
  await page.waitForFunction(previous => document.querySelector('a[href="/collections/product-video"] img')?.getAttribute('src') !== previous, originalImage);
  await page.waitForFunction(() => { const image = document.querySelector('a[href="/collections/product-video"] img'); return image?.complete && image.naturalWidth === 1; });
  for (const [slug, url] of Object.entries(externalCovers)) assert.equal(await page.locator(`a[href="/collections/${slug}"] img`).getAttribute('src'), url);
  const validMarkdown = await readFile(tasteEn, 'utf8');
  await writeFile(tasteEn, '# Invalid collection\n');
  await assert.rejects(() => preview.publish());
  const afterFailure = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  assert.equal(afterFailure.version, imageUpdate.version);
  assert.ok((await page.locator(titleSelector).innerText()).includes('本地更新验证'));
  await writeFile(tasteEn, validMarkdown);
  await preview.rollback(first.version);
  await page.waitForFunction(title => document.querySelector('a[href="/collections/taste"] h3')?.textContent.replace('↗', '').trim() === title, originalTitle);
  assert.equal(await page.locator(videoCover).getAttribute('src'), originalImage);
  await page.waitForFunction(() => [...document.querySelectorAll('#collection-grid img')].every(image => image.complete && image.naturalWidth > 1));
  assert.deepEqual(errors, []);
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'dist/local-verification.png'), fullPage: true });
  await preview.close();
  preview = await startLocalPreview({ rootDir: temporary, siteDir, sitePort: 0, dataPort: 0, sourceRevision: 'a'.repeat(40), log: () => {} });
  const watchedVersion = preview.lastPublication.version;
  await page.goto(`${preview.siteUrl}/collections`);
  await page.locator(titleSelector).waitFor();
  await writeFile(tasteZh, (await readFile(tasteZh, 'utf8')).replace(/^# .+$/m, '# Taste Skill · 自动监听验证'));
  await writeFile(tasteEn, (await readFile(tasteEn, 'utf8')).replace(/^# .+$/m, '# Taste Skill · Watch update verification'));
  await page.waitForFunction(() => document.querySelector('a[href="/collections/taste"] h3')?.textContent.includes('自动监听验证'));
  assert.notEqual(preview.lastPublication.version, watchedVersion);
  assert.equal(preview.lastPublication.uploadedImages, 0);
  assert.equal(preview.lastPublication.reusedImages, 1);
  assert.deepEqual(errors, []);
  const report = { collections: 3, homeFeatured: 'taste', counts: { taste: [13, 13], engineering: [31, 31], 'product-video': [3, 14] }, externalCovers, remoteCoversMocked: true, initial: first, textUpdate, imageUpdate, failedPublishPreserved: true, rollbackRestored: true, watchedUpdateApplied: true, browserErrors: 0 };
  await writeFile(path.join(root, 'dist/local-verification.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('本地联调通过：3 个合集；文案更新新增 0 张图片；封面更新新增 1 张图片；自动监听、失败保留和回滚均通过。\n');
} finally {
  await browser?.close();
  await preview?.close();
  await rm(temporary, { recursive: true, force: true });
}
