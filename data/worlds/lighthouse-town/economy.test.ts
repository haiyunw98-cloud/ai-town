import { lighthouseCharacters } from './characters';
import { goods, institutions, residentEconomyProfiles } from './economy';
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

  test('居民工资、余额和产出均为明确且有界的可结算数据', () => {
    for (const profile of residentEconomyProfiles) {
      expect(profile.startingBalance).toBeGreaterThanOrEqual(80);
      expect(profile.startingBalance).toBeLessThanOrEqual(160);
      expect(profile.workPay).toBeGreaterThanOrEqual(8);
      expect(profile.workPay).toBeLessThanOrEqual(16);
      expect(profile.workOutput.quantity).toBeGreaterThan(0);
      expect(['meal', 'tea', 'medicine', 'daily-goods', 'craft-service', 'service']).toContain(
        profile.workOutput.item,
      );
      expect(institutions.some((institution) => institution.id === profile.institutionId)).toBe(true);
      expect(['employee', 'self-employed']).toContain(profile.employment);
    }
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
