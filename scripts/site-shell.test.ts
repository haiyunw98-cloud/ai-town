import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve('index.html'), 'utf8');

describe('Lighthouse Town document metadata', () => {
  test('publishes one Chinese description without an external analytics script', () => {
    expect(html).toMatch(/<html\s+lang="zh-CN">/u);
    expect(html.match(/<meta\s+name="description"/gu)).toHaveLength(1);
    expect(html).toContain('灯塔镇：九位本地 AI 居民生活、工作、交往并留下研究记录的江南社会模拟。');
    expect(html).not.toMatch(/plausible\.io|google-analytics|googletagmanager/iu);
  });
});
