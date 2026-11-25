import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkflowsWorkbench } from "@/features/workflows/WorkflowsWorkbench";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-full gap-3 p-4">
          <Skeleton className="h-full w-64" />
          <Skeleton className="h-full flex-1" />
          <Skeleton className="h-full w-80" />
        </div>
      }
    >
      <WorkflowsWorkbench />
    </Suspense>
  );
}
