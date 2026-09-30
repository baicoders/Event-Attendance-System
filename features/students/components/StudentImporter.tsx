"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/globals/components/shad-cn/card";
import { useAuth, type AuthUser } from "@/globals/contexts/AuthContext";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";
import { queryKeys } from "@/globals/utils/queryKeys";
import type { GroupCategory } from "@/globals/schemas/groupSchema";
import GroupFormSheet from "@/features/settings/components/GroupFormSheet";
import { MAX_IMPORT_BYTES, importPreviewSchema, importCommitResultSchema, importRequestSchema, type ImportPreview, type ImportCounts } from "../import/contract";
import { parseStudentImportCsv, hasStructuralCsvErrors } from "../import/csv";
import ImportSourceStep, { type ImportSource } from "./ImportSourceStep";
import ImportReviewStep from "./ImportReviewStep";
import ImportResult from "./ImportResult";

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const payloadFor = (source: ImportSource) => ({ v: 1 as const, fileName: source.fileName, sourceHash: source.sourceHash, csv: source.csv });

type Rejection = { success: false; message: string; code: string; outcome: "REJECTED" };
function isRejection(value: unknown): value is Rejection {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return result.success === false && result.outcome === "REJECTED" && typeof result.message === "string" && typeof result.code === "string" && result.code.length > 0;
}

function AuthorizedImporter({ actor, onImportSuccess }: { actor: AuthUser; onImportSuccess?: (count: number) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { refresh } = useAuth();
  const generation = useRef(0);
  const mounted = useRef(true);
  const committing = useRef(false);
  const [source, setSource] = useState<ImportSource | null>(null);
  const activeSource = useRef<ImportSource | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [largeAcknowledged, setLargeAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<"source" | "success" | "unknown">("source");
  const [result, setResult] = useState<{ counts: ImportCounts; committedAt: string } | null>(null);
  const [groupDefaults, setGroupDefaults] = useState<{ slug: string; category: GroupCategory; generation: number; source: ImportSource } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    if (!preview) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [preview]);
  const current = (version: number) => mounted.current && generation.current === version;
  const reset = () => {
    generation.current += 1;
    activeSource.current = null;
    setSource(null); setPreview(null); setError(""); setResult(null); setOutcome("source"); setReading(false); setBusy(false); setLargeAcknowledged(false); setGroupDefaults(null);
  };
  const resetAfterOutcome = async () => {
    if (outcome === "unknown") {
      const version = generation.current;
      const confirmed = await confirm({ title: "Replace an import with an unknown outcome?", description: "The server may already have committed this file. Check the current roster before starting a new review. Replacing the file clears the submitted source from this tab." });
      if (!confirmed || !current(version)) return;
    }
    reset();
  };

  const readFile = async (file: File) => {
    if (committing.current) return;
    reset();
    const version = generation.current;
    setReading(true);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("This file exceeds the 10 MiB technical file limit. Split the source file before continuing.");
      if (!file.name.toLowerCase().endsWith(".csv")) throw new Error("Choose a CSV file using the canonical student-import format.");
      const bytes = await file.arrayBuffer();
      // Preserve a UTF-8 BOM in the exact source text/hash; the parser handles it.
      const csv = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv));
      const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const parsed = parseStudentImportCsv(csv);
      const next: ImportSource = { fileName: file.name, size: file.size, csv, sourceHash, rowCount: parsed.rows.length, errors: parsed.errors, structurallyValid: !hasStructuralCsvErrors(parsed.errors) };
      const requestValidation = importRequestSchema.safeParse(payloadFor(next));
      if (!requestValidation.success) {
        next.structurallyValid = false;
        next.errors = [...next.errors, ...requestValidation.error.issues.map(issue => ({ code: "INVALID_REQUEST", message: `${issue.path.join(".")}: ${issue.message}` }))];
      }
      if (utf8Bytes(JSON.stringify(payloadFor(next))) > MAX_IMPORT_BYTES) {
        next.structurallyValid = false;
        next.errors = [...next.errors, { code: "PAYLOAD_TOO_LARGE", message: "The complete JSON request exceeds the 10 MiB technical transport limit. JSON escaping and file metadata count toward this limit. Split the source file." }];
      }
      if (current(version)) { activeSource.current = next; setSource(next); }
    } catch (failure) {
      if (current(version)) setError(failure instanceof TypeError ? "The file is not readable UTF-8 CSV. Save it as UTF-8 and replace the file." : failure instanceof Error ? failure.message : "Unable to read this CSV file.");
    } finally {
      if (current(version)) setReading(false);
    }
  };

  const review = async () => {
    if (!source || !source.structurallyValid || committing.current) return;
    const version = ++generation.current;
    setBusy(true); setError(""); setPreview(null);
    try {
      const body = JSON.stringify(payloadFor(source));
      if (utf8Bytes(body) > MAX_IMPORT_BYTES) throw new Error("The complete request exceeds the 10 MiB technical transport limit.");
      const response = await fetch("/api/students/imports/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" });
      const envelope: unknown = await response.json();
      if (!current(version)) return;
      if (isRejection(envelope)) {
        setError(envelope.message);
        if (["UNAUTHORIZED", "PASSWORD_CHANGE_REQUIRED", "INACTIVE_USER", "FORBIDDEN"].includes(envelope.code)) void refresh();
        return;
      }
      if (!response.ok || !envelope || typeof envelope !== "object" || !("success" in envelope) || envelope.success !== true || !("data" in envelope)) throw new Error("The server could not prepare a review. No import was sent. Try reviewing again.");
      const validated = importPreviewSchema.safeParse(envelope.data);
      if (!validated.success) throw new Error("The review response was invalid. No import was sent. Try reviewing again.");
      setPreview(validated.data); setNow(Date.now());
    } catch (failure) {
      if (current(version)) setError(failure instanceof Error ? failure.message : "Unable to prepare the review. No import was sent.");
    } finally {
      if (current(version)) setBusy(false);
    }
  };

  const commit = async () => {
    if (!source || !preview?.previewToken || preview.counts.blocked || Date.now() >= Date.parse(preview.expiresAt) || committing.current) return;
    committing.current = true;
    setBusy(true);
    const version = generation.current;
    // Freeze the exact reviewed command before any asynchronous confirmation.
    const frozen = JSON.stringify({ ...payloadFor(source), previewToken: preview.previewToken });
    try {
      if (utf8Bytes(frozen) > MAX_IMPORT_BYTES) {
        setError("This reviewed command exceeds the 10 MiB complete-request limit. Split the CSV and review it again.");
        return;
      }
      const { counts } = preview;
      const accepted = await confirm({ title: `Import ${source.fileName}?`, description: `${actor.name} (${actor.email}) is confirming ${counts.total.toLocaleString()} rows: ${counts.create.toLocaleString()} created, ${counts.update.toLocaleString()} updated, ${counts.unchanged.toLocaleString()} unchanged. Students absent from this CSV will remain untouched. Group changes may affect event eligibility and reports.` });
      if (!accepted || !current(version)) return;
      if (Date.now() >= Date.parse(preview.expiresAt)) { setError("This review expired while confirmation was open. Refresh the review before importing."); return; }
      setError("");
      try {
        const response = await fetch("/api/students/imports/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: frozen, cache: "no-store" });
        const envelope: unknown = await response.json();
        if (!current(version)) return;
        if (isRejection(envelope)) {
          setError(`${envelope.message} No changes were applied by this request.`); setPreview(null);
          if (["UNAUTHORIZED", "PASSWORD_CHANGE_REQUIRED", "INACTIVE_USER", "FORBIDDEN"].includes(envelope.code)) void refresh();
          return;
        }
        if (!response.ok || !envelope || typeof envelope !== "object" || !("success" in envelope) || envelope.success !== true || !("data" in envelope)) { setOutcome("unknown"); return; }
        const validated = importCommitResultSchema.safeParse(envelope.data);
        if (!validated.success || validated.data.counts.blocked !== 0 ||
            !(["total", "create", "update", "unchanged", "blocked"] as const).every(key => validated.data.counts[key] === counts[key])) {
          setOutcome("unknown"); return;
        }
        setResult(validated.data); setOutcome("success"); setPreview(null);
        for (const key of [queryKeys.students.all(), queryKeys.audience.all(), queryKeys.events.all(), queryKeys.records.all(), queryKeys.reports.all(), ["stats", "students"]]) void queryClient.invalidateQueries({ queryKey: key });
        // An optional consumer callback cannot change a confirmed server outcome.
        try { onImportSuccess?.(validated.data.counts.total); } catch { /* Keep the success panel. */ }
      } catch {
        if (current(version)) setOutcome("unknown");
      }
    } finally {
      committing.current = false;
      if (current(version)) setBusy(false);
    }
  };

  return <Card className="min-w-0"><CardHeader><CardTitle>Student masterlist import</CardTitle><CardDescription>Review an authoritative CSV before changing student records.</CardDescription></CardHeader><CardContent className="space-y-5">
    {error && <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">{error}</p>}
    {busy && <p role="status">{committing.current ? "Confirming import. Leave this tab open…" : "Preparing authoritative review…"}</p>}
    {outcome !== "source" && source ? <ImportResult result={outcome === "success" ? result : null} fileName={source.fileName} onAnother={() => void resetAfterOutcome()} /> : preview ? <ImportReviewStep preview={preview} busy={busy} expired={now >= Date.parse(preview.expiresAt)} onReview={() => void review()} onConfirm={() => void commit()} onReplace={reset} onCreateGroup={defaults => { if (source) setGroupDefaults({ ...defaults, generation: generation.current, source }); }} /> : <ImportSourceStep source={source} busy={busy || reading} reading={reading} largeAcknowledged={largeAcknowledged} onAcknowledge={() => setLargeAcknowledged(true)} onFile={file => void readFile(file)} onReset={reset} onReview={() => void review()} />}
    {groupDefaults && <GroupFormSheet isOpen createDefaults={groupDefaults} onClose={() => setGroupDefaults(opened => opened === groupDefaults ? null : opened)} onCreated={() => {
      // Group creation is durable even after Cancel, but its late completion
      // must never revive the review of a replaced file or close a newer form.
      if (current(groupDefaults.generation) && activeSource.current === groupDefaults.source) void review();
    }} />}
  </CardContent></Card>;
}

export default function StudentImporter({ onImportSuccess }: { onImportSuccess?: (count: number) => void }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p role="status">Checking import access…</p>;
  if (!user || user.role !== "ADMIN" || user.status !== "ACTIVE" || user.mustChangePassword) return <p role="alert">A usable administrator account is required to import the student masterlist.</p>;
  return <AuthorizedImporter key={`${user.id}:${user.credentialVersion ?? 0}`} actor={user} onImportSuccess={onImportSuccess} />;
}
