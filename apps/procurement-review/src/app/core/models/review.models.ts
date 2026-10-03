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
export type BatchStatus = "prepared" | "committed" | "aborted";
export type BatchOperationType =
  | "submit_assessment"
  | "request_clarification"
  | "respond_clarification"
  | "finalize_version"
  | "resolve_quarantine";
export type IssueSeverity = "quarantined" | "pending";
export type HashVerifyStatus = "verified" | "missing" | "mismatch";

export interface ReviewerOpinion {
  id: string;
  responseId: string;
  reviewer: string;
  role: ReviewRole;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  createdAt: string;
  batchId?: string | null;
  opSeq?: number | null;
  auditId?: string | null;
}

export interface Clarification {
  id: string;
  responseId: string;
  clauseId: string;
  round: number;
  requestText: string;
  supplierResponse?: string | null;
  requestedAt: string;
  dueAt: string;
  respondedAt?: string | null;
  status: ClarificationStatus;
  batchId?: string | null;
  opSeq?: number | null;
  responseBatchId?: string | null;
  responseOpSeq?: number | null;
  requestAuditId?: string | null;
  responseAuditId?: string | null;
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
  quarantined: boolean;
  quarantineReason?: string | null;
  issueIds: string[];
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
  batchId?: string | null;
  opSeq?: number | null;
  auditId?: string | null;
  quarantined: boolean;
  quarantineReason?: string | null;
  issueIds: string[];
  hashStatus?: HashVerifyStatus | null;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  batchId?: string | null;
  opSeq?: number | null;
  entityRefId?: string | null;
}

export interface AuditBatch {
  id: string;
  revision: number;
  operation: BatchOperationType;
  opSeq: number;
  status: BatchStatus;
  createdAt: string;
  committedAt?: string | null;
  actor: string;
  role?: ReviewRole | null;
  expectedRevision: number;
  responseId?: string | null;
  resultEntityId?: string | null;
  resultEntityType?: string | null;
  replayCount: number;
  lastReplayAt?: string | null;
}

export interface ReconciliationIssue {
  id: string;
  kind: string;
  severity: IssueSeverity;
  entityType: string;
  entityId: string;
  responseId?: string | null;
  message: string;
  detail?: string | null;
  detectedAt: string;
  resolved: boolean;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolution?: string | null;
}

export interface ReconciliationSummary {
  reconciledAt: string;
  totalBatches: number;
  unfinishedBatches: number;
  replayedBatches: number;
  backfilledBatches: number;
  quarantinedResponses: number;
  quarantinedVersions: number;
  pendingIssues: number;
  resolvedIssues: number;
}

export interface ReconciliationState {
  summary: ReconciliationSummary;
  issues: ReconciliationIssue[];
  lastStartupReplay: string;
}

export interface DashboardStats {
  totalClauses: number;
  mandatoryCount: number;
  pendingReviews: number;
  differences: number;
  overdueClarifications: number;
  reusedProofs: number;
  activeVersion: string;
  quarantinedResponses: number;
  quarantinedVersions: number;
  pendingReconciliation: number;
  unfinishedBatches: number;
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
  batches: AuditBatch[];
  reconciliation?: ReconciliationState;
  globalRevision: number;
  dashboard?: DashboardStats;
  suppliers: Supplier[];
  filters: ClauseFilters;
  role: ReviewRole;
  selectedSupplierIds: string[];
  loading: boolean;
  saving: boolean;
  error?: string;
  toast?: string;
  conflict?: ConflictNotice;
}

export interface ConflictNotice {
  message: string;
  responseId?: string | null;
  latestBy?: string | null;
  latestAt?: string | null;
  latestDetail?: string | null;
}

export interface BatchReceipt {
  batchId: string;
  opSeq: number;
  revision: number;
  replayed: boolean;
  auditId: string;
}

export interface AssessmentSuccess {
  opinion: ReviewerOpinion;
  receipt: BatchReceipt;
}

export interface ClarificationSuccess {
  clarification: Clarification;
  receipt: BatchReceipt;
}

export interface FinalizeSuccess {
  version: ReviewVersion;
  receipt: BatchReceipt;
}

export interface ConcurrentChange {
  batchId: string;
  expectedRevision: number;
  currentRevision: number;
  responseId?: string | null;
  message: string;
  latestBy?: string | null;
  latestAt?: string | null;
  latestDetail?: string | null;
}

export interface QuarantineConflict {
  batchId: string;
  issueId?: string | null;
  responseId?: string | null;
  message: string;
}

export type SubmitAssessmentResult =
  | AssessmentSuccess
  | ConcurrentChange
  | QuarantineConflict;
export type ClarificationMutationResult =
  | ClarificationSuccess
  | ConcurrentChange
  | QuarantineConflict;
export type RespondClarificationResult = ClarificationMutationResult;
export type FinalizeVersionResult =
  | FinalizeSuccess
  | ConcurrentChange
  | QuarantineConflict;

export interface WorkspaceQueryResult {
  workspace: {
    clauses: Clause[];
    versions: ReviewVersion[];
    auditLogs: AuditLog[];
    batches: AuditBatch[];
    reconciliation: ReconciliationState;
    globalRevision: number;
    dashboard: DashboardStats;
    suppliers: Supplier[];
  };
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  batchId: string;
  expectedRevision: number;
}

export interface ClarificationInput {
  responseId: string;
  requestText: string;
  dueAt: string;
  actor: string;
  role?: ReviewRole;
  batchId: string;
  expectedRevision: number;
}

export interface ClarificationResponseInput {
  clarificationId: string;
  responseText: string;
  actor: string;
  role?: ReviewRole;
  batchId: string;
  expectedRevision: number;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
  batchId: string;
  expectedRevision: number;
}

export interface ResolveQuarantineInput {
  issueId: string;
  note: string;
  actor: string;
  role: ReviewRole;
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

export const issueKindLabels: Record<string, string> = {
  orphan_opinion: "意见缺少审计",
  orphan_log: "澄清缺少审计",
  unmatched_opinion: "意见日志缺失",
  unmatched_clarification: "回复缺少审计",
  unmatched_log: "日志缺少批次",
  unfinished_batch: "批次未完成",
  duplicate_batch: "批次重复写入",
  version_hash_missing: "定稿哈希待核",
  version_hash_mismatch: "定稿哈希不一致",
};

export const batchOperationLabels: Record<BatchOperationType, string> = {
  submit_assessment: "提交独立意见",
  request_clarification: "发起澄清",
  respond_clarification: "回复澄清",
  finalize_version: "汇总签字定稿",
  resolve_quarantine: "组长确认修复",
};
