"use client";

export default function MetricCard({
  label,
  value,
  delta,
  note,
}: {
  label: string;
  value: string | number;
  delta?: string | null;
  note?: string | null;
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--divider)] rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-[var(--muted)] mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-lg font-bold text-[var(--foreground)]">{value}</p>
        {delta && <p className="text-sm text-[var(--muted)]">{delta}</p>}
      </div>
      {note && <p className="text-xs text-[var(--muted)] mt-2">{note}</p>}
    </div>
  );
}
