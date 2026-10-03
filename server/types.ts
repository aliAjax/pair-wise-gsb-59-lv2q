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
export type BatchAction =
  | "submit_assessment"
  | "request_clarification"
  | "respond_clarification"
  | "finalize_version"
  | "resolve_quarantine";
export type QuarantineKind = "isolated" | "pending_review";
export type QuarantineStatus = "pending" | "resolved";
export type QuarantineEntityType = "response" | "version";

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
}

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
  action: BatchAction;
  actor: string;
  role: ReviewRole;
  baseRevision: number;
  status: BatchStatus;
  entityId: string;
  resultRevision?: number;
  createdAt: string;
  appliedAt?: string;
}

export interface StoredBatch extends AuditBatch {
  payload: unknown;
  result?: unknown;
}

export interface QuarantineItem {
  id: string;
  kind: QuarantineKind;
  entityType: QuarantineEntityType;
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

export interface JournalMeta {
  lastRunAt: string;
  replayed: number;
  backfilled: number;
}

export interface JournalFile {
  seq: number;
  batches: StoredBatch[];
  quarantine: QuarantineItem[];
  meta: JournalMeta;
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

export interface ReviewDatabase {
  clauses: Clause[];
  responses: SupplierResponse[];
  versions: ReviewVersion[];
  suppliers: Array<{ id: string; name: string }>;
}

export interface RevisionConflict {
  responseId: string;
  currentRevision: number;
  status: ComplianceStatus;
  reviewRound: number;
  reviews: ReviewerOpinion[];
  message: string;
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
