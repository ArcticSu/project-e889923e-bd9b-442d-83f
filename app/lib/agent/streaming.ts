/**
 * Agent 流式聊天：最小实现
 * 从 fashion 抽离的“流式返回”逻辑，不含 tools / 业务 prompt
 */

import { gateway } from '@ai-sdk/gateway';
import type { LanguageModelV1 } from '@ai-sdk/provider';

const AI_GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL ?? 'openai/gpt-4o-mini';

/**
 * 获取用于 streamText 的模型（走 Vercel AI Gateway）
 * 缺 env 时会在运行时报错，由 API 层做校验并返回清晰错误
 */
export function getAgentModel(): LanguageModelV1 {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Missing AI_GATEWAY_API_KEY. Set it in .env (see .env.example).'
    );
  }
  return gateway(AI_GATEWAY_MODEL);
}
