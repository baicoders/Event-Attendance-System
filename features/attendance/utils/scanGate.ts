type ScanIdentity = { value: string; eventId?: string; mode?: "TIME_IN" | "TIME_OUT" };

/** Suppress one continuously visible QR until a different code or context appears. */
export function createScanGate() {
  let previous: ScanIdentity | null = null;
  return {
    accept(scan: ScanIdentity) {
      const value = scan.value.trim();
      if (!value) return false;
      if (previous?.value === value && previous.eventId === scan.eventId && previous.mode === scan.mode) return false;
      previous = { ...scan, value };
      return true;
    },
  };
}
