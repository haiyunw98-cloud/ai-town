import { readFileSync } from 'node:fs';
import { institutionStatusBanner } from './runtimeViewState';

describe('InstitutionDetails', () => {
  const source = readFileSync(new URL('./InstitutionDetails.tsx', import.meta.url), 'utf8');

  test('shows purpose, actual services, live inventory and counters, flows, visitors and facts', () => {
    expect(source).toContain('api.townEconomy.institutionDetails');
    for (const label of [
      '用途介绍', '可使用服务', '商品与库存', '服务完成量', '机构现金',
      '今日收入', '今日支出', '今日客流', '最近经济事实',
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('库存 0');
    expect(source).toContain('完成 0 次');
  });

  test('has localized loading and empty runtime states and an accessible close action', () => {
    expect(source).toContain('正在读取机构运行账本');
    expect(source).toContain('还没有已结算的机构事实');
    expect(source).toContain('aria-label={`关闭${landmark.name}详情`}');
  });

  test('labels paused snapshots and unavailable world boundaries', () => {
    expect(source).toContain('institutionStatusBanner(details)');
    expect(source).toContain('statusBanner');
    expect(source).toContain("details.institutionStatus === 'unavailable'");
  });

  test('derives paused and unavailable institution banners from real view state', () => {
    const banner = institutionStatusBanner;
    expect(banner({ institutionStatus: 'available', snapshotStatus: 'paused', runtimeStatus: 'snapshot' }))
      .toBe('已暂停，以下为暂停前账本；机构不会继续推进。');
    expect(banner({ institutionStatus: 'unavailable', snapshotStatus: 'unavailable' }))
      .toBe('这处机构不属于当前可用的小镇运行世界，无法读取其账本。');
    expect(banner({ institutionStatus: 'available', snapshotStatus: 'current', runtimeStatus: 'initializing' }))
      .toBe('机构运行态正在初始化；用途与服务来自小镇定义，账目数值暂不估算。');
    expect(banner({ institutionStatus: 'available', snapshotStatus: 'current', runtimeStatus: 'live' }))
      .toBeNull();
  });
});
