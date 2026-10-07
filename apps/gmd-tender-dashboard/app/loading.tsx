import DashboardSkeleton from "@/components/tender-viewer/dashboard-skeleton";

export default function Loading() {
  return (
    <div className="p-4" style={{ paddingTop: 12 }}>
      <DashboardSkeleton />
    </div>
  );
}
