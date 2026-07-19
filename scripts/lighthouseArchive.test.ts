import {
  assertDedicatedArchiveRoot,
  buildArchiveFiles,
  filterObserverSnapshotForDay,
  previousShanghaiDayKey,
  shanghaiDayKey,
  type ObserverSnapshot,
} from './lighthouseArchive';

const dayKey = '2026-07-20';
const onDay = Date.parse('2026-07-20T01:00:00+08:00');
const previousDay = Date.parse('2026-07-19T23:59:59+08:00');

function snapshot(): ObserverSnapshot {
  return {
    dailyLifeEvents: [
      { residentId: 'p:1', displayName: '林澜', kind: 'work', text: '正常工作', createdAt: onDay },
      { residentId: 'p:1', displayName: '林澜', kind: 'old', text: '旧记录', createdAt: previousDay },
    ],
    dailyMessages: [{
      messageId: 'm:1', conversationId: 'c:1', authorId: 'p:1', authorName: '林澜',
      text: '今天吃什么？', observerIntervention: false, createdAt: onDay,
    }],
    dailyEconomyLedger: [{
      idempotencyKey: 'work:1', residentName: '林澜', institutionName: '镇公所',
      kind: 'work', amount: 12, sourceKey: 'work:1', text: '获得 12 金贝', createdAt: onDay,
    }],
    dailyRelationshipChanges: [{
      idempotencyKey: 'relation:1', residentAName: '林澜', residentBName: '沈砚',
      kind: 'cooperation', friendshipDelta: 1, trustDelta: 1,
      attractionDelta: 0, businessDelta: 0, sourceKey: 'relation:1',
      text: '处理普通事务', createdAt: onDay,
    }],
    institutionStates: [{
      institutionId: 'town-office', institutionName: '镇公所', cash: 100,
      todayIncome: 0, todayExpense: 12, visitorCount: 1, dayKey, updatedAt: onDay,
    }],
    event: { dailyKey: dayKey, name: '全镇任务接力', status: 'completed', phase: 'awards' },
    logs: [{ text: '安全完成', kind: 'return', createdAt: onDay }],
    participants: [{ residentId: 'p:1' }],
    snapshotTruncation: {},
  };
}

describe('Lighthouse IMA archive', () => {
  test('uses Shanghai calendar boundaries and previous-day selection', () => {
    expect(shanghaiDayKey(Date.parse('2026-07-19T16:00:00Z'))).toBe(dayKey);
    expect(previousShanghaiDayKey(dayKey)).toBe('2026-07-19');
  });

  test('filters every timed fact to the requested day', () => {
    const filtered = filterObserverSnapshotForDay(snapshot(), dayKey);
    expect(filtered.dailyLifeEvents).toHaveLength(1);
    expect(filtered.dailyLifeEvents[0].text).toBe('正常工作');
    expect(filtered.event?.dailyKey).toBe(dayKey);
  });

  test('builds factual, observation, raw and manifest files with audit hashes', () => {
    const files = buildArchiveFiles({
      worldId: 'world:test', dayKey, generatedAt: onDay, snapshot: snapshot(),
    });
    expect(Object.keys(files).sort()).toEqual([
      'manifest.json', '事实流水账.md', '原始数据.json', '社会观察素材.md',
    ].sort());
    expect(files['事实流水账.md']).toContain('今天吃什么？');
    expect(files['事实流水账.md']).not.toContain('旧记录');
    expect(files['社会观察素材.md']).toContain('不作因果推断');
    expect(JSON.parse(files['manifest.json'])).toMatchObject({
      formatVersion: 1,
      worldId: 'world:test',
      dayKey,
      records: { lifeEvents: 1, messages: 1, economy: 1, relationships: 1 },
    });
  });

  test('accepts only a dedicated IMA directory and rejects Obsidian paths', () => {
    expect(assertDedicatedArchiveRoot('/tmp/灯塔镇研究档案/IMA导入')).toContain('IMA导入');
    expect(() => assertDedicatedArchiveRoot('/tmp/Obsidian/灯塔镇研究档案/IMA导入'))
      .toThrow(/dedicated/u);
    expect(() => assertDedicatedArchiveRoot('/tmp/灯塔镇研究档案'))
      .toThrow(/dedicated/u);
  });
});
