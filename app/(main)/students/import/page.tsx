"use client";

import { Download, AlertCircle, Database } from "lucide-react";
import { Button } from "@/globals/components/shad-cn/button";
import { Badge } from "@/globals/components/shad-cn/badge";
import { page } from "@/globals/constants/designTokens";
import StudentImporter from "@/features/students/components/StudentImporter";

const ImportStudentPage = () => {
  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        {/* Page Header */}
        <div className="flex justify-between items-end">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">
              Import Student Records
            </h1>
            <p className="text-muted-foreground text-sm">
              Bulk upload student informations
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" asChild>
            <a
              href="/templates/student_import_template.csv"
              download="student_import_template.csv"
            >
              <Download className="w-4 h-4" />
              CSV Template
            </a>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Sidebar: Schema Mapping Info */}
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" /> Required Fields
              </h3>
              <div className="flex flex-wrap gap-2">
                {[
                  "id",
                  "lastName",
                  "firstName",
                  "section",
                  "yearLevel",
                  "schoolLevel",
                ].map((field) => (
                  <Badge
                    key={field}
                    variant="default"
                    className="font-mono text-[10px]"
                  >
                    {field}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" /> Conditional
                Rules
              </h3>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
                <li>
                  <strong>SHS:</strong> Requires{" "}
                  <code className="text-primary">strand</code>
                </li>
                <li>
                  <strong>College:</strong> Requires{" "}
                  <code className="text-primary">program</code>
                </li>
                <li>
                  New IDs will create records; existing IDs will be updated
                  (Upsert).
                </li>
              </ul>
            </section>
          </div>

          {/* Main Upload Area */}
          <StudentImporter onImportSuccess={() => {}} />
        </div>
      </div>
    </section>
  );
};

export default ImportStudentPage;
