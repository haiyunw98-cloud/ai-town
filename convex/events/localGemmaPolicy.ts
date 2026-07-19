import type { LLMConfig } from '../util/llm';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * Paid and remote providers are never eligible for daily-event generation.
 * Keep this as the single boundary used by themes and resident decisions.
 */
export function isLocalDailyEventGemma(config: LLMConfig): boolean {
  if (config.provider !== 'ollama' || config.chatModel !== 'gemma4:12b') return false;
  try {
    const endpoint = new URL(config.url);
    if (
      endpoint.protocol !== 'http:' ||
      !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase()) ||
      endpoint.username !== '' ||
      endpoint.password !== ''
    ) {
      return false;
    }
    if (endpoint.port !== '') {
      const port = Number(endpoint.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) return false;
    }
    return true;
  } catch {
    return false;
  }
}
