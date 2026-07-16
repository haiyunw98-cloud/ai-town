import type { Locale } from '../i18n';
import {
  buildDailyReport,
  resolveSocialNarrative,
  shanghaiDayKey,
  type BroadcastSnapshot,
} from './eventBroadcastView';
import {
  buildSocialObservationDigest,
  buildSocialObservationFacts,
  buildSocialObservationReport,
} from './socialObservationReport';

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
type GenerateSocialObservation = (args: { digest: string }) => Promise<unknown>;
type PendingLock = { current: boolean };

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

export async function exportSocialReport(
  lock: PendingLock,
  options: {
    snapshot: BroadcastSnapshot;
    locale: Locale;
    exportNow: number;
    generate: GenerateSocialObservation;
    download?: Download;
    setPending?: (pending: boolean) => void;
  },
) {
  if (lock.current) return false;
  lock.current = true;
  try {
    options.setPending?.(true);
    const facts = buildSocialObservationFacts(options.snapshot, options.locale, options.exportNow);
    const result = await resolveSocialNarrative(() =>
      options.generate({ digest: buildSocialObservationDigest(facts) }),
    );
    const prepared = {
      body: buildSocialObservationReport(facts, result),
      filename: `灯塔镇社会观察日志-${shanghaiDayKey(options.exportNow)}.md`,
    };
    (options.download ?? downloadMarkdown)(prepared.body, prepared.filename);
    return true;
  } finally {
    lock.current = false;
    options.setPending?.(false);
  }
}
