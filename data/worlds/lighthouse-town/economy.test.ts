import { lighthouseCharacters } from './characters';
import { goods, institutions, residentEconomyProfiles, services } from './economy';
import { townLandmarks } from './map';

describe('灯塔镇经济基础定义', () => {
  test('每位现有居民恰好有一份经济档案', () => {
    expect(residentEconomyProfiles.map((entry) => entry.name).sort()).toEqual(
      lighthouseCharacters.map((entry) => entry.name['zh-CN']).sort(),
    );
    expect(residentEconomyProfiles.map((entry) => entry.id).sort()).toEqual(
      lighthouseCharacters.map((entry) => entry.id).sort(),
    );
    expect(new Set(residentEconomyProfiles.map((entry) => entry.id)).size).toBe(9);
  });

  test('每个地图机构恰好有一份可使用的经济定义', () => {
    expect(institutions.map((entry) => entry.landmarkId).sort()).toEqual(
      townLandmarks.map((entry) => entry.id).sort(),
    );
    expect(new Set(institutions.map((entry) => entry.id)).size).toBe(9);
    expect(institutions.every((entry) => entry.id === entry.landmarkId)).toBe(true);
  });

  test('只使用五种有正数且有上限的日常商品价格', () => {
    expect(goods.map((entry) => entry.id)).toEqual([
      'meal',
      'tea',
      'medicine',
      'daily-goods',
      'craft-service',
    ]);
    expect(goods.map((entry) => entry.price)).toEqual([6, 4, 10, 8, 12]);
    expect(goods.every((entry) => entry.price > 0 && entry.price <= 20)).toBe(true);
  });

  test('居民补偿、余额和产出均为明确且有界的可结算数据', () => {
    const serviceIds = services.map((service) => service.id);
    for (const profile of residentEconomyProfiles) {
      expect(profile.startingBalance).toBeGreaterThanOrEqual(80);
      expect(profile.startingBalance).toBeLessThanOrEqual(160);
      expect(profile.compensation.amount).toBeGreaterThanOrEqual(8);
      expect(profile.compensation.amount).toBeLessThanOrEqual(16);
      expect(profile.compensation.cashCapped).toBe(true);
      expect(profile.workOutput.quantity).toBeGreaterThan(0);
      expect(Number.isFinite(profile.workOutput.quantity)).toBe(true);
      expect(profile.workOutput.quantity).toBeLessThanOrEqual(5);

      const institution = institutions.find((entry) => entry.id === profile.institutionId);
      expect(institution).toBeDefined();
      if (profile.workOutput.kind === 'stock') {
        expect(institution?.goods).toContain(profile.workOutput.item);
      } else {
        expect(serviceIds).toContain(profile.workOutput.serviceId);
        expect(institution?.serviceIds).toContain(profile.workOutput.serviceId);
      }
      expect(['employee', 'self-employed']).toContain(profile.employment);
    }
  });

  test('雇员领取工资，自营者只做现金受限的支取或合作分成', () => {
    for (const profile of residentEconomyProfiles) {
      if (profile.employment === 'employee') {
        expect(profile.compensation.kind).toBe('wage');
      } else {
        expect(['owner-draw', 'contract-share']).toContain(profile.compensation.kind);
      }
    }

    const guChao = residentEconomyProfiles.find((profile) => profile.id === 'gu-chao');
    expect(guChao?.compensation.kind).toBe('contract-share');
    expect(guChao?.workplaceNote).toMatch(/共享工位.*独立接单.*不是.*雇员/u);
  });

  test('服务定义使用独立计数目标，不冒充商品库存', () => {
    expect(new Set(services.map((service) => service.id)).size).toBe(services.length);
    expect(services.every((service) => service.counterName.endsWith('完成次数'))).toBe(true);
    expect(residentEconomyProfiles.some((profile) => profile.workOutput.kind === 'service')).toBe(
      true,
    );
    expect(
      residentEconomyProfiles
        .filter((profile) => profile.workOutput.kind === 'service')
        .every((profile) => !('item' in profile.workOutput)),
    ).toBe(true);
  });

  test('职业与机构保持江南小镇日常语境而非谜题工作', () => {
    expect(JSON.stringify({ institutions, residentEconomyProfiles })).not.toMatch(
      /海潮|航标|夜航|异常|谜团|线索/u,
    );
    expect(residentEconomyProfiles.map((entry) => entry.occupation)).toEqual([
      '历史高塔守望人',
      '书院先生',
      '茶庄主人',
      '内河摆渡人',
      '机关匠人',
      '药庐医师',
      '灯笼匠人',
      '集市跑腿兼船手',
      '卦馆卜算师',
    ]);
  });
});
