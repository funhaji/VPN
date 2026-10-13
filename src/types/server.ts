export type ProtocolOptions = {
  mux: boolean;
  fragment: boolean;
  sniffing: boolean;
  allowInsecure: boolean;
  extra: Record<string, string | number | boolean>;
};

export type EncryptedConfig = {
  version?: number;
  cipherText: string;
  salt?: string;
  iv: string;
  authTag: string;
};

export type L2tpAuthMode = "shared" | "custom" | "single";

export type ServerRecord = {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  country: string;
  isEnabled: boolean;
  options: ProtocolOptions;
  encryptedConfig: EncryptedConfig;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  accountCount?: number;
  l2tpAuthMode?: L2tpAuthMode;
};
