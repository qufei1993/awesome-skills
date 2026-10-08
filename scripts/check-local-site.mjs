import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalPreview } from './lib/local-preview.mjs';
import { loadCatalog } from './lib/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--site')) throw new Error('Usage: npm run test:site -- --site ../skills-hub-web');
const siteDir = path.resolve(args[1] ?? path.join(root, '../skills-hub-web'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'skills-hub-local-site-'));
let preview, browser;
try {
  await cp(path.join(root, 'collections'), path.join(temporary, 'collections'), { recursive: true });
  for (const cached of ['upstream-cache','generated-catalog.json']) {
    try { await cp(path.join(root,'dist',cached),path.join(temporary,'dist',cached),{recursive:true}); }
    catch(error) {if (error.code !== 'ENOENT') throw error;}
  }
  const records = await loadCatalog({ rootDir: temporary, mode: 'submission', resolveSources: true });
  const upstreamResponses = new Map();
  const upstreamCache = path.join(temporary, 'dist/upstream-cache');
  for (const relative of await readdir(upstreamCache, { recursive: true })) {
    if (!relative.endsWith('.json')) continue;
    const cached = JSON.parse(await readFile(path.join(upstreamCache, relative), 'utf8'));
    assert.equal(cached.digest, createHash('sha256').update(JSON.stringify(cached.payload)).digest('hex'));
    upstreamResponses.set(cached.endpoint, cached.payload);
  }
  const request = async endpoint => {
    if (upstreamResponses.has(endpoint)) return upstreamResponses.get(endpoint);
    const fixedCommitScope = /^(\/repos\/[^/]+\/[^/]+\/commits\/)([a-f0-9]{40})%2F/i.exec(endpoint);
    if (fixedCommitScope && upstreamResponses.get(`${fixedCommitScope[1]}${fixedCommitScope[2]}`)?.sha === fixedCommitScope[2]) {
      return { status: 404, message: 'Not Found' };
    }
    assert.fail(`Upstream fixture missing: ${endpoint}`);
  };
  const expectedCollections = records.filter(record => record.complete && record.document.status === 'active').map(record => record.document);
  const expectedById = new Map(expectedCollections.map(document => [document.id, JSON.parse(JSON.stringify(document))]));
  preview = await startLocalPreview({ rootDir: temporary, siteDir, sitePort: 0, dataPort: 0, watch: false, sourceRevision: 'a'.repeat(40), resolveSources: true, request, log: () => {} });
  const first = preview.lastPublication;
  const firstPointer = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  assert.equal(firstPointer.version, first.version);
  const index = await (await fetch(`${preview.dataUrl}/${firstPointer.snapshotPath}index.json`)).json();
  const collections = index.collections;
  assert.deepEqual(collections.map(item => `${item.slug}:${item.id}`).sort(), expectedCollections.map(item => `${item.slug}:${item.id}`).sort());
  assert.equal(first.count, collections.length);
  const details = await Promise.all(collections.map(async item => (await fetch(`${preview.dataUrl}/${firstPointer.snapshotPath}${item.id}.json`)).json()));
  const sourceImages = collections.filter(item => item.cover.kind === 'source-image');
  const externalCovers = Object.fromEntries(sourceImages.filter(item => item.cover.url.startsWith('https://')).map(item => [item.slug, item.cover.url]));
  const initialImageKeys = new Set(Object.values(firstPointer.assets));
  assert.equal(first.imageCount, initialImageKeys.size);
  assert.equal(first.retainedVersion, null);
  const featured = collections.find(item => item.category === 'marketing') ?? collections[0];
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const remoteFixture = await readFile(path.join(root, 'collections/media/product-video/cover.png'));
  const remoteURLs = new Set(Object.values(externalCovers).map(url => new URL(url).href.split('#')[0]));
  const mockedURLs = new Set();
  await page.route(url => remoteURLs.has(url.href), async route => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: remoteFixture });
    mockedURLs.add(route.request().url());
  });
  async function assertListing(pointer) {
    assert.deepEqual(await page.locator('#collection-grid > a').evaluateAll(cards => cards.map(card => card.getAttribute('href'))), collections.map(item => `/collections/${item.slug}`));
    assert.equal(await page.locator('#collection-grid img').count(), sourceImages.length);
    for (const item of sourceImages) {
      const asset = pointer.assets[item.cover.url.slice('/data/collections/'.length)];
      const url = item.cover.url.startsWith('https://') ? item.cover.url : `${preview.dataUrl}/${asset}`;
      const selector = `#collection-grid a[href="/collections/${item.slug}"] img`;
      const image = page.locator(selector);
      assert.equal(await image.getAttribute('src'), url, `${item.slug} cover URL`);
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(selector => {
        const image = document.querySelector(selector);
        return image?.complete && image.naturalWidth > 0;
      }, selector);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.deepEqual([...mockedURLs].sort(), [...remoteURLs].sort());
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('skills-hub-language', 'zh'));
  await page.goto(preview.siteUrl);
  await page.locator(`main a.mc-card[href="/collections/${featured.slug}"]`).waitFor({ timeout: 3000 });
  assert.equal(await page.locator('main a.mc-card').count(), 1);
  await page.goto(`${preview.siteUrl}/collections`);
  await page.locator('#collection-grid > a').nth(collections.length - 1).waitFor();
  await assertListing(firstPointer);
  const titleSelector = 'a[href="/collections/taste"] h3';
  const originalTitle = (await page.locator(titleSelector).innerText()).replace('↗', '').trim();
  const videoCover = 'a[href="/collections/product-video"] img';
  const originalImage = await page.locator(videoCover).getAttribute('src');
  const originalDimensions = await page.locator(videoCover).evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  const counts = {}, detailVisits = [];
  for (const [position, item] of collections.entries()) {
    const detail = details[position];
    assert.deepEqual(detail, expectedById.get(item.id), `${item.slug} snapshot details`);
    const installations = new Map();
    for (const installation of detail.skills.flatMap(skill => skill.installationItems)) {
      const key = `${installation.repo.toLowerCase()}\0${installation.commit.toLowerCase()}\0${installation.directory}`;
      if (!installations.has(key)) installations.set(key, installation);
    }
    assert.equal(item.itemCount, detail.skills.length, `${item.slug} display count`);
    assert.equal(item.installationCount, installations.size, `${item.slug} installation count`);
    counts[item.slug] = [detail.skills.length, installations.size];
    await page.goto(`${preview.siteUrl}/collections/${item.slug}`);
    await page.locator('#collection-title').waitFor();
    assert.equal(await page.locator('#collection-title').innerText(), detail.title);
    assert.ok((await page.locator('.rc-overview').innerText()).trim());
    assert.equal(await page.locator('.rc-skill-row').count(), Math.min(8, item.itemCount));
    if (item.itemCount > 8) await page.locator('.mc-expand').click();
    const rows = page.locator('.rc-skill-row');
    assert.equal(await rows.count(), item.itemCount);
    assert.deepEqual(await rows.locator('.rc-skill-title > strong').allTextContents(), detail.skills.map(skill => skill.name));
    const installUrl = await page.locator('.rc-dock-actions a[href^="skills-hub://install"]').getAttribute('href');
    const manifest = JSON.parse(new URL(installUrl).searchParams.get('manifest'));
    assert.equal(manifest.v, 1);
    assert.equal(manifest.title, detail.title);
    assert.equal(manifest.skills.length, item.installationCount);
    assert.deepEqual(manifest.skills.map(skill => [`${manifest.sources[skill.source].repo.toLowerCase()}\0${manifest.sources[skill.source].ref.toLowerCase()}\0${skill.path}`, skill.name]).sort(), [...installations].map(([key, installation]) => [key, installation.name]).sort());
    assert.equal(Number((await page.locator('.rc-dock-selection > p').first().innerText()).match(/\d+/)?.[0]), item.installationCount);
    assert.ok(detail.skills.every(skill => skill.installationMode === 'skill' && skill.installationItems.length === 1));
    assert.equal(await page.locator('.rc-package-count').count(), 0);
    detailVisits.push(item.slug);
  }
  await page.goto(`${preview.siteUrl}/collections`);
  await page.locator(titleSelector).waitFor();
  const tasteZh = path.join(temporary, 'collections/design/taste/README.zh.md');
  const tasteEn = path.join(temporary, 'collections/design/taste/README.md');
  const originalZh = await readFile(tasteZh, 'utf8');
  const originalEn = await readFile(tasteEn, 'utf8');
  await writeFile(tasteZh, originalZh.replace(/^# .+$/m, '# Taste Skill · 本地更新验证'));
  await writeFile(tasteEn, originalEn.replace(/^# .+$/m, '# Taste Skill · Local update verification'));
  const textUpdate = await preview.publish();
  assert.notEqual(textUpdate.version, first.version);
  assert.equal(textUpdate.count, collections.length);
  assert.equal(textUpdate.retainedVersion, first.version);
  const textPointer = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  assert.deepEqual(textPointer.assets, firstPointer.assets);
  assert.equal(textUpdate.imageCount, initialImageKeys.size);
  await page.waitForFunction(() => document.querySelector('a[href="/collections/taste"] h3')?.textContent.includes('本地更新验证'));
  assert.equal(await page.locator(videoCover).getAttribute('src'), originalImage);
  await assertListing(firstPointer);
  const imageFile = path.join(temporary, 'collections/media/product-video/cover.png');
  const originalCover = await readFile(imageFile);
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBv8AAAAASUVORK5CYII=', 'base64');
  let png;
  do {
    const text = Buffer.from(`verification\0${randomUUID()}`);
    const chunk = Buffer.alloc(text.length + 12);
    chunk.writeUInt32BE(text.length);
    chunk.write('tEXt', 4);
    text.copy(chunk, 8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4, -4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
    png = Buffer.concat([pixel.subarray(0, -12), chunk, pixel.subarray(-12)]);
  } while (initialImageKeys.has(`images/${createHash('sha256').update(png).digest('hex')}.png`));
  await writeFile(imageFile, png);
  const imageUpdate = await preview.publish();
  assert.equal(imageUpdate.count, collections.length);
  const imagePointer = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  const updatedImageKeys = new Set(Object.values(imagePointer.assets));
  assert.equal([...updatedImageKeys].filter(key => !initialImageKeys.has(key)).length, 1);
  assert.equal(imageUpdate.retainedVersion, textUpdate.version);
  assert.equal(imageUpdate.imageCount, new Set([...initialImageKeys, ...updatedImageKeys]).size);
  for (const imageKey of initialImageKeys) assert.equal((await fetch(`${preview.dataUrl}/${imageKey}`)).status, 200);
  await page.waitForFunction(previous => document.querySelector('a[href="/collections/product-video"] img')?.getAttribute('src') !== previous, originalImage);
  await page.locator(videoCover).scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const image = document.querySelector('a[href="/collections/product-video"] img'); return image?.complete && image.naturalWidth === 1; });
  await assertListing(imagePointer);
  await writeFile(tasteEn, '# Invalid collection\n');
  await assert.rejects(() => preview.publish());
  const afterFailure = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  assert.deepEqual(afterFailure, imagePointer);
  assert.ok((await page.locator(titleSelector).innerText()).includes('本地更新验证'));
  await writeFile(tasteEn, originalEn);
  await writeFile(tasteZh, originalZh);
  await writeFile(imageFile, originalCover);
  const restored = await preview.publish();
  const restoredPointer = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  assert.equal(restored.retainedVersion, imageUpdate.version);
  assert.deepEqual(restoredPointer.assets, firstPointer.assets);
  await page.waitForFunction(title => document.querySelector('a[href="/collections/taste"] h3')?.textContent.replace('↗', '').trim() === title, originalTitle);
  assert.equal(await page.locator(videoCover).getAttribute('src'), originalImage);
  await page.locator(videoCover).scrollIntoViewIfNeeded();
  await page.waitForFunction(dimensions => {
    const image = document.querySelector('a[href="/collections/product-video"] img');
    return image?.complete && image.naturalWidth === dimensions.width && image.naturalHeight === dimensions.height;
  }, originalDimensions);
  await assertListing(restoredPointer);
  assert.deepEqual(errors, []);
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'dist/local-verification.png'), fullPage: true });
  await preview.close();
  preview = await startLocalPreview({ rootDir: temporary, siteDir, sitePort: 0, dataPort: 0, sourceRevision: 'a'.repeat(40), resolveSources: true, request, log: () => {} });
  const watchedVersion = preview.lastPublication.version;
  await page.goto(`${preview.siteUrl}/collections`);
  await page.locator(titleSelector).waitFor();
  await writeFile(tasteZh, (await readFile(tasteZh, 'utf8')).replace(/^# .+$/m, '# Taste Skill · 自动监听验证'));
  await writeFile(tasteEn, (await readFile(tasteEn, 'utf8')).replace(/^# .+$/m, '# Taste Skill · Watch update verification'));
  await page.waitForFunction(() => document.querySelector('a[href="/collections/taste"] h3')?.textContent.includes('自动监听验证'));
  assert.notEqual(preview.lastPublication.version, watchedVersion);
  assert.equal(preview.lastPublication.count, collections.length);
  const watchedPointer = await (await fetch(`${preview.dataUrl}/current.json`)).json();
  assert.deepEqual(watchedPointer.assets, firstPointer.assets);
  assert.equal(preview.lastPublication.imageCount, initialImageKeys.size);
  await assertListing(watchedPointer);
  assert.deepEqual(errors, []);
  const report = { collections: collections.length, homeFeatured: featured.slug, counts, detailVisits, sourceImageCount: sourceImages.length, externalCovers, upstreamResponsesReplayed: true, remoteCoversMocked: true, remoteCovers: { mocked: true, urls: [...remoteURLs], fulfilledURLs: [...mockedURLs] }, initial: first, textUpdate, imageUpdate, restored, unchangedCoverPathsReused: true, changedCoverPaths: 1, failedPublishPreserved: true, sourceRestorationApplied: true, watchedUpdateApplied: true, browserErrors: 0 };
  await writeFile(path.join(root, 'dist/local-verification.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`本地联调通过：${collections.length} 个合集，${sourceImages.length} 张来源图片；文案更新复用封面路径；封面更新新增 1 个图片路径；自动监听、失败保留和恢复贡献内容均通过。\n`);
} finally {
  await browser?.close();
  await preview?.close();
  await rm(temporary, { recursive: true, force: true });
}
