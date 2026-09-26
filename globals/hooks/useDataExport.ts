import { useCallback, useState } from "react";
import { fetchApi } from "@/globals/utils/api";
import { toastDanger } from "@/globals/components/shared/toasts";
import { escapeCsvFormulas } from "@/globals/utils/csvExport";

type UseDataExportParams<T, TRow extends object = Record<string, unknown>> = {
  /** API endpoint to fetch export data from */
  apiUrl: string;
  /** Filename without extension */
  filename: string;
  /**
   * Reshapes each API row into the row the CSV should contain.
   *
   * Without one, the CSV is whatever JSON the endpoint returns — which is how the
   * attendance export used to emit `[object Object]` for its nested `section`
   * relation and raw ISO strings for every timestamp. Map to flat, human-labelled
   * keys (the keys become the CSV header) and format dates here.
   */
  mapRow?: (row: T) => TRow;
};

type UseDataExportResult = {
  isExporting: boolean;
  exportData: () => Promise<void>;
};

/**
 * Prevents CSV formula injection: values starting with = + - @ (or tab/CR)
 * would execute as formulas when the file is opened in Excel/Sheets.
 */
function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function useDataExport<T, TRow extends object = Record<string, unknown>>({
  apiUrl,
  filename,
  mapRow,
}: UseDataExportParams<T, TRow>): UseDataExportResult {
  const [isExporting, setIsExporting] = useState(false);

  const exportData = useCallback(async () => {
    try {
      setIsExporting(true);

      const response = await fetchApi<T[]>(apiUrl);
      const rows: (T | TRow)[] = mapRow ? response.map(mapRow) : response;

      // Loaded on demand so the CSV library stays out of every page bundle.
      // escapeCsvFormulas runs on the *mapped* rows so a formula smuggled into a
      // student's name is still neutralized after reshaping.
      const { jsonToCSV } = await import("react-papaparse");
      const csv = jsonToCSV(escapeCsvFormulas(rows));
      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      });

      const datedFilename = `${filename}_${new Date()
        .toISOString()
        .split("T")[0]}.csv`;

      downloadFile(blob, datedFilename);
    } catch (error) {
      // Surface failures instead of letting the rejection escape unhandled.
      toastDanger(
        "Export failed",
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsExporting(false);
    }
  }, [apiUrl, filename, mapRow]);

  return { isExporting, exportData };
}
