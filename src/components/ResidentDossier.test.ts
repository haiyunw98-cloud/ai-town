import { readFileSync } from 'node:fs';
import { residentStatusBanners } from './runtimeViewState';

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

  test('renders live economy facts before secondary life details without treating derived finance as cash', () => {
    for (const label of ['真实金贝', '今日收入', '今日支出', '饥饿', '精力', '职业与机构', '最近经济事实']) {
      expect(source).toContain(label);
    }
    expect(source.indexOf('resident-economy')).toBeLessThan(source.indexOf('人生资料'));
    expect(source).toContain("dossier.economy.economyStatus === 'initializing'");
    expect(source).toContain('经济运行态正在初始化');
    expect(source).not.toContain("finance: '财务'");
  });

  test('renders all four live relationship dimensions including honest zeroes and evidence', () => {
    for (const label of ['友情', '信任', '恋爱倾向', '商业', '最近变化依据']) {
      expect(source).toContain(label);
    }
    expect(source).toContain('人生资料');
    expect(source).toContain('社会关系');
    expect(source).toContain('最近发生');
    expect(source).toContain('dossier.relationships.map');
    expect(source).toContain('relationship.friendship');
    expect(source).toContain('relationship.trust');
    expect(source).toContain('relationship.attraction');
    expect(source).toContain('relationship.business');
    expect(source).toContain('relationship.recentChanges');
    expect(source).toContain('dossier.recentEvents.map');
  });

  test('labels paused snapshots and partial relationship networks without calling them live', () => {
    expect(source).toContain('residentStatusBanners(dossier)');
    expect(source).toContain('statusBanners.top');
    expect(source).toContain('statusBanners.relationships');
  });

  test('shows an unavailable boundary instead of reading missing dossier fields', () => {
    expect(source).toContain("dossier.dossierStatus === 'unavailable'");
    expect(source).toContain('statusBanners.top');
  });

  test('derives paused, partial, and unavailable resident banners from real view state', () => {
    const banners = residentStatusBanners;
    expect(banners({ dossierStatus: 'available', snapshotStatus: 'paused', relationshipsStatus: 'snapshot', relationshipCount: 8, expectedRelationshipCount: 8 })).toEqual({
      top: '已暂停，以下为暂停前账本；居民不会继续推进。',
      relationships: null,
    });
    expect(banners({ dossierStatus: 'available', snapshotStatus: 'current', relationshipsStatus: 'partial', relationshipCount: 3, expectedRelationshipCount: 8 })).toEqual({
      top: null,
      relationships: '关系网络尚未完整：已载入 3 / 8 位居民。',
    });
    expect(banners({ dossierStatus: 'unavailable', snapshotStatus: 'unavailable' })).toEqual({
      top: '居民运行身份暂不可用，正在等待完整运行映射。',
      relationships: null,
    });
  });
});
