"use client";

import { useState } from "react";
import { useCSVReader, formatFileSize } from "react-papaparse";
import { Upload, FileSpreadsheet, X, Loader2, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/globals/components/shad-cn/card";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/globals/components/shad-cn/alert";
import { toastDanger, toastSuccess } from "@/globals/components/shared/toasts";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/globals/utils/queryKeys";

type Props = {
  onImportSuccess: (count: number) => void;
};

export default function StudentImporter({ onImportSuccess }: Props) {
  const { CSVReader } = useCSVReader();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedData, setParsedData] = useState<any[] | null>(null);

  const handleImport = async () => {
    if (!parsedData) return;

    setIsProcessing(true);
    try {
      const response = await fetch("/api/bulk-import/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedData),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toastSuccess(data.message || "Import completed successfully.");
        // A bulk import changes the roster (and thus counts, event
        // eligibility, and reports); refresh their caches.
        queryClient.invalidateQueries({ queryKey: queryKeys.students.all() });
        queryClient.invalidateQueries({ queryKey: queryKeys.audience.all() });
        queryClient.invalidateQueries({ queryKey: ["stats", "students"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.events.all() });
        queryClient.invalidateQueries({ queryKey: queryKeys.records.all() });
        onImportSuccess(data.data?.count ?? 0);
        setParsedData(null);
      } else {
        // Handle Zod or Prisma errors from the API
        const errorMsg = data.message || "Bulk import failed.";
        toastDanger(errorMsg);
        console.error("Import Error Detail:", data.error || data.issues);
      }
    } catch (error) {
      toastDanger("Network error. Please check your connection.");
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetState = (removeFileProps: any, e: any) => {
    removeFileProps.onClick(e);
    setParsedData(null);
  };

  return (
    <CSVReader
      config={{ header: true, skipEmptyLines: true }}
      onUploadAccepted={(results: any) => setParsedData(results.data)}
    >
      {({ getRootProps, acceptedFile, ProgressBar, getRemoveFileProps }: any) => (
        <Card className="col-span-2 shadow-sm border-slate-200 overflow-hidden">
          <CardHeader className="bg-slate-50/50 border-b">
            <CardTitle className="text-lg font-bold text-slate-800">Student Masterlist Import</CardTitle>
            <CardDescription>
              Upload a CSV file to bulk create or update student records.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            {!acceptedFile ? (
              <div
                {...getRootProps()}
                className="group relative border-2 border-dashed border-slate-200 rounded-2xl p-12 transition-all hover:bg-slate-50 hover:border-indigo-300 flex flex-col items-center justify-center space-y-4 cursor-pointer"
              >
                <div className="p-4 bg-indigo-50 rounded-full text-indigo-600 transition-transform group-hover:scale-110">
                  <Upload className="w-8 h-8" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700">Click to upload or drag and drop</p>
                  <p className="text-xs text-slate-500 mt-1">CSV files only (Max 10MB)</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between p-4 border rounded-xl bg-emerald-50/30 border-emerald-100">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white rounded-lg border border-emerald-100 shadow-sm text-emerald-600">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{acceptedFile.name}</p>
                      <p className="text-xs text-slate-500 font-medium">
                        {formatFileSize(acceptedFile.size)} • {parsedData?.length ?? 0} rows detected
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-slate-400 hover:text-red-500 hover:bg-red-50"
                    onClick={(e) => resetState(getRemoveFileProps(), e)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <ProgressBar className="bg-emerald-500" />
              </div>
            )}

            <Alert className="bg-amber-50/50 border-amber-100 text-amber-900">
              <Info className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-[0.65rem] font-bold uppercase tracking-widest text-amber-700">
                Slug-Based Matching
              </AlertTitle>
              <AlertDescription className="text-xs leading-relaxed opacity-80 inline">
                Ensure columns for <code className="font-bold">section</code>, <code className="font-bold">department</code>, and <code className="font-bold">house</code> use valid system slugs.
              </AlertDescription>
            </Alert>
          </CardContent>

          <CardFooter className="flex justify-between items-center bg-slate-50/50 border-t p-4 px-6">
            <p className="text-[10px] text-slate-400 font-medium max-w-[260px]">
              Single transaction — invalid rows roll back the entire batch. A full
              2,000-student roster can take up to a minute to import; leave the tab open.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                disabled={!acceptedFile || isProcessing}
                onClick={(e) => resetState(getRemoveFileProps(), e)}
                className="border-slate-200"
              >
                Reset
              </Button>
              <Button
                disabled={!acceptedFile || isProcessing}
                onClick={handleImport}
                className="min-w-[140px] bg-indigo-600 hover:bg-indigo-700 shadow-md"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Execute Import
                  </>
                )}
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}
    </CSVReader>
  );
}
