"use client";

import { useState } from "react";
import type { MandatoryCriterion } from "@/lib/rfp/config";
import styles from "./MandatoryCriteriaPhase.module.css";

interface MandatoryCriteriaPhaseProps {
  title: string;
  subtitle: string;
  targets: string[];
  activeTargetIndex: number;
  criteriaByTarget: Record<string, MandatoryCriterion[]>;
  loading: boolean;
  ready: boolean;
  onBack: () => void;
  onNext: () => void;
  onSaveAll: () => void;
  onAddCriterion: (target: string) => void;
  onRemoveCriterion: (target: string, index: number) => void;
  onUpdateCriterion: (target: string, index: number, patch: Partial<MandatoryCriterion>) => void;
}

function formatTargetLabel(target: string): string {
  if (target === "full") return "Full RFP";
  return target
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function MandatoryCriteriaPhase({
  title,
  subtitle,
  targets,
  activeTargetIndex,
  criteriaByTarget,
  loading,
  ready,
  onBack,
  onNext,
  onSaveAll,
  onAddCriterion,
  onRemoveCriterion,
  onUpdateCriterion,
}: MandatoryCriteriaPhaseProps) {
  const [activeSliderIndex, setActiveSliderIndex] = useState<number | null>(null);
  const [liveMarkerValue, setLiveMarkerValue] = useState<number | null>(null);
  const [liveProjectedByTarget, setLiveProjectedByTarget] = useState<Record<string, number[] | null>>({});
  
  const currentTarget = targets[activeTargetIndex] || "full";
  const currentCriteria = criteriaByTarget[currentTarget] || [];
  const isLastTarget = activeTargetIndex >= targets.length - 1;
  const singleTarget = targets.length <= 1;
  const currentTargetTotal = currentCriteria.reduce((sum, criterion) => sum + (criterion.value || 0), 0);
  const allTargetsValid = targets.every((target) => {
    const total = (criteriaByTarget[target] || []).reduce((sum, criterion) => sum + (criterion.value || 0), 0);
    return total === 100;
  });
  const canSaveAll = ready && currentTargetTotal === 100 && allTargetsValid;

  const computeProjectedArray = (activeIndex: number, activeValue: number) => {
    const out = currentCriteria.map((c) => c.value || 0);
    const slots = currentCriteria.length - 1;
    if (slots <= 0) {
      out[activeIndex] = activeValue;
      return out;
    }
    const othersSum = currentCriteria.reduce((s, c, i) => (i === activeIndex ? s : s + (c.value || 0)), 0);
    out[activeIndex] = activeValue;
    if (othersSum > 0) {
      currentCriteria.forEach((c, i) => {
        if (i === activeIndex) return;
        out[i] = Math.round(((c.value || 0) / othersSum) * Math.max(0, 100 - activeValue));
      });
      const projectedSum = out.reduce((s, v) => s + v, 0);
      const drift = 100 - projectedSum;
      if (drift !== 0) {
        for (let j = currentCriteria.length - 1; j >= 0; j--) {
          if (j !== activeIndex) {
            out[j] = Math.max(0, out[j] + drift);
            break;
          }
        }
      }
      return out;
    }
    const even = Math.floor(Math.max(0, 100 - activeValue) / slots);
    currentCriteria.forEach((c, i) => { if (i === activeIndex) return; out[i] = even; });
    const projectedSum = out.reduce((s, v) => s + v, 0);
    const drift2 = 100 - projectedSum;
    if (drift2 !== 0) {
      for (let j = currentCriteria.length - 1; j >= 0; j--) {
        if (j !== activeIndex) { out[j] = out[j] + drift2; break; }
      }
    }
    return out;
  };

  return (
    <div className={styles.root}>
      <div className={styles.topRow}>
        <div>
          <div className={styles.metaTitle}>{title}</div>
          <div className={styles.metaSubtitle}>{subtitle}</div>
        </div>
        <div className={styles.targetGroup}>
          {targets.length > 1 && (
            <div className={styles.targetChips}>
              {targets.map((target, index) => {
                const completed = index < activeTargetIndex;
                const active = index === activeTargetIndex;
                const chipClass = completed
                  ? styles.targetChipDone
                  : active
                    ? styles.targetChipActive
                    : styles.targetChipPending;
                return (
                  <div key={target} className={`${styles.targetChip} ${chipClass}`}>
                    {completed ? <span>✓</span> : <span>{index + 1}</span>}
                    <span>{formatTargetLabel(target)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <div className={styles.panelTitle}>{formatTargetLabel(currentTarget)}</div>
            <div className={styles.panelSubtitle}>
              {singleTarget
                ? "Use the slider values as-is or adjust them before saving."
                : `Review and finish ${formatTargetLabel(currentTarget)} before moving to the next subsystem.`}
            </div>
          </div>
        </div>

        {loading && (
          <div className={styles.loadingText}>
            Generating AI recommended criteria...
          </div>
        )}

        {!loading && currentCriteria.length === 0 && (
          <div className={styles.emptyText}>
            No criteria loaded yet.
          </div>
        )}

        <div className={styles.list}>
          {currentCriteria.map((criterion, index) => {
            const isAi = (criterion as any).source === "ai";
            return (
              <div key={criterion.id || `${currentTarget}-${index}`} className={styles.item}>
                <div className={styles.itemTop}>
                  <div className={styles.itemBody}>
                    <label className={styles.fieldLabel}>
                      {isAi ? (
                        <div className={styles.aiLabel}>{criterion.label}</div>
                      ) : (
                        <input
                          className={styles.inputField}
                          value={criterion.label}
                          aria-label={`Criteria label for ${criterion.label}`}
                          onChange={(event) => onUpdateCriterion(currentTarget, index, { label: event.target.value, source: criterion.source || "user" })}
                          placeholder={criterion.source === "user" ? "Add extra criteria here" : "Enter mandatory criteria label"}
                        />
                      )}
                    </label>
                    {criterion.notes && !isAi && <div className={styles.notes}>{criterion.notes}</div>}
                  </div>
                  <button className={`btn-outline ${styles.removeBtn}`} type="button" onClick={() => onRemoveCriterion(currentTarget, index)} aria-label="Remove criterion">
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" /></svg>
                  </button>
                </div>
                <div className={styles.sliderWrap}>
                  <div className={styles.sliderScale}>
                    <span>0%</span>
                    <span className={styles.sliderValue}>{criterion.value}%</span>
                    <span>100%</span>
                  </div>
                  {(() => {
                    const targetProjection = liveProjectedByTarget[currentTarget];
                    const displayValue = targetProjection && targetProjection[index] !== undefined
                      ? targetProjection[index]
                      : (criterion.value || 0);
                    return <div className={styles.marker} style={{ left: `${displayValue}%` }} />;
                  })()}
                  <input
                    className={`${styles.slider} ${(currentCriteria.reduce((s, c) => s + (c.value || 0), 0) !== 100 ? styles.sliderWarning : "")}`}
                    type="range"
                    min={0}
                    max={100}
                    value={criterion.value}
                    disabled={isAi ? false : !criterion.label}
                    aria-label={`Threshold for ${criterion.label}`}
                    onMouseDown={() => { setActiveSliderIndex(index); setLiveMarkerValue(Number(criterion.value)); }}
                    onTouchStart={() => { setActiveSliderIndex(index); setLiveMarkerValue(Number(criterion.value)); }}
                    onFocus={() => { setActiveSliderIndex(index); setLiveMarkerValue(Number(criterion.value)); }}
                    onInput={(event) => {
                      const v = Number((event.target as HTMLInputElement).value);
                      setActiveSliderIndex(index);
                      setLiveMarkerValue(v);
                      onUpdateCriterion(currentTarget, index, { value: v, source: criterion.source || "user" });
                      const projected = computeProjectedArray(index, v);
                      setLiveProjectedByTarget((current) => ({ ...current, [currentTarget]: projected }));
                    }}
                    onChange={(event) => {
                      const v = Number(event.target.value);
                      setActiveSliderIndex(index);
                      setLiveMarkerValue(v);
                      onUpdateCriterion(currentTarget, index, { value: v, source: criterion.source || "user" });
                      const projected = computeProjectedArray(index, v);
                      setLiveProjectedByTarget((current) => ({ ...current, [currentTarget]: projected }));
                    }}
                    onMouseUp={() => {
                      setActiveSliderIndex(null);
                      setLiveMarkerValue(null);
                    }}
                    onTouchEnd={() => {
                      setActiveSliderIndex(null);
                      setLiveMarkerValue(null);
                    }}
                    onBlur={() => {
                      setActiveSliderIndex(null);
                      setLiveMarkerValue(null);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.addBtnWrap}>
          <button className={`btn-outline ${styles.addBtnBottom}`} type="button" onClick={() => onAddCriterion(currentTarget)}>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" /></svg>
            Add Criteria
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        {activeTargetIndex > 0 ? (
          <button className="btn-outline" type="button" onClick={onBack}>
            Back
          </button>
        ) : (
          <div />
        )}
        <div className={styles.footerActions}>
          {!isLastTarget ? (
            <button className="btn-primary" type="button" onClick={onNext} disabled={!ready}>
              Next
            </button>
          ) : (
            <>
              <button 
                className="btn-primary" 
                type="button" 
                onClick={() => {
                  onSaveAll();
                }} 
                disabled={!canSaveAll}
                title={!canSaveAll ? `Button disabled. Ready: ${ready}, Current total: ${currentTargetTotal}%, All valid: ${allTargetsValid}` : ""}
              >
                Next
              </button>
              {!canSaveAll && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>
                  {!ready && "Loading criteria..."}
                  {ready && currentTargetTotal !== 100 && `Current: ${currentTargetTotal}% (need 100%)`}
                  {ready && currentTargetTotal === 100 && !allTargetsValid && "Some targets don't sum to 100%"}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
