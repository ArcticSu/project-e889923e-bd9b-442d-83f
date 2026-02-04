/**
 * Agent streaming chat: minimal implementation
 * Extracted streaming logic, without tools / business prompts
 */

import { gateway } from '@ai-sdk/gateway';
import type { LanguageModelV1 } from '@ai-sdk/provider';

const AI_GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL ?? 'openai/gpt-4o-mini';

/**
 * Get model for streamText (via Vercel AI Gateway)
 * Missing env will throw at runtime, API layer validates and returns clear error
 */
export function getAgentModel(): LanguageModelV1 {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Missing AI_GATEWAY_API_KEY. Set it in .env (see .env.example).'
    );
  }
  return gateway(AI_GATEWAY_MODEL);
}
