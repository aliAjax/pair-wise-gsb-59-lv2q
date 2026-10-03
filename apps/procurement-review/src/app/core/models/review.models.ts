export type ClauseType = "mandatory" | "scoring" | "evidence";
export type ComplianceStatus =
  | "compliant"
  | "deviation"
  | "clarification"
  | "pending";
export type ReviewRole =
  | "procurement"
  | "reviewer_a"
  | "reviewer_b"
  | "chair";
export type ClarificationStatus = "open" | "responded" | "overdue";
export type VersionStatus = "draft" | "finalized";
export type BatchStatus = "pending" | "applied" | "backfilled";
export type QuarantineKind = "isolated" | "pending_review";
export type QuarantineStatus = "pending" | "resolved";

export interface ReviewerOpinion {
  id: string;
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
  batchId?: string;
}

export interface Clarification {
  id: string;
  responseId: string;
  clauseId: string;
  round: number;
  requestText: string;
  supplierResponse?: string;
  requestedAt: string;
  dueAt: string;
  respondedAt?: string;
  status: ClarificationStatus;
  batchId?: string;
}

export interface SupplierResponse {
  id: string;
  clauseId: string;
  supplierId: string;
  supplierName: string;
  status: ComplianceStatus;
  responseText: string;
  claimedScore: number;
  attachmentName: string;
  proofFingerprint: string;
  submittedBy: string;
  submittedAt: string;
  reviewRound: number;
  revision: number;
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
}

export interface Clause {
  id: string;
  code: string;
  title: string;
  category: string;
  requirement: string;
  type: ClauseType;
  weight: number;
  parentId?: string;
  evidenceRequired: boolean;
  order: number;
  responses: SupplierResponse[];
  children?: ClauseTreeNode[];
}

export interface ClauseTreeNode extends Clause {
  children: ClauseTreeNode[];
}

export interface ReviewVersion {
  id: string;
  version: string;
  label: string;
  status: VersionStatus;
  createdAt: string;
  createdBy: string;
  signedBy: string[];
  clauseCount: number;
  responseCount: number;
  contentHash: string;
  batchId?: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  batchId?: string;
}

export interface AuditBatch {
  id: string;
  opId: string;
  action: string;
  actor: string;
  role: ReviewRole;
  baseRevision: number;
  status: BatchStatus;
  entityId: string;
  resultRevision?: number;
  createdAt: string;
  appliedAt?: string;
}

export interface QuarantineItem {
  id: string;
  kind: QuarantineKind;
  entityType: string;
  entityId: string;
  reason: string;
  detail: string;
  detectedAt: string;
  status: QuarantineStatus;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface ReconciliationReport {
  lastRunAt: string;
  batchCount: number;
  replayedBatches: number;
  backfilledBatches: number;
  pendingQuarantine: number;
  quarantine: QuarantineItem[];
}

export interface RevisionConflict {
  responseId: string;
  currentRevision: number;
  status: ComplianceStatus;
  reviewRound: number;
  reviews: ReviewerOpinion[];
  message: string;
}

export interface DashboardStats {
  totalClauses: number;
  mandatoryCount: number;
  pendingReviews: number;
  differences: number;
  overdueClarifications: number;
  reusedProofs: number;
  activeVersion: string;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface ClauseFilters {
  keyword: string;
  category: string;
  type: ClauseType | "all";
  differencesOnly: boolean;
}

export interface ReviewState {
  clauses: Clause[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  dashboard?: DashboardStats;
  suppliers: Supplier[];
  reconciliation?: ReconciliationReport;
  batches: AuditBatch[];
  conflict?: RevisionConflict;
  filters: ClauseFilters;
  role: ReviewRole;
  selectedSupplierIds: string[];
  loading: boolean;
  saving: boolean;
  error?: string;
  toast?: string;
}

export interface WorkspaceQueryResult {
  workspace: {
    clauses: Clause[];
    versions: ReviewVersion[];
    auditLogs: AuditLog[];
    dashboard: DashboardStats;
    suppliers: Supplier[];
    reconciliation: ReconciliationReport;
    batches: AuditBatch[];
  };
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  baseRevision: number;
  opId: string;
}

export interface ClarificationInput {
  responseId: string;
  requestText: string;
  dueAt: string;
  actor: string;
  role: ReviewRole;
  baseRevision: number;
  opId: string;
}

export interface ClarificationResponseInput {
  clarificationId: string;
  responseText: string;
  actor: string;
  role: ReviewRole;
  baseRevision: number;
  opId: string;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
  opId: string;
}

export interface ResolveQuarantineInput {
  quarantineId: string;
  resolution: string;
  actor: string;
  role: ReviewRole;
  opId: string;
}

export interface AssessmentPayload {
  opinion: ReviewerOpinion;
  batchId: string;
  revision: number;
  replayed: boolean;
}

export interface ClarificationPayload {
  clarification: Clarification;
  batchId: string;
  revision: number;
  replayed: boolean;
}

export interface FinalizePayload {
  version: ReviewVersion;
  batchId: string;
  replayed: boolean;
}

export interface ResolveQuarantinePayload {
  item: QuarantineItem;
  batchId: string;
  replayed: boolean;
}

export const roleProfiles: Record<ReviewRole, { name: string; label: string }> = {
  procurement: { name: "采购专员", label: "采购人员" },
  reviewer_a: { name: "陈评审", label: "技术评审员 A" },
  reviewer_b: { name: "李评审", label: "技术评审员 B" },
  chair: { name: "赵主任", label: "评审组长" },
};

export const complianceLabels: Record<ComplianceStatus, string> = {
  compliant: "符合",
  deviation: "偏离",
  clarification: "待澄清",
  pending: "待评审",
};

export const clauseTypeLabels: Record<ClauseType, string> = {
  mandatory: "否决项",
  scoring: "评分项",
  evidence: "证明项",
};

export const statusSeverity: Record<ComplianceStatus, string> = {
  compliant: "success",
  deviation: "danger",
  clarification: "warn",
  pending: "secondary",
};

export const quarantineKindLabels: Record<QuarantineKind, string> = {
  isolated: "隔离",
  pending_review: "待核",
};

export const quarantineStatusLabels: Record<QuarantineStatus, string> = {
  pending: "待处理",
  resolved: "已修复",
};

export const createOperationId = (): string =>
  `OP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
