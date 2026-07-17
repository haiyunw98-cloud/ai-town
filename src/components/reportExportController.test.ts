import { jest } from '@jest/globals';
import { buildDailyReport, type BroadcastSnapshot } from './eventBroadcastView';
import {
  createSocialReportExportStore,
  downloadMarkdown,
  exportFactualReport,
  type MarkdownDownloadEnvironment,
} from './reportExportController';

const snapshot: BroadcastSnapshot = {
  event: null,
  participants: [],
  logs: [],
  conversations: [],
  residentActivity: [],
  dailyMessages: [],
  dailyLifeEvents: [],
};

const exportNow = Date.parse('2026-07-16T16:00:00Z');

describe('town report export controller', () => {
  test('exports the factual report with its exact Shanghai-day filename', () => {
    const download = jest.fn();

    const prepared = exportFactualReport({
      snapshot,
      locale: 'zh-CN',
      exportNow,
      download,
    });

    expect(prepared.filename).toBe('灯塔镇事实流水账-2026-07-17.md');
    expect(prepared.body).toBe(buildDailyReport(snapshot, 'zh-CN', exportNow));
    expect(download).toHaveBeenCalledWith(prepared.body, prepared.filename);
  });

  test('exports a valid local narrative through the complete social report chain', async () => {
    const generate = jest.fn((_args: { digest: string }) =>
      Promise.resolve({
        source: 'model' as const,
        narrative: '记录显示，居民合作仍需持续观察。',
      }),
    );
    const download = jest.fn();

    await expect(
      createSocialReportExportStore().run({
        snapshot,
        locale: 'zh-CN',
        exportNow,
        generate,
        download,
      }),
    ).resolves.toBe(true);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(typeof generate.mock.calls[0][0].digest).toBe('string');
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('记录显示，居民合作仍需持续观察。'),
      '灯塔镇社会观察日志-2026-07-17.md',
    );
  });

  test.each([
    ['a rejected action', () => Promise.reject(new Error('Ollama unavailable'))],
    ['an invalid action result', () => Promise.resolve({ source: 'model', narrative: 42 })],
  ])('downloads the deterministic social fallback for %s', async (_case, request) => {
    const generate = jest.fn(request);
    const download = jest.fn();

    await expect(
      createSocialReportExportStore().run({
        snapshot,
        locale: 'zh-CN',
        exportNow,
        generate,
        download,
      }),
    ).resolves.toBe(true);

    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('本次未使用模型扩写'),
      '灯塔镇社会观察日志-2026-07-17.md',
    );
  });

  test('creates, clicks, removes and revokes one Markdown download', async () => {
    let capturedBlob: Blob | undefined;
    const anchor = {
      href: '',
      download: '',
      click: jest.fn(),
      remove: jest.fn(),
    };
    const environment: MarkdownDownloadEnvironment = {
      createObjectURL: jest.fn((blob: Blob) => {
        capturedBlob = blob;
        return 'blob:town-report';
      }),
      revokeObjectURL: jest.fn(),
      createAnchor: jest.fn(() => anchor),
      appendAnchor: jest.fn(),
    };

    downloadMarkdown('日报正文', '灯塔镇日报.md', environment);

    expect(capturedBlob).toBeDefined();
    await expect(capturedBlob!.text()).resolves.toBe('日报正文');
    expect(anchor.href).toBe('blob:town-report');
    expect(anchor.download).toBe('灯塔镇日报.md');
    expect(environment.appendAnchor).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(environment.revokeObjectURL).toHaveBeenCalledWith('blob:town-report');
  });

  test('removes the anchor and revokes its URL when clicking throws', () => {
    const anchor = {
      href: '',
      download: '',
      click: jest.fn(() => {
        throw new Error('blocked download');
      }),
      remove: jest.fn(),
    };
    const environment: MarkdownDownloadEnvironment = {
      createObjectURL: jest.fn(() => 'blob:town-report'),
      revokeObjectURL: jest.fn(),
      createAnchor: jest.fn(() => anchor),
      appendAnchor: jest.fn(),
    };

    expect(() => downloadMarkdown('正文', '日报.md', environment)).toThrow('blocked download');
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(environment.revokeObjectURL).toHaveBeenCalledWith('blob:town-report');
  });

  test('ignores a synchronous duplicate while one social export is pending', async () => {
    let resolveGeneration!: (value: unknown) => void;
    const generate = jest.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    const download = jest.fn();
    const store = createSocialReportExportStore();
    const pendingSnapshots: boolean[] = [];
    const unsubscribe = store.subscribe(() => pendingSnapshots.push(store.getSnapshot()));
    const options = {
      snapshot,
      locale: 'zh-CN' as const,
      exportNow,
      generate,
      download,
    };

    const first = store.run(options);
    const duplicate = store.run(options);

    await expect(duplicate).resolves.toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
    resolveGeneration({ source: 'fallback', narrative: '' });
    await expect(first).resolves.toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(pendingSnapshots).toEqual([true, false]);
    expect(store.getSnapshot()).toBe(false);
    unsubscribe();
  });
});
