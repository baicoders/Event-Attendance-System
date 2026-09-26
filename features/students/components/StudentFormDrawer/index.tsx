import React, { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/globals/components/shad-cn/sheet";
import { Button } from "@/globals/components/shad-cn/button";
import { Student } from "@/globals/types/students";
import { ChevronRight, ChevronLeft, Save } from "lucide-react";
import StepIndicator from "./StepIndicator";
import PersonalInfoSection from "./PersonalInfoSection";
import AcademicSection from "./AcademicSection";
import GroupsSection from "./GroupsSection";
import { FormProvider, useForm } from "react-hook-form";
import {
  StudentFormValues,
  studentSchema,
} from "@/globals/schemas/studentSchema";
import { zodResolver } from "@hookform/resolvers/zod";
import { useConfirm } from "@/globals/contexts/ConfirmModalContext";

const FIELDS_TO_VALIDATE: Record<Step, (keyof StudentFormValues)[]> = {
  personal: ["id", "firstName", "lastName", "middleName"],
  academic: ["schoolLevel", "yearLevel"],
  groups: ["section", "house", "department", "program", "strand"],
};

interface Props {
  student?: Student;
  isOpen: boolean;
  onViewQR: () => void;
  onClose: () => void;
  onSubmit: (validatedFormData: StudentFormValues) => Promise<void> | void;
  saveError?: string | null;
  onReloadCurrent?: () => void;
}

export type Step = "personal" | "academic" | "groups";

export default function StudentFormDrawer({
  student,
  isOpen,
  onViewQR,
  onClose,
  onSubmit,
  saveError,
  onReloadCurrent,
}: Props) {
  const [step, setStep] = useState<Step>("personal");
  const [isSaving, setIsSaving] = useState(false);
  const confirm = useConfirm();
  const isEdit = !!student;

  const methods = useForm<StudentFormValues>({
    resolver: zodResolver(studentSchema),
    mode: "onChange",
    defaultValues: {
      id: "",
      firstName: "",
      lastName: "",
      middleName: "",
      schoolLevel: undefined,
      yearLevel: undefined,
      section: "",
      house: "",
      department: "",
      program: "",
      strand: "",
    },
  });
  const { reset, trigger, formState } = methods;

  useEffect(() => {
    if (!student) return;

    reset({
      id: student.id,
      lastName: student.lastName,
      firstName: student.firstName,
      middleName: student.middleName ?? "",
      schoolLevel: student.schoolLevel,
      yearLevel: student.yearLevel,
      section: student.section,
      department: student.department,
      house: student.house,
      program: student.program,
      strand: student.strand,
    });
  }, [student, reset]);

  const handleClose = useCallback(async () => {
    if (isSaving) return;
    if (formState.isDirty && !await confirm({
      title: "Discard student changes?",
      description: "Your unsaved entries will be lost.",
    })) return;
    setStep("personal");
    onClose();
  }, [confirm, isSaving, formState.isDirty, onClose]);

  const handleSave = methods.handleSubmit(async values => {
    if (isSaving) return;
    setIsSaving(true);
    try { await onSubmit(values); }
    catch { /* The host reports the error and the form retains its values. */ }
    finally { setIsSaving(false); }
  });

  const handleNext = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault(); // Prevent submission

      // Validate the fields in each step
      const isValid = await trigger(FIELDS_TO_VALIDATE[step], {
        shouldFocus: true,
      });
      if (!isValid) return;

      setStep(step === "personal" ? "academic" : "groups");
    },
    [step, trigger],
  );

  return (
    <Sheet open={isOpen} onOpenChange={open => { if (!open) void handleClose(); }}>
      <SheetContent className="flex flex-col w-full sm:max-w-md border-l-slate-200 bg-white p-0">
        <FormProvider {...methods}>
          <form
            onSubmit={event => { void handleSave(event); }}
            className="flex flex-col h-full"
          >
            {/* HEADER */}
            <SheetHeader className="p-6 border-b border-slate-100 bg-slate-50/50">
              <SheetTitle className="text-xl font-bold text-slate-800">
                {isEdit ? "Edit Student Profile" : "Register New Student"}
              </SheetTitle>
              <div className="flex justify-between items-center gap-2 mt-2">
                <StepIndicator current={step} />
                <Button type="button" onClick={onViewQR} disabled={isSaving}>View QR</Button>
              </div>
            </SheetHeader>

            {/* SCROLLABLE FORM AREA */}
            <div className="flex-1 overflow-y-auto px-6 space-y-8">
              {saveError && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
                {saveError}
                {onReloadCurrent && <button type="button" className="mt-2 block underline" onClick={onReloadCurrent}>Reload current version</button>}
              </div>}
              {step === "personal" && <PersonalInfoSection isEdit={isEdit} />}
              {step === "academic" && <AcademicSection />}
              {step === "groups" && <GroupsSection />}
            </div>

            {/* FOOTER ACTIONS */}
            <SheetFooter className="p-6 border-t border-slate-100 bg-slate-50/50 flex flex-row items-center justify-between sm:justify-between">
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => void handleClose()}>Cancel</Button>
              <div className="flex gap-2 w-full">
                {step !== "personal" && (
                  <Button
                    type="button"
                    disabled={isSaving}
                    variant="outline"
                    onClick={() =>
                      setStep(step === "groups" ? "academic" : "personal")
                    }
                    className="flex-1 rounded-xl border-slate-200 font-bold uppercase tracking-wider text-[10px]"
                  >
                    <ChevronLeft className="mr-1 size-3" /> Back
                  </Button>
                )}

                {step !== "groups" ? (
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={handleNext}
                    className="flex-1 bg-slate-900 rounded-xl font-bold uppercase tracking-wider text-[10px] hover:bg-slate-800"
                  >
                    Next <ChevronRight className="ml-1 size-3" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 bg-emerald-600 rounded-xl font-bold uppercase tracking-wider text-[10px] hover:bg-emerald-700"
                  >
                    <Save className="mr-1 size-3" /> {isSaving ? "Saving…" : "Save Changes"}
                  </Button>
                )}
              </div>
            </SheetFooter>
          </form>
        </FormProvider>
      </SheetContent>
    </Sheet>
  );
}
