/** Device memory / storage helpers for the settings panel. */

export type DeviceResourceInfo = {
  deviceMemoryGb: number | null;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  storageFreeBytes: number | null;
  opfs: boolean;
  persisted: boolean | null;
  webGpu: boolean;
};

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export async function getDeviceResourceInfo(): Promise<DeviceResourceInfo> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const deviceMemoryGb =
    nav && typeof (nav as Navigator & { deviceMemory?: number }).deviceMemory ===
      "number"
      ? (nav as Navigator & { deviceMemory: number }).deviceMemory
      : null;

  let storageUsageBytes: number | null = null;
  let storageQuotaBytes: number | null = null;
  let persisted: boolean | null = null;
  if (nav?.storage?.estimate) {
    try {
      const est = await nav.storage.estimate();
      storageUsageBytes =
        typeof est.usage === "number" ? est.usage : null;
      storageQuotaBytes =
        typeof est.quota === "number" ? est.quota : null;
    } catch {
      // private mode / unsupported
    }
  }
  if (nav?.storage?.persisted) {
    try {
      persisted = await nav.storage.persisted();
    } catch {
      persisted = null;
    }
  }

  let webGpu = false;
  const isolated =
    typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
  const gpu = nav
    ? (nav as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } })
        .gpu
    : undefined;
  if (isolated && typeof SharedArrayBuffer !== "undefined" && gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      webGpu = !!adapter;
    } catch {
      webGpu = false;
    }
  }

  const storageFreeBytes =
    storageUsageBytes != null && storageQuotaBytes != null
      ? Math.max(0, storageQuotaBytes - storageUsageBytes)
      : null;

  return {
    deviceMemoryGb,
    storageUsageBytes,
    storageQuotaBytes,
    storageFreeBytes,
    opfs: !!(nav?.storage && "getDirectory" in nav.storage),
    persisted,
    webGpu,
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
