import { readFileSync } from 'node:fs';
import { EMBEDDING_DIMENSION } from './embeddingDimension';

describe('embedding schema configuration', () => {
  test('uses a schema-safe static dimension for the local embedding model', () => {
    expect(EMBEDDING_DIMENSION).toBe(1024);
  });

  test('does not import environment-aware LLM configuration while evaluating the schema', () => {
    const schemaSource = readFileSync('convex/agent/schema.ts', 'utf8');
    expect(schemaSource).not.toMatch(/util\/(llm|llmConfig)/);
    expect(schemaSource).toContain("from '../util/embeddingDimension'");
  });
});
