import { deriveFernetKey, encryptFernet } from "@/lib/fernet";
import { getClientCatalogSecret } from "@/lib/env";

export type CatalogWireFormat = {
  v: 1;
  enc: "fernet-aes128-cbc-hmac";
  issuedAt: string;
  payload: string;
};

let cachedKey: Buffer | null = null;

const getCatalogKey = (): Buffer => {
  if (!cachedKey) {
    cachedKey = deriveFernetKey(getClientCatalogSecret());
  }
  return cachedKey;
};

export const encryptCatalogPayload = (plainObject: unknown): CatalogWireFormat => {
  const json = JSON.stringify(plainObject);
  return {
    v: 1,
    enc: "fernet-aes128-cbc-hmac",
    issuedAt: new Date().toISOString(),
    payload: encryptFernet(json, getCatalogKey()),
  };
};
