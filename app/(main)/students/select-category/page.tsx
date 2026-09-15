import CollegeSelectionBoard from "@/features/students/components/CollegeSelectionBoard";
import HouseSelectionBoard from "@/features/students/components/HouseSelectionBoard";
import ShsSelectionBoard from "@/features/students/components/ShsSelectionBoard";
import { StudentListCategory } from "@/features/students/types";
import { page } from "@/globals/constants/designTokens";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<{
    category?: StudentListCategory;
  }>;
};

const SelectCategoryPage = async ({ searchParams }: Props) => {
  const params = await searchParams;
  const category = params.category ?? "COLLEGE";

  const renderContent = () => {
    if (category === "COLLEGE") return <CollegeSelectionBoard />;
    if (category === "SHS") return <ShsSelectionBoard />;
    if (category === "HOUSE") return <HouseSelectionBoard />;

    return redirect("/students/student-list?category=ALL");
  };

  return (
    <section className={`${page.surface} min-h-svh`}>
      <div className={page.containerWide}>
        {/* Navigation Header */}
        <div className="flex items-center">
          <Link
            href="/students"
            className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white/50 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm backdrop-blur-sm transition-all hover:border-indigo-300 hover:bg-white hover:text-indigo-600 hover:shadow-md"
          >
            <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            <span>Return to Menu</span>
          </Link>
        </div>

        {/* Selection Content */}
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          {renderContent()}
        </div>
      </div>
    </section>
  );
};

export default SelectCategoryPage;
