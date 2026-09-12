import { api } from "@/lib/api";

export type VersionInfo = {
  packageName?: string;
  currentVersion: string;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  updateSupported?: boolean;
  checkedAt?: string;
  serverTime?: string;
};

export type UpdateVersionResult = VersionInfo & {
  success?: boolean;
  code?: string;
  message?: string;
  restartRequired?: boolean;
};

export async function fetchVersion(): Promise<VersionInfo> {
  const { data } = await api.get<VersionInfo>("/version");
  return data;
}

export async function updateVersion(): Promise<UpdateVersionResult> {
  const { data } = await api.post<UpdateVersionResult>("/update");
  return data;
}
