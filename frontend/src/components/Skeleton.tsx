export function SkeletonLine({ width = '100%', height = 12 }: { width?: string | number; height?: number }) {
  return (
    <div
      className="skeleton skeleton-line"
      style={{ width: typeof width === 'number' ? `${width}px` : width, height }}
    />
  )
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return <div className="skeleton skeleton-card" style={{ height }} />
}

export function DashboardSkeleton() {
  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <SkeletonLine width={220} height={28} />
        <SkeletonLine width={320} height={14} />
      </div>
      <div className="dashboard-section">
        <div className="dashboard-status">
          {[0, 1, 2].map(i => (
            <div key={i} className="dashboard-status-item" style={{ height: 88 }}>
              <SkeletonLine width={80} height={12} />
              <SkeletonLine width={120} height={16} />
            </div>
          ))}
        </div>
      </div>
      <div className="dashboard-section">
        <SkeletonLine width={100} height={13} />
        <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[0, 1, 2].map(i => <SkeletonCard key={i} height={110} />)}
        </div>
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-panel">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <SkeletonLine width="60%" height={13} />
            <SkeletonLine width="35%" height={11} />
          </div>
        </div>
      ))}
    </div>
  )
}