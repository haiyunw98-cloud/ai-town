import { jest } from '@jest/globals';
import type { BroadcastSnapshot } from './eventBroadcastView';
import { buildReportActionsView, getSocialReportExportStore } from './reportExportController';

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

function deferredGeneration() {
  let resolve!: (value: unknown) => void;
  return {
    generate: jest.fn(
      () =>
        new Promise<unknown>((done) => {
          resolve = done;
        }),
    ),
    resolve: (value: unknown) => resolve(value),
  };
}

describe('persistent social report export store', () => {
  test('keeps one task and pending snapshot across unsubscribe and remount', async () => {
    const request = deferredGeneration();
    const download = jest.fn();
    const initialStore = getSocialReportExportStore('world:remount');
    const initialSnapshots: boolean[] = [];
    const unsubscribeInitial = initialStore.subscribe(() => {
      initialSnapshots.push(initialStore.getSnapshot());
    });

    const firstRun = initialStore.run({
      snapshot,
      locale: 'zh-CN',
      exportNow,
      generate: request.generate,
      download,
    });
    expect(initialStore.getSnapshot()).toBe(true);
    expect(initialSnapshots).toEqual([true]);
    unsubscribeInitial();

    const remountedStore = getSocialReportExportStore('world:remount');
    const remountedSnapshots: boolean[] = [];
    const unsubscribeRemounted = remountedStore.subscribe(() => {
      remountedSnapshots.push(remountedStore.getSnapshot());
    });
    expect(remountedStore).toBe(initialStore);
    expect(remountedStore.getSnapshot()).toBe(true);

    await expect(
      remountedStore.run({
        snapshot,
        locale: 'zh-CN',
        exportNow,
        generate: request.generate,
        download,
      }),
    ).resolves.toBe(false);
    expect(request.generate).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();

    request.resolve({ source: 'fallback', narrative: '' });
    await expect(firstRun).resolves.toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(remountedSnapshots).toEqual([false]);
    expect(remountedStore.getSnapshot()).toBe(false);
    unsubscribeRemounted();
  });

  test('isolates pending tasks by world id', async () => {
    const worldARequest = deferredGeneration();
    const worldADownload = jest.fn();
    const worldBDownload = jest.fn();
    const worldA = getSocialReportExportStore('world:a');
    const worldB = getSocialReportExportStore('world:b');

    const worldARun = worldA.run({
      snapshot,
      locale: 'zh-CN',
      exportNow,
      generate: worldARequest.generate,
      download: worldADownload,
    });
    expect(worldA.getSnapshot()).toBe(true);
    expect(worldB.getSnapshot()).toBe(false);

    await expect(
      worldB.run({
        snapshot,
        locale: 'zh-CN',
        exportNow,
        generate: () => Promise.resolve({ source: 'fallback', narrative: '' }),
        download: worldBDownload,
      }),
    ).resolves.toBe(true);
    expect(worldBDownload).toHaveBeenCalledTimes(1);
    expect(worldA.getSnapshot()).toBe(true);

    worldARequest.resolve({ source: 'fallback', narrative: '' });
    await expect(worldARun).resolves.toBe(true);
    expect(worldADownload).toHaveBeenCalledTimes(1);
  });

  test('adapts pending state to the exact two-button view and live status', () => {
    expect(buildReportActionsView(false)).toEqual({
      factualLabel: '导出事实流水账',
      factualDisabled: false,
      socialLabel: '生成社会观察日志',
      socialDisabled: false,
      socialBusy: false,
      liveStatus: '',
    });
    expect(buildReportActionsView(true)).toEqual({
      factualLabel: '导出事实流水账',
      factualDisabled: false,
      socialLabel: '正在整理社会观察',
      socialDisabled: true,
      socialBusy: true,
      liveStatus: '正在整理社会观察',
    });
  });
});
