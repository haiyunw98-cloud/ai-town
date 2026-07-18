import {
  containsArchivedEventMemory,
  containsLegacyStory,
  filterLegacyExperimentClauses,
} from './conversationTextPolicy';

describe('neutral conversation text policy', () => {
  test.each([
    '灯塔谜团与异常闪光再次出现。',
    '灯火装置连接了河道线索与花木线索。',
    'An anomaly appeared during navigation at sea.',
  ])('identifies actual scripted legacy content: %s', (text) => {
    expect(containsLegacyStory(text)).toBe(true);
  });

  test.each([
    '整理普通历史记录并完成归档。',
    '把旧档案入库后继续工作。',
    '今天在社区整理普通记录。',
    '这道数学谜题已经解答。',
    'The account anomaly was corrected.',
    'A model anomaly was resolved.',
    '今天举行社区寻宝比赛。',
    'The community treasure hunt starts today.',
  ])('does not classify ordinary archival work as a legacy story: %s', (text) => {
    expect(containsLegacyStory(text)).toBe(false);
  });

  test.each([
    '灯塔机关谜题仍未解开。',
    '小镇发生了异变。',
    '灯塔周围出现异常闪光。',
    'An anomaly interrupted navigation at sea.',
  ])('classifies contextual legacy content: %s', (text) => {
    expect(containsLegacyStory(text)).toBe(true);
  });

  test('shares archived event matching and preserves ordinary clauses', () => {
    expect(containsArchivedEventMemory('往届百万金贝寻宝比赛')).toBe(true);
    expect(containsArchivedEventMemory('已经结束的社区寻宝比赛')).toBe(true);
    expect(containsArchivedEventMemory('已经完成的社区寻宝比赛')).toBe(true);
    expect(containsArchivedEventMemory('The previous community treasure hunt')).toBe(true);
    expect(containsArchivedEventMemory('The finished community treasure hunt')).toBe(true);
    expect(containsArchivedEventMemory('今天举行社区寻宝比赛')).toBe(false);
    expect(containsArchivedEventMemory('The community treasure hunt starts today')).toBe(false);
    expect(filterLegacyExperimentClauses(
      '今天一起核对订单。随后聊起灯塔谜团与异常闪光。然后完成结算。',
    )).toBe('今天一起核对订单。然后完成结算。');
    expect(filterLegacyExperimentClauses(
      '这道数学谜题已经解答。The account anomaly was corrected. 今天举行社区寻宝比赛。',
    )).toBe('这道数学谜题已经解答。The account anomaly was corrected。今天举行社区寻宝比赛。');
  });
});
