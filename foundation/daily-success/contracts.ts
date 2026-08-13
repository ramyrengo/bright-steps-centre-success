import type { Header, Query } from "encore.dev/api";

export type DailySuccessPerspectiveKind =
  | "centre"
  | "portfolio"
  | "compliance"
  | "administration";

export type DailyAttentionBand =
  | "URGENT"
  | "TODAY"
  | "UPCOMING"
  | "WAITING"
  | "AWARENESS";

export type DailyResponsibility =
  | "YOU_NEED_TO_ACT"
  | "YOUR_CENTRE_NEEDS_TO_ACT"
  | "WAITING_ON_SOMEONE_ELSE"
  | "FOR_YOUR_AWARENESS";

export type DailyDueBucket =
  | "OVERDUE"
  | "TODAY"
  | "TOMORROW"
  | "DUE_SOON"
  | "LATER";

export interface DailySuccessRequest {
  perspective?: Query<DailySuccessPerspectiveKind>;
  centreId?: Query<string>;
}

export interface DailySuccessPerspective {
  kind: DailySuccessPerspectiveKind;
  label: string;
  centreId?: string;
  centreName?: string;
}

export interface DailyBusinessDateContext {
  scope: "organisation" | "centre";
  id: string;
  timezone: string;
  date: string;
}

export interface DailyDueInformation {
  at: string;
  timezone: string;
  localDate: string;
  bucket: DailyDueBucket;
  daysFromToday: number;
}

export interface DailyWhyShown {
  code:
    | "CRITICAL_RISK"
    | "IMMEDIATE_RISK"
    | "ACTION_OVERDUE"
    | "ACTION_DUE_TODAY"
    | "ACTION_DUE_SOON"
    | "REMEDIATION_RETURNED"
    | "REMEDIATION_REQUIRED"
    | "VERIFICATION_REQUIRED"
    | "AUDIT_REQUIRES_ACTION"
    | "REVIEW_REQUIRES_ACKNOWLEDGEMENT"
    | "PRIVILEGED_APPROVAL_REQUIRED"
    | "IDENTITY_REVIEW_REQUIRED"
    | "CHECK_DUE_TODAY"
    | "CHECK_OVERDUE";
  label: string;
}

export interface DailySuccessCta {
  label: string;
  route: string;
}

export interface DailySuccessItem {
  id: string;
  sourceType: "corrective_action" | "finding" | "quarterly_review" | "people_access" | "operational_check";
  sourceId: string;
  centreId?: string;
  centreName?: string;
  headline: string;
  summary: string;
  attentionBand: DailyAttentionBand;
  responsibility: DailyResponsibility;
  whyShown: DailyWhyShown;
  due?: DailyDueInformation;
  riskLevel: "CRITICAL" | "HIGH" | "STANDARD";
  verification?: {
    required: true;
    eligible: boolean;
  };
  cta: DailySuccessCta;
}

export interface DailySuccessSection {
  key: "DO_FIRST" | "TODAY" | "NEXT" | "WAITING" | "ON_TRACK";
  label: "DO FIRST" | "TODAY" | "NEXT" | "WAITING" | "ON TRACK";
  items: DailySuccessItem[];
}

export interface DailyCentreAttentionSummary {
  centreId: string;
  centreName: string;
  attentionBand: DailyAttentionBand;
  headline: string;
  coverage: "complete" | "partial";
  criticalCount?: number;
  overdueCount?: number;
  dueTodayCount?: number;
  totalActiveCount?: number;
  cta: DailySuccessCta;
}

export interface DailyAuthorisationHealth {
  status: "available" | "partial";
  warning?: string;
}

export interface DailySourceHealth {
  source: "corrective_actions" | "quarterly_reviews" | "people_access" | "operational_checks";
  status: "available" | "unavailable" | "not_applicable";
}

export interface DailyPositiveContext {
  completedTodayCount: number;
  recentTitles: string[];
  onTrackCentreCount?: number;
}

export interface DailyWorkspaceLink {
  label: string;
  route: string;
}

export interface DailySuccessResponse {
  cacheControl: Header<"Cache-Control">;
  asOf: string;
  status: "ready" | "partial" | "selection_required" | "unsupported";
  activePerspective?: DailySuccessPerspective;
  availablePerspectives: DailySuccessPerspective[];
  businessDates: DailyBusinessDateContext[];
  sections: DailySuccessSection[];
  attentionCentres: DailyCentreAttentionSummary[];
  verificationItems: DailySuccessItem[];
  aggregateCounts: {
    coverage: "complete" | "partial";
    active?: number;
    urgent?: number;
    dueToday?: number;
    waiting?: number;
    distinctCentres?: number;
  };
  positiveContext?: DailyPositiveContext;
  sourceHealth: DailySourceHealth[];
  authorisationHealth: DailyAuthorisationHealth;
  warning?: string;
  workspaceLinks: DailyWorkspaceLink[];
}
