import { z } from "zod";

/** Source IDs are stable across accounts and plugin reloads. Unknown IDs may be preconfigured. */
export const UsageConfigSchema = z.object({
  hiddenSourceIds: z.array(z.string().regex(/^[a-z][a-z0-9._-]*$/)).optional(),
});
