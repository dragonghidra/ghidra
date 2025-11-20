import { z } from 'zod';

export const AgentRunCreateSchema = z.object({
  projectId: z.string().min(1),
  profileId: z.string().min(1),
  connectorId: z.string().min(1),
  prompt: z.string().min(1),
  metadata: z.record(z.any()).optional(),
  schedule: z.object({
    startAt: z.string().datetime().optional(),
    cron: z.string().optional()
  }).optional()
});

export const AgentCommandSchema = z.object({
  projectId: z.string().min(1),
  runId: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(['command', 'interrupt']).default('command')
});

export const AgentRunFiltersSchema = z.object({
  projectId: z.string().min(1),
  status: z.string().optional(),
  connectorId: z.string().optional(),
  limit: z.number().min(1).max(200).default(50)
});

export type AgentRunCreateInput = z.infer<typeof AgentRunCreateSchema>;
export type AgentCommandInput = z.infer<typeof AgentCommandSchema>;
export type AgentRunFiltersInput = z.infer<typeof AgentRunFiltersSchema>;
