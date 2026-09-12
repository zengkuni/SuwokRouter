export type KiroAuthMode =
  | "builder-id"
  | "iam"
  | "api-key"
  | "import-token"
  | "cli-proxy";

export type BulkKeyRow = {
  name: string;
  apiKey: string;
  valid: boolean | null;
  checking?: boolean;
  msg?: string;
};
