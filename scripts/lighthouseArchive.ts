import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
export const ARCHIVE_FORMAT_VERSION = 1;

type TimedText = { createdAt: number; text: string };
type DailyLifeEvent = TimedText & {
  residentId: string;
  displayName: string;
  kind: string;
};
type DailyMessage = TimedText & {
  messageId: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  observerIntervention: boolean;
};
type EconomyEntry = TimedText & {
  idempotencyKey: string;
  residentName?: string;
  institutionName?: string;
  kind: string;
  amount: number;
  sourceKey: string;
};
type RelationshipEntry = TimedText & {
  idempotencyKey: string;
  residentAName: string;
  residentBName: string;
  kind: string;
  friendshipDelta: number;
  trustDelta: number;
  attractionDelta: number;
  businessDelta: number;
  sourceKey: string;
};
type InstitutionState = {
  institutionId: string;
  institutionName: string;
  cash: number;
  todayIncome: number;
  todayExpense: number;
  visitorCount: number;
  dayKey: string;
  updatedAt: number;
};
type EventSnapshot = {
  dailyKey?: string;
  name?: string;
  status?: string;
  phase?: string;
  venueMode?: string;
  winnerName?: string;
  prize?: string;
  archiveReason?: string;
};
type EventLog = TimedText & { eventKey?: string; kind?: string; sequence?: number };

export type ObserverSnapshot = {
  dailyLifeEvents: DailyLifeEvent[];
  dailyMessages: DailyMessage[];
  dailyEconomyLedger: EconomyEntry[];
  dailyRelationshipChanges: RelationshipEntry[];
  institutionStates: InstitutionState[];
  event: EventSnapshot | null;
  logs: EventLog[];
  participants: Array<Record<string, unknown>>;
  snapshotTruncation?: Record<string, { truncated?: boolean; omittedAtLeast?: number }>;
};

export type DayArchive = {
  worldId: string;
  dayKey: string;
  generatedAt: number;
  snapshot: ObserverSnapshot;
};

export function shanghaiDayKey(timestamp: number) {
  assertTimestamp(timestamp);
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function previousShanghaiDayKey(dayKey: string) {
  assertDayKey(dayKey);
  const timestamp = Date.parse(`${dayKey}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function filterObserverSnapshotForDay(
  snapshot: ObserverSnapshot,
  dayKey: string,
): ObserverSnapshot {
  assertDayKey(dayKey);
  const onDay = <T extends TimedText>(rows: T[]) =>
    rows.filter((row) => shanghaiDayKey(row.createdAt) === dayKey)
      .sort((left, right) => left.createdAt - right.createdAt);
  const event = snapshot.event?.dailyKey === dayKey ? snapshot.event : null;
  return {
    dailyLifeEvents: onDay(snapshot.dailyLifeEvents ?? []),
    dailyMessages: onDay(snapshot.dailyMessages ?? []),
    dailyEconomyLedger: onDay(snapshot.dailyEconomyLedger ?? []),
    dailyRelationshipChanges: onDay(snapshot.dailyRelationshipChanges ?? []),
    institutionStates: (snapshot.institutionStates ?? [])
      .filter((row) => row.dayKey === dayKey)
      .sort((left, right) => left.institutionName.localeCompare(right.institutionName, 'zh-CN')),
    event,
    logs: event ? onDay(snapshot.logs ?? []) : [],
    participants: event ? (snapshot.participants ?? []) : [],
    snapshotTruncation: snapshot.snapshotTruncation ?? {},
  };
}

export function buildArchiveFiles(archive: DayArchive) {
  assertDayKey(archive.dayKey);
  const filtered = filterObserverSnapshotForDay(archive.snapshot, archive.dayKey);
  const factual = renderFactualLedger({ ...archive, snapshot: filtered });
  const social = renderSocialObservationMaterial({ ...archive, snapshot: filtered });
  const raw = `${JSON.stringify({
    formatVersion: ARCHIVE_FORMAT_VERSION,
    worldId: archive.worldId,
    dayKey: archive.dayKey,
    generatedAt: archive.generatedAt,
    snapshot: filtered,
  }, null, 2)}\n`;
  const contentFiles = {
    '事实流水账.md': factual,
    '社会观察素材.md': social,
    '原始数据.json': raw,
  };
  const manifest = {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    worldId: archive.worldId,
    dayKey: archive.dayKey,
    generatedAt: archive.generatedAt,
    generatedAtIso: new Date(archive.generatedAt).toISOString(),
    records: {
      lifeEvents: filtered.dailyLifeEvents.length,
      messages: filtered.dailyMessages.length,
      economy: filtered.dailyEconomyLedger.length,
      relationships: filtered.dailyRelationshipChanges.length,
      institutions: filtered.institutionStates.length,
      eventLogs: filtered.logs.length,
    },
    truncated: Object.fromEntries(
      Object.entries(filtered.snapshotTruncation ?? {})
        .filter(([, value]) => value.truncated)
        .map(([key, value]) => [key, value.omittedAtLeast ?? 1]),
    ),
    files: Object.fromEntries(
      Object.entries(contentFiles).map(([name, content]) => [name, sha256(content)]),
    ),
  };
  return {
    ...contentFiles,
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

export async function writeArchiveDay(root: string, archive: DayArchive) {
  assertDedicatedArchiveRoot(root);
  const dayDirectory = join(resolve(root), archive.dayKey);
  await mkdir(dayDirectory, { recursive: true });
  const files = buildArchiveFiles(archive);
  for (const [name, content] of Object.entries(files)) {
    await atomicWrite(join(dayDirectory, name), content);
  }
  return { dayDirectory, files: Object.keys(files) };
}

export function assertDedicatedArchiveRoot(root: string) {
  const normalized = resolve(root);
  const segments = normalized.toLowerCase().split(sep);
  if (
    basename(normalized) !== 'IMA导入'
    || !normalized.includes(`${sep}灯塔镇研究档案${sep}`)
    || segments.includes('.obsidian')
    || segments.includes('obsidian')
  ) {
    throw new Error('Archive root must be the dedicated 灯塔镇研究档案/IMA导入 directory');
  }
  return normalized;
}

function renderFactualLedger(archive: DayArchive) {
  const { snapshot } = archive;
  const lines = [
    `# 灯塔镇事实流水账 · ${archive.dayKey}`,
    '',
    `- 世界：\`${archive.worldId}\``,
    `- 生成时间：${formatShanghai(archive.generatedAt)}`,
    '- 说明：仅整理数据库中的结构化事实和原始消息；后台规则事实不冒充居民对话。',
    '',
    '## 居民生活事实',
    '',
    ...orEmpty(snapshot.dailyLifeEvents.map((entry) =>
      `- ${formatShanghai(entry.createdAt)}｜${entry.displayName}｜${entry.kind}｜${entry.text}`)),
    '',
    '## 经济流水',
    '',
    ...orEmpty(snapshot.dailyEconomyLedger.map((entry) =>
      `- ${formatShanghai(entry.createdAt)}｜${entry.residentName ?? '公共机构'}｜${entry.institutionName ?? '全镇'}｜${entry.kind}｜${entry.text}｜键：\`${entry.idempotencyKey}\``)),
    '',
    '## 关系变化',
    '',
    ...orEmpty(snapshot.dailyRelationshipChanges.map((entry) =>
      `- ${formatShanghai(entry.createdAt)}｜${entry.residentAName} × ${entry.residentBName}｜${entry.kind}｜友情 ${signed(entry.friendshipDelta)}／信任 ${signed(entry.trustDelta)}／恋爱吸引 ${signed(entry.attractionDelta)}／商业 ${signed(entry.businessDelta)}｜${entry.text}｜键：\`${entry.idempotencyKey}\``)),
    '',
    '## 原始对话',
    '',
    ...orEmpty(snapshot.dailyMessages.map((entry) =>
      `- ${formatShanghai(entry.createdAt)}｜${entry.authorName}${entry.observerIntervention ? '（观察者）' : ''}｜会话 \`${entry.conversationId}\`｜${entry.text}`)),
    '',
    '## 每日活动',
    '',
    ...(snapshot.event
      ? [
          `- 活动：${snapshot.event.name ?? '未命名活动'}`,
          `- 状态：${snapshot.event.status ?? '未知'}／阶段：${snapshot.event.phase ?? '未知'}／场地：${snapshot.event.venueMode ?? '未知'}`,
          `- 奖励：${snapshot.event.prize ?? '无记录'}`,
          `- 归档原因：${snapshot.event.archiveReason ?? '未归档'}`,
          ...snapshot.logs.map((entry) =>
            `- ${formatShanghai(entry.createdAt)}｜${entry.kind ?? 'event'}｜${entry.text}`),
        ]
      : ['- 当日没有活动记录。']),
    '',
    '## 机构日终快照',
    '',
    ...orEmpty(snapshot.institutionStates.map((entry) =>
      `- ${entry.institutionName}｜现金 ${entry.cash}｜收入 ${entry.todayIncome}｜支出 ${entry.todayExpense}｜访客 ${entry.visitorCount}`)),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderSocialObservationMaterial(archive: DayArchive) {
  const { snapshot } = archive;
  const residentCounts = new Map<string, number>();
  for (const entry of snapshot.dailyLifeEvents) {
    residentCounts.set(entry.displayName, (residentCounts.get(entry.displayName) ?? 0) + 1);
  }
  for (const entry of snapshot.dailyMessages) {
    if (!entry.observerIntervention) {
      residentCounts.set(entry.authorName, (residentCounts.get(entry.authorName) ?? 0) + 1);
    }
  }
  const income = snapshot.dailyEconomyLedger
    .filter((entry) => entry.kind === 'work' || entry.kind === 'event-reward')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const consumption = snapshot.dailyEconomyLedger
    .filter((entry) => entry.kind === 'purchase')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const lines = [
    `# 灯塔镇社会观察素材 · ${archive.dayKey}`,
    '',
    '> 本文件是自动统计与研究索引，不作因果推断。论文分析应回到同日事实流水账和原始数据复核。',
    '',
    '## 社会运行概览',
    '',
    `- 生活事实：${snapshot.dailyLifeEvents.length} 条`,
    `- 原始消息：${snapshot.dailyMessages.length} 条，其中观察者介入 ${snapshot.dailyMessages.filter((entry) => entry.observerIntervention).length} 条`,
    `- 经济流水：${snapshot.dailyEconomyLedger.length} 条；劳动与活动收入 ${income} 金贝；消费 ${consumption} 金贝`,
    `- 关系变化：${snapshot.dailyRelationshipChanges.length} 条`,
    `- 有状态快照的机构：${snapshot.institutionStates.length} 个`,
    '',
    '## 居民可观察度',
    '',
    ...orEmpty([...residentCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
      .map(([name, count]) => `- ${name}：${count} 条可追溯记录`)),
    '',
    '## 关系网络变化索引',
    '',
    ...orEmpty(snapshot.dailyRelationshipChanges.map((entry) =>
      `- ${entry.residentAName} × ${entry.residentBName}：${entry.kind}；友情 ${signed(entry.friendshipDelta)}，信任 ${signed(entry.trustDelta)}，吸引 ${signed(entry.attractionDelta)}，商业 ${signed(entry.businessDelta)}`)),
    '',
    '## 机构运行索引',
    '',
    ...orEmpty(snapshot.institutionStates.map((entry) =>
      `- ${entry.institutionName}：现金 ${entry.cash}，当日净流量 ${signed(entry.todayIncome - entry.todayExpense)}，访客 ${entry.visitorCount}`)),
    '',
    '## 每日活动重点',
    '',
    ...(snapshot.event
      ? [
          `- ${snapshot.event.name ?? '未命名活动'}：${snapshot.event.status ?? '未知'}，阶段 ${snapshot.event.phase ?? '未知'}，归档原因 ${snapshot.event.archiveReason ?? '无'}。`,
          `- 活动日志 ${snapshot.logs.length} 条，参赛者记录 ${snapshot.participants.length} 人。`,
        ]
      : ['- 当日没有可归属到本日的活动。']),
    '',
    '## 后续人工分析提示',
    '',
    '- 比较居民记录密度差异，判断是否存在观察偏差或角色活跃度差异。',
    '- 对照经济流水与机构快照，检查资金转移、库存和经营行为是否一致。',
    '- 对照关系变化的来源键与原始互动，避免把规则性接触误判为情感因果。',
    '- 每日活动单独分析组队、淘汰、奖励、观赛和返程对后续关系及财富的影响。',
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(path: string, content: string) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

function formatShanghai(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function orEmpty(lines: string[]) {
  return lines.length > 0 ? lines : ['- 无记录。'];
}

function sha256(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

function assertDayKey(dayKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dayKey)) throw new Error('Invalid Shanghai day key');
}

function assertTimestamp(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp < 0 || Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error('Invalid timestamp');
  }
}
