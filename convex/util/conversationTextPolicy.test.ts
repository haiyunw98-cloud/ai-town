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
  ])('does not classify ordinary archival work as a legacy story: %s', (text) => {
    expect(containsLegacyStory(text)).toBe(false);
  });

  test('shares archived event matching and preserves ordinary clauses', () => {
    expect(containsArchivedEventMemory('往届百万金贝寻宝比赛')).toBe(true);
    expect(filterLegacyExperimentClauses(
      '今天一起核对订单。随后聊起灯塔谜团与异常闪光。然后完成结算。',
    )).toBe('今天一起核对订单。然后完成结算。');
  });
});
