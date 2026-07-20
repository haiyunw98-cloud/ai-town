import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const validator = await import('./validate-world-assets.mjs');

void test('resident photo validation requires nine complete four-photo WebP sets', () => {
  assert.equal(
    typeof validator.validateResidentPhotoAssets,
    'function',
    'validator must export validateResidentPhotoAssets',
  );

  const publicDir = mkdtempSync(join(tmpdir(), 'lighthouse-photo-assets-'));
  const scenes = ['portrait', 'work', 'life', 'social'];
  const profiles = Array.from({ length: 9 }, (_, index) => {
    const id = `resident-${index + 1}`;
    const photos = scenes.map(
      (scene) => `/ai-town/assets/worlds/lighthouse-town/residents/${id}/${scene}.webp`,
    );
    for (const photo of photos) {
      const relativePath = photo.replace(/^\/ai-town\//, '');
      const absolutePath = join(publicDir, relativePath);
      mkdirSync(join(absolutePath, '..'), { recursive: true });
      writeFileSync(absolutePath, 'webp');
    }
    return { id, photos };
  });

  assert.deepEqual(validator.validateResidentPhotoAssets(profiles, publicDir), []);

  profiles[0].photos.pop();
  profiles[1].photos[0] = profiles[1].photos[0].replace(/\.webp$/, '.png');
  const emptyPhoto = join(
    publicDir,
    profiles[2].photos[0].replace(/^\/ai-town\//, ''),
  );
  writeFileSync(emptyPhoto, '');

  const failures = validator.validateResidentPhotoAssets(profiles, publicDir);
  assert.ok(failures.some((failure) => failure.includes('resident-1') && failure.includes('four')));
  assert.ok(failures.some((failure) => failure.includes('resident-2') && failure.includes('WebP')));
  assert.ok(failures.some((failure) => failure.includes('resident-3') && failure.includes('empty')));
  assert.ok(failures.some((failure) => failure.includes('36')));
});

void test('operations guide validation follows the current local Lighthouse Town contract', () => {
  assert.equal(
    typeof validator.validateOperationsGuide,
    'function',
    'validator must export validateOperationsGuide',
  );

  const currentGuide = [
    './scripts/install-lighthouse-site.sh',
    'http://localhost:4174/ai-town',
    'LLM_PROVIDER=ollama',
    'OLLAMA_MODEL=gemma4:12b',
    'WORLD_LOCALE=zh-CN',
    '事实流水账',
    '社会观察日志',
    'IMA导入',
    'messages',
  ].join('\n');
  assert.deepEqual(validator.validateOperationsGuide(currentGuide), []);

  const failures = validator.validateOperationsGuide('npm run dev');
  assert.ok(failures.some((failure) => failure.includes('gemma4:12b')));
  assert.ok(failures.some((failure) => failure.includes('4174')));
  assert.ok(failures.some((failure) => failure.includes('社会观察日志')));
});
