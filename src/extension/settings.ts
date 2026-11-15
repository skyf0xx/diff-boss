import { z } from "zod";

export const SettingsSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  maxAttempts: z.number().int().min(1).max(10),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { provider: "claude", model: "sonnet", maxAttempts: 3 };

export class SettingsError extends Error {
  override readonly name = "SettingsError";
}

export interface ConfigReader {
  get<T>(key: string): T | undefined;
}

export function readSettings(config: ConfigReader): Settings {
  const parsed = SettingsSchema.safeParse({
    provider: config.get("provider") ?? DEFAULT_SETTINGS.provider,
    model: config.get("model") ?? DEFAULT_SETTINGS.model,
    maxAttempts: config.get("maxAttempts") ?? DEFAULT_SETTINGS.maxAttempts,
  });
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `diffBoss.${i.path.join(".")}: ${i.message}`).join("; ");
    throw new SettingsError(`Invalid diff-boss settings (${detail})`);
  }
  return parsed.data;
}
