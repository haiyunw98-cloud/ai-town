import { jest } from '@jest/globals';
import { buildDailyReport, type BroadcastSnapshot } from './eventBroadcastView';
import { buildSocialEvidence } from './socialEvidence';
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

  test('sends one same-snapshot evidence bundle and temporarily renders structured output as fallback', async () => {
    const generate = jest.fn((_args: { evidenceJson: string }) =>
      Promise.resolve({
        source: 'model' as const,
        findings: buildSocialEvidence(snapshot, exportNow).ruleFindings,
        limitations: buildSocialEvidence(snapshot, exportNow).limitations,
        followUps: buildSocialEvidence(snapshot, exportNow).followUps,
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
    expect(generate.mock.calls[0][0]).toEqual({
      evidenceJson: JSON.stringify(buildSocialEvidence(snapshot, exportNow)),
    });
    expect(generate.mock.calls[0][0]).not.toHaveProperty('digest');
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining('本次未使用模型扩写'),
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

  test('keeps a hostile high-volume evidence request bounded and valid JSON', async () => {
    const largeSnapshot: BroadcastSnapshot = {
      ...snapshot,
      residentActivity: [
        { residentId: 'resident:a', displayName: '甲', status: '', detail: '' },
        { residentId: 'resident:b', displayName: '乙', status: '', detail: '' },
      ],
      dailyMessages: Array.from({ length: 500 }, (_, index) => ({
        messageId: `${String(index)}:${'x'.repeat(300)}`,
        conversationId: 'conversation:large',
        authorId: index % 2 === 0 ? 'resident:a' : 'resident:b',
        authorName: index % 2 === 0 ? '甲' : '乙',
        text: '普通互动记录。',
        createdAt: exportNow + index,
        observerIntervention: false,
      })),
    };
    let sent = '';
    const generate = jest.fn(({ evidenceJson }: { evidenceJson: string }) => {
      sent = evidenceJson;
      return Promise.resolve({ source: 'fallback' });
    });

    await createSocialReportExportStore().run({
      snapshot: largeSnapshot,
      locale: 'zh-CN',
      exportNow,
      generate,
      download: jest.fn(),
    });

    expect(Array.from(sent).length).toBeLessThanOrEqual(20_000);
    const parsed = JSON.parse(sent) as ReturnType<typeof buildSocialEvidence>;
    expect(parsed.ruleFindings).toEqual(buildSocialEvidence(largeSnapshot, exportNow).ruleFindings);
    expect(parsed.evidence.every((entry) => entry.sourceKeys.length >= 1)).toBe(true);
    expect(parsed.evidence.every((entry) => entry.sourceKeys.length <= 8)).toBe(true);
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
