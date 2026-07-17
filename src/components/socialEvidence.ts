import { townLandmarks } from '../../data/worlds/lighthouse-town/map';
import { shanghaiDayKey, type BroadcastSnapshot } from './eventBroadcastView';

export type EvidenceCategory =
  | 'interaction-network'
  // Task 1's executable acceptance contract names the aggregate activity metric explicitly.
  | 'activity-distribution'
  | 'relationship-signal'
  | 'labor-commerce'
  | 'institution-use'
  | 'public-life'
  | 'observer-intervention'
  | 'data-coverage';

export type Confidence = '高' | '中' | '低';

export type ObservationEvidence = {
  evidenceId: string;
  category: EvidenceCategory;
  statement: string;
  sourceKeys: string[];
  confidence: Confidence;
  limitations: string[];
};

export type AnalysisFinding = {
  claim: string;
  evidenceIds: string[];
  confidence: Confidence;
  alternativeExplanation: string;
};

export type SocialEvidenceBundle = {
  evidence: ObservationEvidence[];
  ruleFindings: AnalysisFinding[];
  limitations: string[];
  followUps: string[];
  methodNotes: string[];
};

type DailyMessage = BroadcastSnapshot['dailyMessages'][number];
type LifeEvent = NonNullable<BroadcastSnapshot['dailyLifeEvents']>[number];
type PublicLog = BroadcastSnapshot['logs'][number];

type SourceRecord = {
  key: string;
  createdAt: number;
  text: string;
};

type EvidenceDraft = Omit<ObservationEvidence, 'evidenceId'> & {
  findingClaim: string;
  alternativeExplanation: string;
};

const LEGACY_EXPERIMENT_NOTE = '已排除旧实验条件诱发的谜团内容';

// This mirrors the public-facing legacy policy without importing Convex server modules
// into the browser bundle.
const legacyExperimentPatterns = [
  /海面|海潮|潮汐|观潮|航标|海风|海浪|夜航|失落航路|无海航路|异常闪光|灯塔谜|机关谜|线索交汇|雾潮|灯塔导航/u,
  /旧(?:记录|档案|赛事)|历史(?:记录|档案)|往届|异变|谜团|谜题|失踪|河道线索|花木线索|机关线索|灯塔线索|最新线索|关键线索|追查(?:河道|灯塔|机关|花木)|灯火装置/u,
  /寻宝(?:赛|比赛|竞赛)(?:已经|已)?结束/u,
  /(?:一?百万|100万|1(?:[,，]000){2})(?:枚)?金贝/u,
  /\bocean(?:ic)?[\s/-]+(?:tides?|beacons?|navigation|navigational|waves?|breeze|surface)\b/iu,
  /\bsea[\s/-]+(?:beacons?|navigation|navigational|voyage|route|waves?|breeze)\b/iu,
  /\blighthouse[\s/-]+(?:myster(?:y|ies)|navigation|navigational)\b/iu,
  /\bmillion[\s-]+(?:gold(?:en)?[\s-]+)?shells?\b/iu,
] as const;

const activityLabels: Record<string, string> = {
  work: '工作',
  conversation: '对话',
  social: '社交',
  memory: '记忆记录',
  travel: '出行',
  meal: '饮食',
  rest: '休息',
  leisure: '休闲',
  purchase: '采买',
  health: '健康',
  event: '公共活动',
};

const explicitSignalPatterns = {
  cooperation: /合作|协作|共同|一起|合力|配合/u,
  care: /照顾|照料|关心|看望|陪同|送药|换药|问诊|护理/u,
  trade: /交易|订单|购买|售出|买入|卖出|采购|付款|收款|结算|工资|账目/u,
  dispute: /分歧|争执|争吵|冲突|反对|拒绝|误会/u,
} as const;

const categoryOrder: Record<EvidenceCategory, number> = {
  'interaction-network': 0,
  'activity-distribution': 1,
  'relationship-signal': 2,
  'labor-commerce': 3,
  'institution-use': 4,
  'public-life': 5,
  'observer-intervention': 6,
  'data-coverage': 7,
};

function normalizeText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeKeyPart(value: string) {
  return encodeURIComponent(normalizeText(value)).replace(/%3A/giu, ':');
}

function isCurrentDay(createdAt: number, now: number) {
  return Number.isFinite(createdAt) && shanghaiDayKey(createdAt) === shanghaiDayKey(now);
}

function isLegacyExperimentText(value: string) {
  const normalized = normalizeText(value);
  return legacyExperimentPatterns.some((pattern) => pattern.test(normalized));
}

function messageSource(message: DailyMessage): SourceRecord {
  return {
    key: `message:${safeKeyPart(message.messageId)}`,
    createdAt: message.createdAt,
    text: normalizeText(message.text),
  };
}

function lifeSource(event: LifeEvent): SourceRecord {
  return {
    key: `life:${event.createdAt}:${safeKeyPart(event.residentId)}:${safeKeyPart(event.kind)}`,
    createdAt: event.createdAt,
    text: normalizeText(event.text),
  };
}

function logSource(log: PublicLog): SourceRecord {
  return {
    key: `log:${safeKeyPart(log.eventKey)}#${log.sequence}`,
    createdAt: log.createdAt,
    text: normalizeText(log.text),
  };
}

function compareSource(left: SourceRecord, right: SourceRecord) {
  return left.createdAt - right.createdAt || left.key.localeCompare(right.key);
}

function uniqueSourceKeys(records: readonly SourceRecord[]) {
  return [...new Set([...records].sort(compareSource).map((record) => record.key))];
}

function confidenceForCount(count: number, highThreshold: number): Confidence {
  if (count >= highThreshold) return '高';
  if (count > 0) return '中';
  return '低';
}

function combinations(values: readonly string[]) {
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      pairs.push([values[left], values[right]]);
    }
  }
  return pairs;
}

function formatCounts(entries: readonly [string, number][], suffix: string) {
  return entries.length > 0
    ? entries.map(([label, count]) => `${label} ${count} ${suffix}`).join('、')
    : '无记录';
}

function buildResidentIndex(snapshot: BroadcastSnapshot, messages: readonly DailyMessage[]) {
  const residents = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  const sourceKeys = new Map<string, Set<string>>();

  const addResident = (residentId: string, displayName: string, sourceKey: string) => {
    const token = `id:${normalizeText(residentId)}`;
    const normalizedName = normalizeText(displayName);
    const tokensForName = names.get(normalizedName) ?? new Set<string>();
    tokensForName.add(token);
    names.set(normalizedName, tokensForName);
    residents.set(token, tokensForName);
    const residentSources = sourceKeys.get(token) ?? new Set<string>();
    residentSources.add(sourceKey);
    sourceKeys.set(token, residentSources);
  };

  for (const resident of snapshot.residentActivity) {
    if (resident.observerControlled) continue;
    addResident(
      resident.residentId,
      resident.displayName,
      `resident:${safeKeyPart(resident.residentId)}`,
    );
  }
  for (const participant of snapshot.participants) {
    addResident(
      participant.residentId,
      participant.displayName,
      `resident:${safeKeyPart(participant.residentId)}`,
    );
  }
  for (const message of messages) {
    if (message.observerIntervention) continue;
    addResident(message.authorId, message.authorName, messageSource(message).key);
  }

  return { residentTokens: [...residents.keys()].sort(), names, sourceKeys };
}

function resolveParticipantToken(
  participantName: string,
  names: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const matches = names.get(normalizeText(participantName));
  return matches?.size === 1 ? [...matches][0] : undefined;
}

function buildNetworkDraft(
  snapshot: BroadcastSnapshot,
  messages: readonly DailyMessage[],
): EvidenceDraft {
  const residentIndex = buildResidentIndex(snapshot, messages);
  const messagesByConversation = new Map<string, DailyMessage[]>();
  for (const message of messages) {
    if (message.observerIntervention) continue;
    const group = messagesByConversation.get(message.conversationId) ?? [];
    group.push(message);
    messagesByConversation.set(message.conversationId, group);
  }
  const conversationParticipants = new Map(
    snapshot.conversations.map((conversation) => [
      conversation.conversationId,
      conversation.participantNames,
    ]),
  );
  const pairCounts = new Map<string, number>();
  const interactingResidents = new Set<string>();
  const sources: SourceRecord[] = [];

  for (const [conversationId, group] of [...messagesByConversation.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const tokens = new Set<string>();
    for (const message of group) tokens.add(`id:${normalizeText(message.authorId)}`);
    for (const name of conversationParticipants.get(conversationId) ?? []) {
      const token = resolveParticipantToken(name, residentIndex.names);
      if (token) tokens.add(token);
    }
    const pairs = combinations([...tokens].sort());
    if (pairs.length === 0) continue;
    sources.push(...group.map(messageSource));
    for (const [left, right] of pairs) {
      pairCounts.set(`${left}\u0000${right}`, (pairCounts.get(`${left}\u0000${right}`) ?? 0) + 1);
      interactingResidents.add(left);
      interactingResidents.add(right);
    }
  }

  for (const token of residentIndex.residentTokens) {
    for (const sourceKey of residentIndex.sourceKeys.get(token) ?? []) {
      sources.push({ key: sourceKey, createdAt: Number.POSITIVE_INFINITY, text: '' });
    }
  }

  const totalPairInteractions = [...pairCounts.values()].reduce((sum, count) => sum + count, 0);
  const largestPairCount = Math.max(0, ...pairCounts.values());
  const concentration = totalPairInteractions > 0
    ? Math.round((largestPairCount / totalPairInteractions) * 100)
    : 0;
  const withoutInteraction = residentIndex.residentTokens.filter(
    (token) => !interactingResidents.has(token),
  ).length;
  const statement = `当日记录到居民互动对 ${pairCounts.size} 组，互动集中度 ${concentration}%，未记录到居民间互动 ${withoutInteraction} 人。`;

  return {
    category: 'interaction-network',
    statement,
    sourceKeys: uniqueSourceKeys(sources),
    confidence: confidenceForCount(totalPairInteractions, 3),
    limitations: ['互动对仅依据当日带时间戳消息及可映射参与者统计。'],
    findingClaim: `当日可见互动包含 ${pairCounts.size} 组居民对，最高频互动对占全部居民对互动的 ${concentration}%。`,
    alternativeExplanation: '未覆盖时段或未进入消息记录的互动可能呈现不同分布。',
  };
}

function buildActivityDraft(lifeEvents: readonly LifeEvent[]): EvidenceDraft {
  const counts = new Map<string, number>();
  for (const event of lifeEvents) {
    const label = activityLabels[event.kind] ?? '其他';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const orderedCounts = [...counts.entries()];
  return {
    category: 'activity-distribution',
    statement: `当日活动分类计数：${formatCounts(orderedCounts, '条')}。`,
    sourceKeys: uniqueSourceKeys(lifeEvents.map(lifeSource)),
    confidence: confidenceForCount(lifeEvents.length, 5),
    limitations: ['活动分类只使用生活事件的显式 kind 字段，未知类别归为“其他”。'],
    findingClaim: orderedCounts.length > 0
      ? `当日 ${lifeEvents.length} 条生活事件分布在 ${orderedCounts.length} 个活动类别。`
      : '当日没有带时间戳的生活事件可用于活动分布判断。',
    alternativeExplanation: '未写入生活事件的活动不会出现在这一分布中。',
  };
}

function buildInstitutionDraft(lifeEvents: readonly LifeEvent[]): EvidenceDraft {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const matchingSources: SourceRecord[] = [];
  for (const event of lifeEvents) {
    for (const landmark of townLandmarks) {
      if (!normalizeText(event.text).includes(landmark.name)) continue;
      counts.set(landmark.name, (counts.get(landmark.name) ?? 0) + 1);
      firstSeen.set(landmark.name, Math.min(firstSeen.get(landmark.name) ?? Infinity, event.createdAt));
      matchingSources.push(lifeSource(event));
    }
  }
  const orderedCounts = [...counts.entries()].sort(([left], [right]) =>
    (firstSeen.get(left) ?? Infinity) - (firstSeen.get(right) ?? Infinity)
      || left.localeCompare(right),
  );
  const totalUses = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const highestUse = Math.max(0, ...counts.values());
  const concentration = totalUses > 0 ? Math.round((highestUse / totalUses) * 100) : 0;
  return {
    category: 'institution-use',
    statement: `当日明确机构使用：${formatCounts(orderedCounts, '次')}；最高单一机构占 ${concentration}%。`,
    sourceKeys: uniqueSourceKeys(matchingSources),
    confidence: confidenceForCount(totalUses, 4),
    limitations: ['只统计生活事件中明确写出已配置机构名称的记录。'],
    findingClaim: totalUses > 0
      ? `当日记录到 ${totalUses} 次明确机构使用，最高单一机构占 ${concentration}%。`
      : '当日生活事件中没有明确机构使用记录。',
    alternativeExplanation: '未写明机构名称的到访不会被本指标计入。',
  };
}

function buildRelationshipDraft(
  messages: readonly DailyMessage[],
  lifeEvents: readonly LifeEvent[],
): EvidenceDraft {
  const records = [
    ...messages.filter((message) => !message.observerIntervention).map(messageSource),
    ...lifeEvents.map(lifeSource),
  ].sort(compareSource);
  const counts = {
    cooperation: 0,
    care: 0,
    trade: 0,
    dispute: 0,
  };
  const matchingSources: SourceRecord[] = [];
  for (const record of records) {
    let matched = false;
    for (const kind of Object.keys(explicitSignalPatterns) as Array<keyof typeof counts>) {
      if (!explicitSignalPatterns[kind].test(record.text)) continue;
      counts[kind] += 1;
      matched = true;
    }
    if (matched) matchingSources.push(record);
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    category: 'relationship-signal',
    statement: `当日文本中的明确迹象：合作 ${counts.cooperation} 条、照护 ${counts.care} 条、交易 ${counts.trade} 条、分歧 ${counts.dispute} 条。`,
    sourceKeys: uniqueSourceKeys(matchingSources),
    confidence: confidenceForCount(total, 5),
    limitations: ['只计数明确词语命中的记录，同一记录可包含多类迹象。'],
    findingClaim: `当日明确文本迹象中，合作 ${counts.cooperation} 条、照护 ${counts.care} 条、交易 ${counts.trade} 条、分歧 ${counts.dispute} 条。`,
    alternativeExplanation: '没有使用这些明确词语的行为可能未被文本计数覆盖。',
  };
}

function buildObserverDraft(messages: readonly DailyMessage[]): EvidenceDraft {
  const observerMessages = messages.filter((message) => message.observerIntervention);
  return {
    category: 'observer-intervention',
    statement: `当日观察者消息 ${observerMessages.length} 条；本指标不据此判断介入效果。`,
    sourceKeys: uniqueSourceKeys(observerMessages.map(messageSource)),
    confidence: confidenceForCount(observerMessages.length, 3),
    limitations: ['单日记录不足以比较观察者介入前后的变化。'],
    findingClaim: `当日记录到观察者消息 ${observerMessages.length} 条，现有样本不支持效果判断。`,
    alternativeExplanation: '消息附近的活动变化也可能属于原有日程或未记录事件。',
  };
}

function buildPublicLifeDraft(
  messages: readonly DailyMessage[],
  lifeEvents: readonly LifeEvent[],
  publicLogs: readonly PublicLog[],
): EvidenceDraft {
  const publicLifeEvents = lifeEvents.filter((event) => event.kind === 'event');
  const ordinaryLifeEvents = lifeEvents.filter((event) => event.kind !== 'event');
  const ordinaryMessages = messages.filter((message) => !message.observerIntervention);
  const publicCount = publicLogs.length + publicLifeEvents.length;
  const ordinaryCount = ordinaryLifeEvents.length + ordinaryMessages.length;
  const sources = [
    ...publicLogs.map(logSource),
    ...lifeEvents.map(lifeSource),
    ...ordinaryMessages.map(messageSource),
  ];
  return {
    category: 'public-life',
    statement: `当日公共事件 ${publicCount} 条，普通生活 ${ordinaryCount} 条。`,
    sourceKeys: uniqueSourceKeys(sources),
    confidence: confidenceForCount(publicCount + ordinaryCount, 6),
    limitations: ['公共事件取公共日志及 event 类生活事件，普通生活取其余生活事件和居民消息。'],
    findingClaim: `当日可见记录包含公共事件 ${publicCount} 条、普通生活 ${ordinaryCount} 条。`,
    alternativeExplanation: '公共日志与普通生活消息的记录密度可能不同。',
  };
}

function evidenceSortKey(entry: EvidenceDraft, sourceRanks: ReadonlyMap<string, number>) {
  return Math.min(...entry.sourceKeys.map((key) => sourceRanks.get(key) ?? Infinity), Infinity);
}

function confidenceRank(confidence: Confidence) {
  return confidence === '高' ? 3 : confidence === '中' ? 2 : 1;
}

export function buildSocialEvidence(
  snapshot: BroadcastSnapshot,
  now = Date.now(),
): SocialEvidenceBundle {
  const messages = snapshot.dailyMessages
    .filter((message) => isCurrentDay(message.createdAt, now))
    .filter((message) => !isLegacyExperimentText(message.text))
    .sort((left, right) => compareSource(messageSource(left), messageSource(right)));
  const lifeEvents = (snapshot.dailyLifeEvents ?? [])
    .filter((event) => isCurrentDay(event.createdAt, now))
    .filter((event) => !isLegacyExperimentText(event.text))
    .sort((left, right) => compareSource(lifeSource(left), lifeSource(right)));
  const publicLogs = snapshot.logs
    .filter((log) => log.kind !== 'conversation' && isCurrentDay(log.createdAt, now))
    .filter((log) => !isLegacyExperimentText(log.text))
    .sort((left, right) => compareSource(logSource(left), logSource(right)));

  const allSources = [
    ...messages.map(messageSource),
    ...lifeEvents.map(lifeSource),
    ...publicLogs.map(logSource),
    ...snapshot.residentActivity
      .filter((resident) => !resident.observerControlled)
      .map((resident) => ({
        key: `resident:${safeKeyPart(resident.residentId)}`,
        createdAt: Number.POSITIVE_INFINITY,
        text: '',
      })),
  ].sort(compareSource);
  const sourceRanks = new Map(allSources.map((source, index) => [source.key, index]));
  const drafts = [
    buildNetworkDraft(snapshot, messages),
    buildActivityDraft(lifeEvents),
    buildInstitutionDraft(lifeEvents),
    buildRelationshipDraft(messages, lifeEvents),
    buildObserverDraft(messages),
    buildPublicLifeDraft(messages, lifeEvents, publicLogs),
  ].sort((left, right) =>
    evidenceSortKey(left, sourceRanks) - evidenceSortKey(right, sourceRanks)
      || categoryOrder[left.category] - categoryOrder[right.category],
  );

  const evidence = drafts.map(({ findingClaim: _claim, alternativeExplanation: _alternative, ...entry }, index) => ({
    ...entry,
    evidenceId: `E${String(index + 1).padStart(3, '0')}`,
  }));
  const evidenceByCategory = new Map(evidence.map((entry) => [entry.category, entry]));
  const ruleFindings = drafts
    .map((draft) => ({
      draft,
      evidence: evidenceByCategory.get(draft.category)!,
    }))
    .sort((left, right) =>
      confidenceRank(right.evidence.confidence) - confidenceRank(left.evidence.confidence)
        || right.evidence.sourceKeys.length - left.evidence.sourceKeys.length
        || categoryOrder[left.evidence.category] - categoryOrder[right.evidence.category],
    )
    .slice(0, 3)
    .map(({ draft, evidence: sourceEvidence }) => ({
      claim: draft.findingClaim,
      evidenceIds: [sourceEvidence.evidenceId],
      confidence: sourceEvidence.confidence,
      alternativeExplanation: draft.alternativeExplanation,
    }));

  return {
    evidence,
    ruleFindings,
    limitations: [
      '仅覆盖输入快照中属于同一上海日期的带时间戳记录。',
      '没有跨日基线，不能据此描述上升、下降或长期趋势。',
      '显式关系迹象来自保守关键词计数，不补全未写入记录的行为。',
    ],
    followUps: [
      '继续记录未出现居民间互动的居民是否在其他时段参与互动。',
      '按相同口径积累多日活动与机构使用计数后再比较。',
      '继续核对观察者消息附近是否有足够的前后记录。',
    ],
    methodNotes: [
      LEGACY_EXPERIMENT_NOTE,
      '证据编号在确定性排序后单调分配，sourceKeys 对应输入快照记录。',
      '只描述当日可见结构，不作人物心理或单次事件效果判断。',
    ],
  };
}
