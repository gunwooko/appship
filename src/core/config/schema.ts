import { z } from 'zod';

// Schema for appship.yml (TRD §4.3). API keys are never stored here —
// providers read them from environment variables.

export const aiProviderSchema = z.enum([
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'openai-compatible',
]);

export const appshipConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    audience: z.array(z.string()).default([]),
    requires_login: z.boolean().optional(),
    collects_personal_data: z.boolean().optional(),
  }),
  platforms: z.object({
    ios: z
      .object({
        bundle_id: z.string().min(1),
      })
      .optional(),
    android: z
      .object({
        package_name: z.string().min(1),
      })
      .optional(),
  }),
  stores: z.object({
    default_locale: z.string().default('en-US'),
    locales: z.array(z.string()).min(1).default(['en-US']),
    countries: z.array(z.string()).default([]),
  }),
  ai: z
    .object({
      provider: aiProviderSchema.default('anthropic'),
      model: z.string().optional(),
      tone: z.string().default('friendly'),
    })
    .default({}),
  privacy: z
    .object({
      send_source_code_to_ai: z.boolean().default(false),
      require_manual_confirmation: z.boolean().default(true),
      scan_dependencies: z.boolean().default(true),
      scan_source_code: z.boolean().default(true),
    })
    .default({}),
});

export type AppshipConfig = z.infer<typeof appshipConfigSchema>;
