import type {
  DailyAttentionBand,
  DailyCentreAttentionSummary,
  DailySuccessItem,
  DailySuccessSection,
} from "./contracts";
import type { CentreAuthorisationFact } from "../authorization/batch-centres";
import { controlledDailyCta } from "./cta";

const bandRank: Record<DailyAttentionBand, number> = {
  URGENT: 0,
  TODAY: 1,
  UPCOMING: 2,
  WAITING: 3,
  AWARENESS: 4,
};
const responsibilityRank: Record<DailySuccessItem["responsibility"], number> = {
  YOU_NEED_TO_ACT: 0,
  YOUR_CENTRE_NEEDS_TO_ACT: 1,
  WAITING_ON_SOMEONE_ELSE: 2,
  FOR_YOUR_AWARENESS: 3,
};
const riskRank: Record<DailySuccessItem["riskLevel"], number> = {
  CRITICAL: 0,
  HIGH: 1,
  STANDARD: 2,
};

export function compareDailyItems(a: DailySuccessItem, b: DailySuccessItem): number {
  return (
    riskRank[a.riskLevel] - riskRank[b.riskLevel] ||
    bandRank[a.attentionBand] - bandRank[b.attentionBand] ||
    responsibilityRank[a.responsibility] - responsibilityRank[b.responsibility] ||
    (a.due?.daysFromToday ?? Number.MAX_SAFE_INTEGER) -
      (b.due?.daysFromToday ?? Number.MAX_SAFE_INTEGER) ||
    (a.due?.at ?? "9999").localeCompare(b.due?.at ?? "9999") ||
    a.sourceType.localeCompare(b.sourceType) ||
    a.sourceId.localeCompare(b.sourceId)
  );
}

export function sortDailyItems(items: readonly DailySuccessItem[]): DailySuccessItem[] {
  return [...items].sort(compareDailyItems);
}

export function buildSections(
  items: readonly DailySuccessItem[],
): DailySuccessSection[] {
  const sorted = sortDailyItems(items);
  const urgent = sorted.filter((item) => item.attentionBand === "URGENT");
  const critical = urgent.filter((item) => item.riskLevel === "CRITICAL");
  const nonCritical = urgent.filter((item) => item.riskLevel !== "CRITICAL");
  // Critical/immediate risk is never truncated out of the primary surface.
  // The ordinary direct-action payload remains restrained to three entries.
  const doFirst = [
    ...critical,
    ...nonCritical.slice(0, Math.max(0, 3 - critical.length)),
  ];
  const today = sorted.filter((item) => item.attentionBand === "TODAY").slice(0, 5);
  const next = sorted.filter((item) => item.attentionBand === "UPCOMING").slice(0, 5);
  const waiting = sorted.filter((item) => item.attentionBand === "WAITING").slice(0, 5);
  return [
    { key: "DO_FIRST", label: "DO FIRST", items: doFirst },
    { key: "TODAY", label: "TODAY", items: today },
    { key: "NEXT", label: "NEXT", items: next },
    { key: "WAITING", label: "WAITING", items: waiting },
    { key: "ON_TRACK", label: "ON TRACK", items: [] },
  ];
}

export function buildCentreAttention(
  items: readonly DailySuccessItem[],
  options: {
    candidateCentres: readonly CentreAuthorisationFact[];
    coverage: "complete" | "partial";
  },
): DailyCentreAttentionSummary[] {
  const byCentre = new Map<string, DailySuccessItem[]>();
  for (const item of items) {
    if (!item.centreId || !item.centreName) continue;
    const current = byCentre.get(item.centreId) ?? [];
    current.push(item);
    byCentre.set(item.centreId, current);
  }
  const candidates = options.coverage === "partial"
    ? options.candidateCentres
    : options.candidateCentres.filter((centre) => byCentre.has(centre.id));
  return candidates
    .map((centre) => {
      const centreId = centre.id;
      const centreItems = byCentre.get(centreId) ?? [];
      const sorted = sortDailyItems(centreItems);
      const worst = sorted[0];
      return {
        centreId,
        centreName: centre.name,
        attentionBand: worst?.attentionBand ?? "AWARENESS",
        headline: worst?.headline ?? "Some priorities could not be checked",
        coverage: options.coverage,
        ...(options.coverage === "complete"
          ? {
              criticalCount: centreItems.filter((item) => item.riskLevel === "CRITICAL").length,
              overdueCount: centreItems.filter((item) => item.due?.bucket === "OVERDUE").length,
              dueTodayCount: centreItems.filter((item) => item.due?.bucket === "TODAY").length,
              totalActiveCount: centreItems.length,
            }
          : {}),
        cta: controlledDailyCta("Open Area Manager workspace", "/area-manager"),
      };
    })
    .sort((a, b) => {
      const aWorst = sortDailyItems(byCentre.get(a.centreId) ?? [])[0];
      const bWorst = sortDailyItems(byCentre.get(b.centreId) ?? [])[0];
      if (aWorst && bWorst) return compareDailyItems(aWorst, bWorst) || a.centreName.localeCompare(b.centreName);
      if (aWorst) return -1;
      if (bWorst) return 1;
      return a.centreName.localeCompare(b.centreName);
    })
    .slice(0, options.coverage === "partial" ? 20 : 5);
}
