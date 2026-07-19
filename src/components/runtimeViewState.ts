export type ResidentRuntimeViewState = {
  dossierStatus: 'available' | 'unavailable';
  snapshotStatus: 'current' | 'paused' | 'unavailable';
  relationshipsStatus?: 'live' | 'snapshot' | 'partial' | 'initializing';
  relationshipCount?: number;
  expectedRelationshipCount?: number;
};

export function residentStatusBanners(_state: ResidentRuntimeViewState) {
  if (_state.dossierStatus === 'unavailable') {
    return {
      top: '居民运行身份暂不可用，正在等待完整运行映射。',
      relationships: null,
    };
  }
  return {
    top: _state.snapshotStatus === 'paused'
      ? '已暂停，以下为暂停前账本；居民不会继续推进。'
      : null,
    relationships: _state.relationshipsStatus === 'partial'
      ? `关系网络尚未完整：已载入 ${_state.relationshipCount ?? 0} / ${_state.expectedRelationshipCount ?? 8} 位居民。`
      : null,
  };
}

export type InstitutionRuntimeViewState = {
  institutionStatus: 'available' | 'unavailable';
  snapshotStatus: 'current' | 'paused' | 'unavailable';
  runtimeStatus?: 'live' | 'snapshot' | 'initializing';
};

export function institutionStatusBanner(_state: InstitutionRuntimeViewState) {
  if (_state.institutionStatus === 'unavailable') {
    return '这处机构不属于当前可用的小镇运行世界，无法读取其账本。';
  }
  if (_state.snapshotStatus === 'paused') {
    return '已暂停，以下为暂停前账本；机构不会继续推进。';
  }
  if (_state.runtimeStatus === 'initializing') {
    return '机构运行态正在初始化；用途与服务来自小镇定义，账目数值暂不估算。';
  }
  return null;
}
