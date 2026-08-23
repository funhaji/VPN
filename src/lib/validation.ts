import { z } from "zod";

const protocolOptionsSchema = z.object({
  mux: z.boolean().default(false),
  fragment: z.boolean().default(false),
  sniffing: z.boolean().default(false),
  allowInsecure: z.boolean().default(false),
  extra: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
});

export const serverInputSchema = z.object({
  name: z.string().trim().min(2).max(70),
  protocol: z.string().trim().min(2).max(40),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  country: z.string().trim().min(2).max(80),
  isEnabled: z.boolean().default(true),
  rawConfig: z.string().trim().min(2).max(100_000),
  options: protocolOptionsSchema,
});

export const updateServerSchema = serverInputSchema.partial().extend({
  id: z.string().uuid(),
});

export type ServerInput = z.infer<typeof serverInputSchema>;
