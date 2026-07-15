import { readFileSync } from 'node:fs';

describe('ResidentDossier', () => {
  const source = readFileSync(new URL('./ResidentDossier.tsx', import.meta.url), 'utf8');

  test('renders the resident photo gallery and AI disclosure', () => {
    expect(source).toContain('resident-photo-gallery');
    expect(source).toContain('AI 生成角色影像');
    expect(source).toContain('resident-featured-photo');
    expect(source).toContain('resident-life-thumbnails');
    expect(source).toContain('dossier.profile.photos[0]');
    expect(source).toContain('dossier.profile.photos.slice(1)');
  });

  test('places identity and current situation over the leading portrait', () => {
    expect(source).toContain('resident-photo-identity');
    expect(source).toContain('dossier.profile.name');
    expect(source).toContain('dossier.profile.occupation');
    expect(source).toContain('dossier.profile.age');
    expect(source).toContain('dossier.situation');
  });

  test('renders life attributes, relationships, and a recent timeline', () => {
    for (const label of ['心情', '精力', '健康', '财务', '声望', '社交']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('人生资料');
    expect(source).toContain('社会关系');
    expect(source).toContain('最近发生');
    expect(source).toContain('dossier.relationships.map');
    expect(source).toContain('dossier.recentEvents.map');
  });
});
