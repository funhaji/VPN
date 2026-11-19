import { unstable_cache, revalidateTag } from "next/cache";
import { z } from "zod";
import { getSetting, setSetting } from "@/lib/db";

const platformRule = z.object({
  minimumBuild: z.number().int().nonnegative().default(0),
  blockedBuilds: z.array(z.number().int().nonnegative()).max(500).default([]),
  disabled: z.boolean().default(false),
});

export const accessPolicySchema = z.object({
  legacyEnabled: z.boolean(),
  allServersRemoved: z.boolean(),
  removalGeneration: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  android: platformRule,
  windows: platformRule,
  messageEn: z.string().max(500),
  messageFa: z.string().max(500),
});
export type AccessPolicy = z.infer<typeof accessPolicySchema>;
export const defaultAccessPolicy: AccessPolicy = {
  legacyEnabled: true,
  allServersRemoved: false,
  android: { minimumBuild: 0, blockedBuilds: [], disabled: false },
  windows: { minimumBuild: 0, blockedBuilds: [], disabled: false },
  messageEn: "Update Astro VPN to continue.",
  messageFa: "برای ادامه، برنامه آسترو وی‌پی‌ان را به‌روزرسانی کنید.",
};
const POLICY_TAG = "client-access-policy";

// Shared cache: the legacy disabled path never reads/decrypts server records.
export const getAccessPolicy = unstable_cache(async (): Promise<AccessPolicy> => {
  const raw = await getSetting("client_access_policy_v2");
  return raw === null ? defaultAccessPolicy : accessPolicySchema.parse(JSON.parse(raw));
}, [POLICY_TAG], { revalidate: 30, tags: [POLICY_TAG] });

export async function saveAccessPolicy(policy: AccessPolicy): Promise<void> {
  await setSetting("client_access_policy_v2", JSON.stringify(accessPolicySchema.parse(policy)));
  revalidateTag(POLICY_TAG, { expire: 0 });
}
