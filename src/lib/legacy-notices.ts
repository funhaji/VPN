import { encryptCatalogPayload } from "@/lib/client-catalog";
import { legacyNoticeEntries } from "@/lib/legacy-notice-entries";
let response: ReturnType<typeof encryptCatalogPayload> | undefined;

export function legacyUpdateNotices() {
  // No connection profile: these entries must never probe a real or local host.
  return response ??= encryptCatalogPayload({ servers: legacyNoticeEntries() });
}
