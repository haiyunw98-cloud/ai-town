export type EvidenceCategory =
  | 'interaction-network'
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

export type SocialObservationFallbackReason =
  | '模型不可用'
  | '输出无效'
  | '配置非本地';

export type SocialObservation = {
  source: 'model' | 'fallback';
  fallbackReason?: SocialObservationFallbackReason;
  findings: AnalysisFinding[];
  limitations: string[];
  followUps: string[];
};
