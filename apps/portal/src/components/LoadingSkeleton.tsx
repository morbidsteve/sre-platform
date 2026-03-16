function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-700/30 bg-slate-800/30 p-5">
      <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-700/50" />
      <div className="mt-4 space-y-2">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-700/50" />
        <div className="h-3 w-full animate-pulse rounded bg-slate-700/30" />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <div className="h-2 w-2 animate-pulse rounded-full bg-slate-700/50" />
        <div className="h-3 w-16 animate-pulse rounded bg-slate-700/30" />
      </div>
    </div>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <div className="h-3 w-32 animate-pulse rounded bg-slate-700/50" />
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
      <section>
        <div className="mb-4 flex items-center gap-3">
          <div className="h-3 w-40 animate-pulse rounded bg-slate-700/50" />
          <div className="h-px flex-1 bg-slate-800" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    </div>
  );
}
