import { townLandmarks } from '../../data/worlds/lighthouse-town/map';
import { splitConversationClauses } from '../../convex/util/conversationText';
import { filterLegacyExperimentClauses } from '../../convex/util/conversationTextPolicy';
import type {
  Confidence,
  EvidenceCategory,
  ObservationEvidence,
  SocialEvidenceBundle,
} from '../../shared/socialAnalysis';
import { shanghaiDayKey, type BroadcastSnapshot } from './eventBroadcastView';

export type {
  AnalysisFinding,
  Confidence,
  EvidenceCategory,
  ObservationEvidence,
  SocialEvidenceBundle,
} from '../../shared/socialAnalysis';

type DailyMessage = BroadcastSnapshot['dailyMessages'][number];
type LifeEvent = NonNullable<BroadcastSnapshot['dailyLifeEvents']>[number];
type PublicLog = BroadcastSnapshot['logs'][number];

type SourceRecord = {
  key: string;
  createdAt: number;
  text: string;
};

type EvidenceSources = {
  message: ReadonlyMap<DailyMessage, SourceRecord>;
  life: ReadonlyMap<LifeEvent, SourceRecord>;
  log: ReadonlyMap<PublicLog, SourceRecord>;
};

type EvidenceDraft = Omit<ObservationEvidence, 'evidenceId'> & {
  findingClaim: string;
  alternativeExplanation: string;
  coverageScore: number;
};

const LEGACY_EXPERIMENT_NOTE = '已排除旧实验条件诱发的谜团内容';

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
  friendship: /朋友|友情|友谊|挚友|邻里/u,
  intimacy: /约会|恋爱|伴侣|亲密/u,
  cooperation: /合作|协作|共同|一起|合力|配合/u,
  care: /照顾|照料|关心|看望|陪同|送药|换药|问诊|护理/u,
  trade: /交易|订单|购买|售出|买入|卖出|采购|付款|收款|结算|工资|账目/u,
  dispute: /分歧|争执|争吵|冲突|反对|误会/u,
} as const;

type CoverageAssessment = {
  confidence: Confidence;
  score: number;
};

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

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareSource(left: SourceRecord, right: SourceRecord) {
  return left.createdAt - right.createdAt || compareText(left.key, right.key);
}

function assignAuditSources<T>(
  records: readonly T[],
  sourceData: (record: T) => Omit<SourceRecord, 'key'> & { baseKey: string; tieKey: string },
) {
  const sorted = records.map((record) => ({ record, ...sourceData(record) }));
  sorted.sort((left, right) =>
    left.createdAt - right.createdAt
      || compareText(left.baseKey, right.baseKey)
      || compareText(left.tieKey, right.tieKey),
  );
  const occurrences = new Map<string, number>();
  const result = new Map<T, SourceRecord>();
  for (const item of sorted) {
    const occurrence = (occurrences.get(item.baseKey) ?? 0) + 1;
    occurrences.set(item.baseKey, occurrence);
    result.set(item.record, {
      key: `${item.baseKey}#${String(occurrence).padStart(3, '0')}`,
      createdAt: item.createdAt,
      text: item.text,
    });
  }
  return result;
}

function buildEvidenceSources(
  messages: readonly DailyMessage[],
  lifeEvents: readonly LifeEvent[],
  publicLogs: readonly PublicLog[],
  semanticMessageText: ReadonlyMap<DailyMessage, string> = new Map(),
): EvidenceSources {
  return {
    message: assignAuditSources(messages, (message) => ({
      baseKey: `message:${safeKeyPart(message.messageId)}`,
      tieKey: [
        normalizeText(message.conversationId),
        normalizeText(message.authorId),
        String(message.observerIntervention),
        normalizeText(message.text),
      ].join('\u0000'),
      createdAt: message.createdAt,
      text: normalizeText(semanticMessageText.get(message) ?? message.text),
    })),
    life: assignAuditSources(lifeEvents, (event) => ({
      baseKey: `life:${event.createdAt}:${safeKeyPart(event.residentId)}:${safeKeyPart(event.kind)}`,
      tieKey: [normalizeText(event.displayName), normalizeText(event.text)].join('\u0000'),
      createdAt: event.createdAt,
      text: normalizeText(event.text),
    })),
    log: assignAuditSources(publicLogs, (log) => ({
      baseKey: `log:${safeKeyPart(log.eventKey)}#${log.sequence}`,
      tieKey: [normalizeText(log.kind), normalizeText(log.text)].join('\u0000'),
      createdAt: log.createdAt,
      text: normalizeText(log.text),
    })),
  };
}

function sourceFor<T>(sources: ReadonlyMap<T, SourceRecord>, record: T) {
  const source = sources.get(record);
  if (!source) throw new Error('Missing normalized evidence source');
  return source;
}

function uniqueSourceKeys(records: readonly SourceRecord[]) {
  return [...new Set(records.slice().sort(compareSource).map((record) => record.key))];
}

function assessCoverage(
  residentCount: number,
  sourceCount: number,
  timestamps: readonly number[],
  categoryCount: number,
): CoverageAssessment {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const timestamp of timestamps) {
    minimum = Math.min(minimum, timestamp);
    maximum = Math.max(maximum, timestamp);
  }
  const span = timestamps.length > 1 ? maximum - minimum : 0;
  const dimensions = [
    residentCount >= 3,
    sourceCount >= 3,
    span >= 30 * 60_000,
    categoryCount >= 2,
  ];
  const coveredDimensions = dimensions.filter(Boolean).length;
  const score = sourceCount > 0 ? coveredDimensions + 1 : 0;
  if (coveredDimensions >= 3) return { confidence: '高', score };
  if (residentCount >= 2 || categoryCount >= 2 || span > 0) {
    return { confidence: '中', score };
  }
  return { confidence: '低', score };
}

function formatCounts(entries: readonly [string, number][], suffix: string) {
  return entries.length > 0
    ? entries.map(([label, count]) => `${label} ${count} ${suffix}`).join('、')
    : '无记录';
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INSTITUTION_ASSERTION_BLOCKER = /不|未|没有|没|并非|绝非|尚未|从未|拒绝|否认|如果|假如|计划|打算|准备|明天|将要|想|希望|可能|建议|提议|倡议|提案|被否决/u;
const RELATIONSHIP_MODAL_BLOCKER = /如果|假如|计划|打算|准备|明天|将要|想|希望|可能|建议|提议|倡议|提案|请求/u;
const RELATIONSHIP_NEGATING_PREFIX = /(?:并非|绝非|尚未|从未|并无|毫无|否认|拒绝|没有|未|不|没|无)[^。！？!?；;，,]{0,8}$/u;
const REPORTED_OR_EXAMPLE = /例如|比如|举例|例子|听说|据说|[\p{Script=Han}]{2,8}(?:说|称|表示|声称|提到)|报道称|消息称/u;
const NON_ASSERTION_CLAUSE_END = /(?:吗|呢)$/u;

function stripQuotedText(value: string) {
  const openingToClosing: Record<string, string> = {
    '“': '”',
    '‘': '’',
    '「': '」',
    '『': '』',
    '"': '"',
    "'": "'",
  };
  let closingQuote: string | undefined;
  let result = '';
  for (const character of value) {
    if (closingQuote) {
      if (character === closingQuote) closingQuote = undefined;
      continue;
    }
    const closing = openingToClosing[character];
    if (closing) {
      closingQuote = closing;
      continue;
    }
    result += character;
  }
  return result.trim();
}

function withoutInterrogativeSentences(value: string) {
  let result = '';
  let sentence = '';
  for (const character of value) {
    sentence += character;
    if (/[?？]/u.test(character)) {
      sentence = '';
    } else if (/[。！!；;\n]/u.test(character)) {
      result += sentence;
      sentence = '';
    }
  }
  return result + sentence;
}

function candidateAssertionClauses(value: string) {
  return splitConversationClauses(withoutInterrogativeSentences(normalizeText(value)))
    .flatMap((clause) => clause.split(/但是|不过|然而|但|却/u))
    .map(stripQuotedText)
    .filter((clause) =>
      clause.length > 0 && !/是否/u.test(clause) && !NON_ASSERTION_CLAUSE_END.test(clause),
    );
}

function assertedInstitutionClauses(value: string) {
  return candidateAssertionClauses(value).filter((clause) =>
    !INSTITUTION_ASSERTION_BLOCKER.test(clause) && !REPORTED_OR_EXAMPLE.test(clause),
  );
}

function assertedRelationshipClauses(value: string) {
  return candidateAssertionClauses(value).filter((clause) =>
    !RELATIONSHIP_MODAL_BLOCKER.test(clause) && !REPORTED_OR_EXAMPLE.test(clause),
  );
}

function hasAffirmedRelationshipSignal(clause: string, pattern: RegExp) {
  const matcher = new RegExp(pattern.source, `${pattern.flags.replaceAll('g', '')}g`);
  for (const match of clause.matchAll(matcher)) {
    const signalStart = match.index ?? 0;
    const localPrefix = clause.slice(Math.max(0, signalStart - 12), signalStart);
    if (!RELATIONSHIP_NEGATING_PREFIX.test(localPrefix)) return true;
  }
  return false;
}

function isExplicitCompletedInstitutionUse(value: string, institutionName: string) {
  const normalized = normalizeText(value);
  const name = escapeRegex(institutionName);
  const authoritativePrefix = `在${normalizeText(institutionName)}:`;
  const firstSentence = normalized.match(/^[^。！？!?；;\n]*[。！？!?；;\n]?/u)?.[0] ?? '';
  if (
    normalized.startsWith(authoritativePrefix)
    && !/[?？]/u.test(firstSentence)
    && !/是否/u.test(firstSentence)
    && !NON_ASSERTION_CLAUSE_END.test(firstSentence.replace(/[。！!；;\n]+$/u, ''))
  ) return true;
  const action = '摆摊|卖鱼|喝茶|备课|摆渡|排节气日程|工作|整理|营业|坐诊|上课|采购|购买|销售|卖货|用餐|吃饭|休息|拜访|探望|办理|修理|送货|换药|开会|学习';
  const outside = '(?!(?:的)?(?:附近|门口|旁边|周边|外面))';
  const movement = `(?:去(?:了)?|到(?:了)?|进入(?:了)?|抵达(?:了)?|来到(?:了)?|回到(?:了)?|走进(?:了)?)${name}${outside}`;
  const actionAtInstitution = `(?:在|于)${name}${outside}[^。！？]{0,40}(?:${action})`;
  const institutionAfterAction = `(?:${action})[^。！？]{0,40}(?:在|于)${name}${outside}(?:[^。！？]{0,12}(?:完成|进行))?`;
  return assertedInstitutionClauses(value).some((clause) =>
    clause.includes(institutionName)
      && (
        new RegExp(movement, 'u').test(clause)
        || new RegExp(actionAtInstitution, 'u').test(clause)
        || new RegExp(institutionAfterAction, 'u').test(clause)
      ),
  );
}

function buildResidentIndex(
  snapshot: BroadcastSnapshot,
  messages: readonly DailyMessage[],
  sources: EvidenceSources,
) {
  const residents = new Set<string>();
  const sourceKeys = new Map<string, Set<string>>();
  const observerControlledIds = new Set(
    snapshot.residentActivity
      .filter((resident) => resident.observerControlled)
      .map((resident) => resident.residentId),
  );

  const addResident = (residentId: string, sourceKey: string) => {
    const token = `id:${normalizeText(residentId)}`;
    residents.add(token);
    const residentSources = sourceKeys.get(token) ?? new Set<string>();
    residentSources.add(sourceKey);
    sourceKeys.set(token, residentSources);
  };

  for (const resident of snapshot.residentActivity) {
    if (resident.observerControlled) continue;
    addResident(resident.residentId, `resident:${safeKeyPart(resident.residentId)}`);
  }
  for (const participant of snapshot.participants) {
    if (observerControlledIds.has(participant.residentId)) continue;
    addResident(participant.residentId, `resident:${safeKeyPart(participant.residentId)}`);
  }
  for (const message of messages) {
    if (message.observerIntervention || observerControlledIds.has(message.authorId)) continue;
    addResident(message.authorId, sourceFor(sources.message, message).key);
  }

  return { residentTokens: [...residents].sort(), sourceKeys, observerControlledIds };
}

function buildNetworkDraft(
  snapshot: BroadcastSnapshot,
  messages: readonly DailyMessage[],
  sources: EvidenceSources,
): EvidenceDraft {
  const residentIndex = buildResidentIndex(snapshot, messages, sources);
  const messagesByConversation = new Map<string, DailyMessage[]>();
  for (const message of messages) {
    const group = messagesByConversation.get(message.conversationId) ?? [];
    group.push(message);
    messagesByConversation.set(message.conversationId, group);
  }
  const pairCounts = new Map<string, number>();
  const interactingResidents = new Set<string>();
  const networkSources: SourceRecord[] = [];

  for (const [, group] of [...messagesByConversation.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    for (let index = 1; index < group.length; index += 1) {
      const previousMessage = group[index - 1];
      const currentMessage = group[index];
      if (
        previousMessage.observerIntervention
        || currentMessage.observerIntervention
        || residentIndex.observerControlledIds.has(previousMessage.authorId)
        || residentIndex.observerControlledIds.has(currentMessage.authorId)
      ) continue;
      const previous = `id:${normalizeText(previousMessage.authorId)}`;
      const current = `id:${normalizeText(currentMessage.authorId)}`;
      if (previous === current) continue;
      const [left, right] = previous < current ? [previous, current] : [current, previous];
      const pairKey = `${left}\u0000${right}`;
      pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
      interactingResidents.add(left);
      interactingResidents.add(right);
      networkSources.push(
        sourceFor(sources.message, previousMessage),
        sourceFor(sources.message, currentMessage),
      );
    }
  }

  for (const token of residentIndex.residentTokens) {
    for (const sourceKey of residentIndex.sourceKeys.get(token) ?? []) {
      networkSources.push({ key: sourceKey, createdAt: Number.POSITIVE_INFINITY, text: '' });
    }
  }

  const totalPairInteractions = [...pairCounts.values()].reduce((sum, count) => sum + count, 0);
  let largestPairCount = 0;
  for (const count of pairCounts.values()) largestPairCount = Math.max(largestPairCount, count);
  const concentration = totalPairInteractions > 0
    ? Math.round((largestPairCount / totalPairInteractions) * 100)
    : 0;
  const withoutInteraction = residentIndex.residentTokens.filter(
    (token) => !interactingResidents.has(token),
  ).length;
  const coveredMessages = messages.filter((message) =>
    !message.observerIntervention
      && !residentIndex.observerControlledIds.has(message.authorId),
  );
  const coverage = assessCoverage(
    new Set(coveredMessages.map((message) => message.authorId)).size,
    new Set(coveredMessages.map((message) => sourceFor(sources.message, message).key)).size,
    coveredMessages.map((message) => message.createdAt),
    pairCounts.size,
  );
  const statement = `当日记录到居民互动对 ${pairCounts.size} 组，可归属互动回合 ${totalPairInteractions} 条（均为相邻跨居民转接），互动集中度 ${concentration}%，未记录到居民间互动 ${withoutInteraction} 人。`;

  return {
    category: 'interaction-network',
    statement,
    sourceKeys: uniqueSourceKeys(networkSources),
    confidence: coverage.confidence,
    limitations: ['互动对仅依据同一会话中按时间排序的相邻跨居民消息转接统计；观察者消息保留为转接边界。'],
    findingClaim: totalPairInteractions > 0
      ? `当日可见互动包含 ${pairCounts.size} 组居民对和 ${totalPairInteractions} 条可归属互动回合，最高频互动对占 ${concentration}%。`
      : '当日快照未记录到可归属居民对的互动回合。',
    alternativeExplanation: '未覆盖时段或未进入消息记录的互动可能呈现不同分布。',
    coverageScore: coverage.score,
  };
}

function buildActivityDraft(
  lifeEvents: readonly LifeEvent[],
  sources: EvidenceSources,
): EvidenceDraft {
  const counts = new Map<string, number>();
  for (const event of lifeEvents) {
    const label = activityLabels[event.kind] ?? '其他';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const orderedCounts = [...counts.entries()];
  const coverage = assessCoverage(
    new Set(lifeEvents.map((event) => event.residentId)).size,
    lifeEvents.length,
    lifeEvents.map((event) => event.createdAt),
    counts.size,
  );
  return {
    category: 'activity-distribution',
    statement: `当日活动分类计数：${formatCounts(orderedCounts, '条')}。`,
    sourceKeys: uniqueSourceKeys(lifeEvents.map((event) => sourceFor(sources.life, event))),
    confidence: coverage.confidence,
    limitations: ['活动分类只使用生活事件的显式 kind 字段，未知类别归为“其他”。'],
    findingClaim: orderedCounts.length > 0
      ? `当日 ${lifeEvents.length} 条生活事件分布在 ${orderedCounts.length} 个活动类别。`
      : '当日没有带时间戳的生活事件可用于活动分布判断。',
    alternativeExplanation: '未写入生活事件的活动不会出现在这一分布中。',
    coverageScore: coverage.score,
  };
}

function buildInstitutionDraft(
  lifeEvents: readonly LifeEvent[],
  sources: EvidenceSources,
): EvidenceDraft {
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const matchingSources: SourceRecord[] = [];
  const matchingResidents = new Set<string>();
  for (const event of lifeEvents) {
    for (const landmark of townLandmarks) {
      if (!isExplicitCompletedInstitutionUse(event.text, landmark.name)) continue;
      counts.set(landmark.name, (counts.get(landmark.name) ?? 0) + 1);
      firstSeen.set(landmark.name, Math.min(firstSeen.get(landmark.name) ?? Infinity, event.createdAt));
      matchingSources.push(sourceFor(sources.life, event));
      matchingResidents.add(event.residentId);
    }
  }
  const orderedCounts = [...counts.entries()].sort(([left], [right]) =>
    (firstSeen.get(left) ?? Infinity) - (firstSeen.get(right) ?? Infinity)
      || compareText(left, right),
  );
  const totalUses = [...counts.values()].reduce((sum, count) => sum + count, 0);
  let highestUse = 0;
  for (const count of counts.values()) highestUse = Math.max(highestUse, count);
  const concentration = totalUses > 0 ? Math.round((highestUse / totalUses) * 100) : 0;
  const coverage = assessCoverage(
    matchingResidents.size,
    new Set(matchingSources.map((source) => source.key)).size,
    matchingSources.map((source) => source.createdAt),
    counts.size,
  );
  return {
    category: 'institution-use',
    statement: `当日明确机构使用：${formatCounts(orderedCounts, '次')}；最高单一机构占 ${concentration}%。`,
    sourceKeys: uniqueSourceKeys(matchingSources),
    confidence: coverage.confidence,
    limitations: ['只统计生活事件中明确写出已配置机构名称的记录。'],
    findingClaim: totalUses > 0
      ? `当日记录到 ${totalUses} 次明确机构使用，最高单一机构占 ${concentration}%。`
      : '当日生活事件中没有明确机构使用记录。',
    alternativeExplanation: '未写明机构名称的到访不会被本指标计入。',
    coverageScore: coverage.score,
  };
}

function buildRelationshipDraft(
  messages: readonly DailyMessage[],
  lifeEvents: readonly LifeEvent[],
  sources: EvidenceSources,
): EvidenceDraft {
  const records = [
    ...messages
      .filter((message) => !message.observerIntervention)
      .map((message) => ({
        residentId: message.authorId,
        source: sourceFor(sources.message, message),
      })),
    ...lifeEvents.map((event) => ({
      residentId: event.residentId,
      source: sourceFor(sources.life, event),
    })),
  ].sort((left, right) => compareSource(left.source, right.source));
  const counts: Record<keyof typeof explicitSignalPatterns, number> = {
    friendship: 0,
    intimacy: 0,
    cooperation: 0,
    care: 0,
    trade: 0,
    dispute: 0,
  };
  const matchingSources: SourceRecord[] = [];
  const matchingResidents = new Set<string>();
  for (const record of records) {
    let matched = false;
    const clauses = assertedRelationshipClauses(record.source.text);
    for (const kind of Object.keys(explicitSignalPatterns) as Array<keyof typeof counts>) {
      const explicitlyAffirmed = clauses.some((clause) =>
        hasAffirmedRelationshipSignal(clause, explicitSignalPatterns[kind]),
      );
      if (!explicitlyAffirmed) continue;
      counts[kind] += 1;
      matched = true;
    }
    if (matched) {
      matchingSources.push(record.source);
      matchingResidents.add(record.residentId);
    }
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const coveredCategories = Object.values(counts).filter((count) => count > 0).length;
  const coverage = assessCoverage(
    matchingResidents.size,
    new Set(matchingSources.map((source) => source.key)).size,
    matchingSources.map((source) => source.createdAt),
    coveredCategories,
  );
  return {
    category: 'relationship-signal',
    statement: `当日文本中的明确迹象：友情 ${counts.friendship} 条、亲密 ${counts.intimacy} 条、合作 ${counts.cooperation} 条、照护 ${counts.care} 条、交易 ${counts.trade} 条、分歧 ${counts.dispute} 条。`,
    sourceKeys: uniqueSourceKeys(matchingSources),
    confidence: coverage.confidence,
    limitations: ['只计数逐分句确认的当前或过往明确词语；否定、条件、计划、可能性、引语和转述不计入，同一记录可包含多类迹象。'],
    findingClaim: total > 0
      ? `当日明确文本迹象中，友情 ${counts.friendship} 条、亲密 ${counts.intimacy} 条、合作 ${counts.cooperation} 条、照护 ${counts.care} 条、交易 ${counts.trade} 条、分歧 ${counts.dispute} 条。`
      : '当日快照未记录到明确的友情、亲密、合作、照护、交易或分歧迹象。',
    alternativeExplanation: '没有使用这些明确词语的行为可能未被文本计数覆盖。',
    coverageScore: coverage.score,
  };
}

function buildObserverDraft(
  messages: readonly DailyMessage[],
  lifeEvents: readonly LifeEvent[],
  publicLogs: readonly PublicLog[],
  sources: EvidenceSources,
): EvidenceDraft {
  const observerMessages = messages.filter((message) => message.observerIntervention);
  const observerSources = observerMessages
    .map((message) => sourceFor(sources.message, message))
    .sort(compareSource);
  const visible = [
    ...messages
      .filter((message) => !message.observerIntervention)
      .map((message) => ({
        residentId: message.authorId,
        source: sourceFor(sources.message, message),
      })),
    ...lifeEvents.map((event) => ({
      residentId: event.residentId,
      source: sourceFor(sources.life, event),
    })),
    ...publicLogs.map((log) => ({
      residentId: undefined,
      source: sourceFor(sources.log, log),
    })),
  ].sort((left, right) => compareSource(left.source, right.source));
  const before = new Map<string, typeof visible[number]>();
  const after = new Map<string, typeof visible[number]>();
  const windowMs = 30 * 60_000;

  for (const record of visible) {
    let low = 0;
    let high = observerSources.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (observerSources[middle].createdAt < record.source.createdAt) low = middle + 1;
      else high = middle;
    }
    let nearest: SourceRecord | undefined;
    for (const candidateIndex of [low - 1, low]) {
      const candidate = observerSources[candidateIndex];
      if (!candidate) continue;
      const candidateDistance = Math.abs(candidate.createdAt - record.source.createdAt);
      const nearestDistance = nearest
        ? Math.abs(nearest.createdAt - record.source.createdAt)
        : Number.POSITIVE_INFINITY;
      if (
        candidateDistance < nearestDistance
        || (candidateDistance === nearestDistance && candidate.key < (nearest?.key ?? ''))
      ) nearest = candidate;
    }
    if (!nearest || Math.abs(nearest.createdAt - record.source.createdAt) > windowMs) continue;
    if (record.source.createdAt < nearest.createdAt) before.set(record.source.key, record);
    if (record.source.createdAt > nearest.createdAt) after.set(record.source.key, record);
  }

  const referencedVisible = [...before.values(), ...after.values()];
  const observerEvidenceSources = [
    ...observerSources,
    ...referencedVisible.map((record) => record.source),
  ];
  const coveredResidents = new Set(
    referencedVisible.flatMap((record) => record.residentId ? [record.residentId] : []),
  );
  const coverage = assessCoverage(
    coveredResidents.size,
    new Set(observerEvidenceSources.map((source) => source.key)).size,
    observerEvidenceSources.map((source) => source.createdAt),
    Number(observerMessages.length > 0) + Number(before.size > 0) + Number(after.size > 0),
  );
  const difference = after.size - before.size;
  return {
    category: 'observer-intervention',
    statement: `当日观察者消息 ${observerMessages.length} 条；介入前 30 分钟可见活动 ${before.size} 条，介入后 30 分钟可见活动 ${after.size} 条，差值 ${difference} 条；本指标不据此判断介入效果。`,
    sourceKeys: uniqueSourceKeys(observerEvidenceSources),
    confidence: coverage.confidence,
    limitations: ['固定窗口内的单日差异不能说明观察者介入效果，记录密度也可能不同。'],
    findingClaim: observerMessages.length > 0
      ? `当日记录到观察者消息 ${observerMessages.length} 条；前后 30 分钟可见活动差值为 ${difference} 条，现有样本不足以判断效果。`
      : '当日快照未记录到观察者消息，无可用介入前后窗口。',
    alternativeExplanation: '消息附近的活动变化也可能属于原有日程或未记录事件。',
    coverageScore: coverage.score,
  };
}

function buildPublicLifeDraft(
  messages: readonly DailyMessage[],
  lifeEvents: readonly LifeEvent[],
  publicLogs: readonly PublicLog[],
  sources: EvidenceSources,
): EvidenceDraft {
  const publicLifeEvents = lifeEvents.filter((event) => event.kind === 'event');
  const ordinaryLifeEvents = lifeEvents.filter((event) => event.kind !== 'event');
  const ordinaryMessages = messages.filter((message) => !message.observerIntervention);
  const publicCount = publicLogs.length + publicLifeEvents.length;
  const ordinaryCount = ordinaryLifeEvents.length + ordinaryMessages.length;
  const total = publicCount + ordinaryCount;
  const publicPercent = total > 0 ? Math.round((publicCount / total) * 100) : 0;
  const ordinaryPercent = total > 0 ? 100 - publicPercent : 0;
  const publicSources = [
    ...publicLogs.map((log) => sourceFor(sources.log, log)),
    ...lifeEvents.map((event) => sourceFor(sources.life, event)),
    ...ordinaryMessages.map((message) => sourceFor(sources.message, message)),
  ];
  const coverage = assessCoverage(
    new Set([
      ...lifeEvents.map((event) => event.residentId),
      ...ordinaryMessages.map((message) => message.authorId),
    ]).size,
    new Set(publicSources.map((source) => source.key)).size,
    publicSources.map((source) => source.createdAt),
    Number(publicCount > 0) + Number(ordinaryCount > 0),
  );
  return {
    category: 'public-life',
    statement: `当日公共事件 ${publicCount} 条（${publicPercent}%），普通生活 ${ordinaryCount} 条（${ordinaryPercent}%）。`,
    sourceKeys: uniqueSourceKeys(publicSources),
    confidence: coverage.confidence,
    limitations: ['公共事件取公共日志及 event 类生活事件，普通生活取其余生活事件和居民消息。'],
    findingClaim: total > 0
      ? `当日可见记录包含公共事件 ${publicCount} 条（${publicPercent}%）、普通生活 ${ordinaryCount} 条（${ordinaryPercent}%）。`
      : '当日快照未记录到公共事件或普通生活记录。',
    alternativeExplanation: '公共日志与普通生活消息的记录密度可能不同。',
    coverageScore: coverage.score,
  };
}

function evidenceSortKey(entry: EvidenceDraft, sourceRanks: ReadonlyMap<string, number>) {
  let rank = Number.POSITIVE_INFINITY;
  for (const key of entry.sourceKeys) rank = Math.min(rank, sourceRanks.get(key) ?? Infinity);
  return rank;
}

export function buildSocialEvidence(
  snapshot: BroadcastSnapshot,
  now = Date.now(),
): SocialEvidenceBundle {
  const messages = snapshot.dailyMessages
    .filter((message) => isCurrentDay(message.createdAt, now));
  const semanticMessageText = new Map(messages.map((message) => [
    message,
    filterLegacyExperimentClauses(message.text),
  ]));
  const semanticMessages = messages.filter(
    (message) => (semanticMessageText.get(message) ?? '').length > 0,
  );
  const lifeEvents = (snapshot.dailyLifeEvents ?? [])
    .filter((event) => isCurrentDay(event.createdAt, now))
    .map((event) => ({
      ...event,
      text: filterLegacyExperimentClauses(event.text),
    }))
    .filter((event) => event.text.length > 0);
  const publicLogs = snapshot.logs
    .filter((log) => log.kind !== 'conversation' && isCurrentDay(log.createdAt, now))
    .map((log) => ({
      ...log,
      text: filterLegacyExperimentClauses(log.text),
    }))
    .filter((log) => log.text.length > 0);
  const sources = buildEvidenceSources(messages, lifeEvents, publicLogs, semanticMessageText);
  messages.sort((left, right) =>
    compareSource(sourceFor(sources.message, left), sourceFor(sources.message, right))
  );
  lifeEvents.sort((left, right) =>
    compareSource(sourceFor(sources.life, left), sourceFor(sources.life, right))
  );
  publicLogs.sort((left, right) =>
    compareSource(sourceFor(sources.log, left), sourceFor(sources.log, right))
  );

  const allSources = [
    ...messages.map((message) => sourceFor(sources.message, message)),
    ...lifeEvents.map((event) => sourceFor(sources.life, event)),
    ...publicLogs.map((log) => sourceFor(sources.log, log)),
    ...snapshot.residentActivity
      .filter((resident) => !resident.observerControlled)
      .map((resident) => ({
        key: `resident:${safeKeyPart(resident.residentId)}`,
        createdAt: Number.POSITIVE_INFINITY,
        text: '',
      })),
  ].sort(compareSource);
  const sourceRanks = new Map(allSources.map((source, index) => [source.key, index]));
  const coverageSourceKey = `snapshot-day:${shanghaiDayKey(now)}`;
  const drafts = [
    buildNetworkDraft(snapshot, messages, sources),
    buildActivityDraft(lifeEvents, sources),
    buildInstitutionDraft(lifeEvents, sources),
    buildRelationshipDraft(semanticMessages, lifeEvents, sources),
    buildObserverDraft(messages, lifeEvents, publicLogs, sources),
    buildPublicLifeDraft(semanticMessages, lifeEvents, publicLogs, sources),
  ];
  for (const draft of drafts) {
    if (draft.sourceKeys.length === 0) draft.sourceKeys = [coverageSourceKey];
  }
  drafts.sort((left, right) =>
    evidenceSortKey(left, sourceRanks) - evidenceSortKey(right, sourceRanks)
      || categoryOrder[left.category] - categoryOrder[right.category],
  );

  const evidence = drafts.map(({ findingClaim: _claim, alternativeExplanation: _alternative, coverageScore: _coverage, ...entry }, index) => ({
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
      right.draft.coverageScore - left.draft.coverageScore
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
      '证据编号在确定性排序后单调分配；sourceKeys 对应输入快照记录；空类目使用 snapshot-day 覆盖边界键，它不是原始记录键。',
      '置信度与规则发现排序依据不同居民、不同来源、时间跨度和覆盖类别，不按重复命中次数加权。',
      '只描述当日可见结构，不作人物心理或单次事件效果判断。',
    ],
  };
}
