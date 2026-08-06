type VoiceCandidate = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default' | 'localService'>;

const preferredFemaleVoices = ['Tingting', 'Flo', 'Sandy', 'Shelley'];

export function selectLocalJudgeVoice<T extends VoiceCandidate>(voices: T[]): T | undefined {
  if (voices.length === 0) return undefined;
  const local = voices.filter((candidate) => candidate.localService);
  const pool = local.length > 0 ? local : voices;
  for (const name of preferredFemaleVoices) {
    const match = pool.find((candidate) => candidate.name === name);
    if (match) return match;
  }
  return pool.find((candidate) => /^zh(?:-|_)/i.test(candidate.lang)) ??
    pool.find((candidate) => candidate.default) ?? pool[0];
}

export function judgeSpeechKey(
  sessionId: string,
  phase: string,
  round: number,
  line: string,
) {
  return `${sessionId}:${round}:${phase}:${line}`;
}
