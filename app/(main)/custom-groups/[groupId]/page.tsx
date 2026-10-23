import CustomGroupDetailClient from "@/features/custom-groups/components/CustomGroupDetailClient";

export default async function CustomGroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <CustomGroupDetailClient key={groupId} groupId={groupId} />;
}
