interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

export function Skeleton({ className = '', width, height }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-border/50 rounded ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card-base p-5">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-9 w-16" />
    </div>
  );
}
