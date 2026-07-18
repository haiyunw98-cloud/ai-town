import type { Locale } from '../i18n';
import {
  buildDailyReport,
  resolveSocialNarrative,
  shanghaiDayKey,
  type BroadcastSnapshot,
} from './eventBroadcastView';
import {
  buildSocialObservationFacts,
  buildSocialObservationReport,
} from './socialObservationReport';
import { buildSocialEvidence } from './socialEvidence';

type MarkdownAnchor = {
  href: string;
  download: string;
  click: () => void;
  remove: () => void;
};

export type MarkdownDownloadEnvironment = {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  createAnchor: () => MarkdownAnchor;
  appendAnchor: (anchor: MarkdownAnchor) => void;
};

export type PreparedReport = {
  body: string;
  filename: string;
};

type Download = (body: string, filename: string) => void;
type GenerateSocialObservation = (args: { evidenceJson: string }) => Promise<unknown>;
const MAX_EVIDENCE_JSON_CHARACTERS = 20_000;

export type SocialReportExportOptions = {
  snapshot: BroadcastSnapshot;
  locale: Locale;
  exportNow: number;
  generate: GenerateSocialObservation;
  download?: Download;
};

export type SocialReportExportStore = {
  getSnapshot: () => boolean;
  subscribe: (listener: () => void) => () => void;
  run: (options: SocialReportExportOptions) => Promise<boolean>;
};

const socialReportExportStores = new Map<string, SocialReportExportStore>();

function browserDownloadEnvironment(): MarkdownDownloadEnvironment {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement('a'),
    appendAnchor: (anchor) => document.body.append(anchor as HTMLAnchorElement),
  };
}

export function downloadMarkdown(
  body: string,
  filename: string,
  environment = browserDownloadEnvironment(),
) {
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const anchor = environment.createAnchor();
  const url = environment.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = filename;
    environment.appendAnchor(anchor);
    anchor.click();
  } finally {
    try {
      anchor.remove();
    } finally {
      environment.revokeObjectURL(url);
    }
  }
}

export function exportFactualReport(options: {
  snapshot: BroadcastSnapshot;
  locale: Locale;
  exportNow: number;
  download?: Download;
}): PreparedReport {
  const prepared = {
    body: buildDailyReport(options.snapshot, options.locale, options.exportNow),
    filename: `灯塔镇事实流水账-${shanghaiDayKey(options.exportNow)}.md`,
  };
  (options.download ?? downloadMarkdown)(prepared.body, prepared.filename);
  return prepared;
}

async function performSocialReportExport(options: SocialReportExportOptions) {
  const facts = buildSocialObservationFacts(options.snapshot, options.locale, options.exportNow);
  const evidenceBundle = buildSocialEvidence(options.snapshot, options.exportNow);
  const result = await resolveSocialNarrative(() =>
    options.generate({ evidenceJson: serializeBoundedEvidence(evidenceBundle) }),
  );
  const prepared = {
    body: buildSocialObservationReport(facts, result),
    filename: `灯塔镇社会观察日志-${shanghaiDayKey(options.exportNow)}.md`,
  };
  (options.download ?? downloadMarkdown)(prepared.body, prepared.filename);
}

function serializeBoundedEvidence(bundle: ReturnType<typeof buildSocialEvidence>) {
  const normalized = {
    ...bundle,
    evidence: bundle.evidence.map((entry) => ({
      ...entry,
      sourceKeys: entry.sourceKeys
        .slice(0, 40)
        .map((sourceKey) => truncateCharacters(sourceKey, 300)),
    })),
  };
  const serialized = JSON.stringify(normalized);
  if (countCharacters(serialized) <= MAX_EVIDENCE_JSON_CHARACTERS) return serialized;

  const compact = {
    ...normalized,
    evidence: normalized.evidence.map((entry) => ({
      ...entry,
      sourceKeys: entry.sourceKeys
        .slice(0, 8)
        .map((sourceKey) => truncateCharacters(sourceKey, 160)),
    })),
  };
  return JSON.stringify(compact);
}

function truncateCharacters(value: string, limit: number) {
  return Array.from(value).slice(0, limit).join('');
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

export function createSocialReportExportStore(onIdle?: () => void): SocialReportExportStore {
  let pending = false;
  let running = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const finishIfIdle = () => {
    if (running || listeners.size > 0) return;
    queueMicrotask(() => {
      if (!running && listeners.size === 0) onIdle?.();
    });
  };
  const store: SocialReportExportStore = {
    getSnapshot: () => pending,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        finishIfIdle();
      };
    },
    run: (options) => {
      if (running) return Promise.resolve(false);
      running = true;
      pending = true;
      notify();
      return performSocialReportExport(options)
        .then(() => true)
        .finally(() => {
          running = false;
          pending = false;
          notify();
          finishIfIdle();
        });
    },
  };
  return store;
}

export function getSocialReportExportStore(worldId: string) {
  const existing = socialReportExportStores.get(worldId);
  if (existing) return existing;
  const store = createSocialReportExportStore(() => {
    if (socialReportExportStores.get(worldId) === store) {
      socialReportExportStores.delete(worldId);
    }
  });
  socialReportExportStores.set(worldId, store);
  return store;
}

export function buildReportActionsView(pending: boolean) {
  return {
    factualLabel: '导出事实流水账',
    factualDisabled: false,
    socialLabel: pending ? '正在整理社会观察' : '生成社会观察日志',
    socialDisabled: pending,
    socialBusy: pending,
    liveStatus: pending ? '正在整理社会观察' : '',
  };
}
