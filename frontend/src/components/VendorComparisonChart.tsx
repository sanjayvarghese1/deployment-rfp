"use client";

type VendorScorePoint = {
  label: string;
  value: number;
  color?: string;
};

export default function VendorComparisonChart({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle?: string;
  points: VendorScorePoint[];
}) {
  const safePoints = points.filter((point) => Number.isFinite(point.value));
  const maxValue = Math.max(100, ...safePoints.map((point) => point.value), 1);

  return (
    <div className="rounded-xl border border-[var(--divider)] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{title}</p>
          {subtitle && <p className="text-xs text-[var(--muted)] mt-1">{subtitle}</p>}
        </div>
        <span className="text-xs font-medium text-[var(--muted)]">Score out of 100</span>
      </div>

      <div className="space-y-3">
        {safePoints.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No score data available yet.</p>
        ) : (
          safePoints.map((point, index) => {
            const width = Math.max(6, Math.round((point.value / maxValue) * 100));
            const colorClass = point.color || "bg-[var(--primary)]";
            return (
              <div key={`${point.label}-${index}`} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-[var(--foreground)] truncate">{point.label}</span>
                  <span className="text-[var(--muted)]">{point.value}/100</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--surface)] overflow-hidden">
                  <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}