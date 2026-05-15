import type {
  MandatoryCriteriaPayload,
  MandatoryCriteriaRecommendation,
  MandatoryCriterion,
} from "./config";

export function clampPercent(value: unknown, fallback = 50): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function slugifyCriterionLabel(label: string, index: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `${slug}_${index + 1}` : `criterion_${index + 1}`;
}

export function createCriterion(label: string, recommendedValue = 50, source: MandatoryCriterion["source"] = "ai"): MandatoryCriterion {
  const value = clampPercent(recommendedValue, 50);
  return {
    id: slugifyCriterionLabel(label, value),
    label,
    value,
    recommendedValue: value,
    source,
  };
}

export function buildFallbackCriteria(targetLabel: string): MandatoryCriterion[] {
  const normalized = targetLabel.trim() || "Full RFP";
  return [
    createCriterion(`${normalized} completeness`, 80, "ai"),
    createCriterion(`${normalized} technical fit`, 75, "ai"),
    createCriterion(`${normalized} compliance fit`, 70, "ai"),
  ];
}

export function normalizeRecommendation(
  recommendation: MandatoryCriteriaRecommendation | null | undefined,
  targets: string[],
): Record<string, MandatoryCriterion[]> {
  const byTarget: Record<string, MandatoryCriterion[]> = {};

  if (recommendation?.fullRfp && (targets.length === 0 || targets.includes("full"))) {
    byTarget.full = recommendation.fullRfp.map((item, index) => {
      const label = String(item.label || `Criterion ${index + 1}`);
      const recommendedValue = clampPercent(item.recommendedValue ?? item.value ?? 50);
      return {
        id: slugifyCriterionLabel(label, index),
        label,
        value: clampPercent(item.value ?? recommendedValue, recommendedValue),
        recommendedValue,
        source: "ai" as const,
        notes: typeof item.notes === "string" ? item.notes : undefined,
      };
    });
  }

  for (const target of targets) {
    if (target === "full") continue;
    const items = recommendation?.subsystems?.[target] || recommendation?.subsystems?.[target.trim()] || [];
    byTarget[target] = items.length > 0
      ? items.map((item, index) => {
          const label = String(item.label || `Criterion ${index + 1}`);
          const recommendedValue = clampPercent(item.recommendedValue ?? item.value ?? 50);
          return {
            id: slugifyCriterionLabel(label, index),
            label,
            value: clampPercent(item.value ?? recommendedValue, recommendedValue),
            recommendedValue,
            source: "ai" as const,
            notes: typeof item.notes === "string" ? item.notes : undefined,
          };
        })
      : buildFallbackCriteria(target.replace(/_/g, " "));
  }

  if (targets.includes("full") && !byTarget.full) {
    byTarget.full = buildFallbackCriteria("Full RFP");
  }

  // Ensure each target's values sum to 100 (scale AI recommendations)
  const normalizeList = (items: MandatoryCriterion[]) => {
    if (!items || items.length === 0) return items;
    const raw = items.map((it) => ({ ...it }));
    const total = raw.reduce((s, it) => s + clampPercent(it.recommendedValue ?? it.value ?? 0, 0), 0);
    if (total <= 0) {
      // distribute evenly
      const even = Math.floor(100 / raw.length);
      raw.forEach((it, i) => { it.recommendedValue = even; it.value = even; });
      // adjust last to reach 100
      const sumNow = raw.reduce((s, it) => s + it.recommendedValue!, 0);
      raw[raw.length - 1].recommendedValue = (raw[raw.length - 1].recommendedValue || 0) + (100 - sumNow);
      raw[raw.length - 1].value = raw[raw.length - 1].recommendedValue;
      return raw;
    }

    const factor = 100 / total;
    let acc = 0;
    raw.forEach((it, i) => {
      const scaled = Math.max(0, Math.round((it.recommendedValue ?? it.value ?? 0) * factor));
      acc += scaled;
      it.recommendedValue = scaled;
      it.value = scaled;
    });
    // fix rounding drift
    const drift = 100 - acc;
    if (drift !== 0) {
      raw[raw.length - 1].recommendedValue = (raw[raw.length - 1].recommendedValue || 0) + drift;
      raw[raw.length - 1].value = raw[raw.length - 1].recommendedValue;
    }

    return raw;
  };

  for (const key of Object.keys(byTarget)) {
    byTarget[key] = normalizeList(byTarget[key]);
  }

  return byTarget;
}

export function ensureCriteriaTarget(criteriaByTarget: Record<string, MandatoryCriterion[]>, target: string): MandatoryCriterion[] {
  return criteriaByTarget[target] && criteriaByTarget[target].length > 0
    ? criteriaByTarget[target]
    : buildFallbackCriteria(target === "full" ? "Full RFP" : target.replace(/_/g, " "));
}

export function addCriterionTarget(criteriaByTarget: Record<string, MandatoryCriterion[]>, target: string): Record<string, MandatoryCriterion[]> {
  const next = { ...criteriaByTarget };
  const existing = ensureCriteriaTarget(next, target);
  const nextLabel = `Additional criterion ${existing.length + 1}`;
  // user-added criteria start at 0 so the user can set them explicitly
  // create new user criterion with empty label so the UI can show a placeholder
  next[target] = [...existing, createCriterion("", 0, "user")];
  return next;
}

export function updateCriterionTarget(
  criteriaByTarget: Record<string, MandatoryCriterion[]>,
  target: string,
  index: number,
  patch: Partial<MandatoryCriterion>,
): Record<string, MandatoryCriterion[]> {
  const next = { ...criteriaByTarget };
  const targetItems = ensureCriteriaTarget(next, target).map((item, itemIndex) => (
    itemIndex === index
      ? {
          ...item,
          ...patch,
          value: clampPercent(patch.value ?? item.value, item.value),
          recommendedValue: clampPercent(patch.recommendedValue ?? item.recommendedValue, item.recommendedValue),
        }
      : item
  ));
  next[target] = targetItems;
  return next;
}

export function removeCriterionTarget(
  criteriaByTarget: Record<string, MandatoryCriterion[]>,
  target: string,
  index: number,
): Record<string, MandatoryCriterion[]> {
  const next = { ...criteriaByTarget };
  const targetItems = ensureCriteriaTarget(next, target).filter((_, itemIndex) => itemIndex !== index);
  next[target] = targetItems.length > 0 ? targetItems : buildFallbackCriteria(target === "full" ? "Full RFP" : target.replace(/_/g, " "));
  return next;
}

export function buildMandatoryCriteriaPayload(
  criteriaByTarget: Record<string, MandatoryCriterion[]>,
  targets: string[],
  activeTargetIndex: number,
): MandatoryCriteriaPayload {
  const payload: MandatoryCriteriaPayload = {
    subsystems: {},
    selectedSubsystems: targets,
    activeSubsystemIndex: activeTargetIndex,
    completedSubsystems: targets.slice(0, activeTargetIndex),
  };

  if (targets.includes("full")) {
    // Exclude any criteria with a 0% threshold when saving
    payload.fullRfp = ensureCriteriaTarget(criteriaByTarget, "full")
      .filter((item) => Number(item.value) > 0)
      .map((item) => ({ ...item }));
  }

  for (const target of targets) {
    if (target === "full") continue;
    // Exclude any criteria with a 0% threshold when saving
    payload.subsystems[target] = ensureCriteriaTarget(criteriaByTarget, target)
      .filter((item) => Number(item.value) > 0)
      .map((item) => ({ ...item }));
  }

  return payload;
}
