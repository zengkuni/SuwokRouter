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

export type CodeBuddyTokenRow = {
  credentialToken?: string;
  accessToken?: string;
  refreshToken?: string;
  valid: boolean | null;
  checking?: boolean;
  msg?: string;
};

export function parseCodeBuddyTokenLines(text: string): CodeBuddyTokenRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      if (parts.length === 1 && parts[0]) {
        return { credentialToken: parts[0], valid: null };
      }
      if (parts.length === 2 && parts[0] && parts[1]) {
        return { accessToken: parts[0], refreshToken: parts[1], valid: null };
      }
      return {
        valid: false,
        msg: "Use one token or accessToken|refreshToken",
      };
    });
}
