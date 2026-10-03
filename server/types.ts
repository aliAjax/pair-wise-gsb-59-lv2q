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
export type ReconciliationIssueKind =
  | "orphan_opinion"
  | "orphan_log"
  | "unmatched_opinion"
  | "unmatched_clarification"
  | "unmatched_log"
  | "unfinished_batch"
  | "duplicate_batch"
  | "version_hash_missing"
  | "version_hash_mismatch";

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
  /** 产生该意见的审计批次号；旧数据回填前为空。 */
  batchId?: string;
  /** 批次内操作编号，从 1 开始。 */
  opSeq?: number;
  /** 关联审计日志编号，供对账复核。 */
  auditId?: string;
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
  opSeq?: number;
  /** 回复登记批次号（与发起批次不同）。 */
  responseBatchId?: string;
  responseOpSeq?: number;
  requestAuditId?: string;
  responseAuditId?: string;
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
  reviews: ReviewerOpinion[];
  clarifications: Clarification[];
  /** 乐观并发修订号：关键操作成功后递增。 */
  revision: number;
  /** 对账隔离标记，组长确认修复前不可再操作。 */
  quarantined?: boolean;
  /** 进入隔离/待核的原因（对账结论）。 */
  quarantineReason?: string;
  /** 关联待核问题编号。 */
  issueIds?: string[];
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
  opSeq?: number;
  auditId?: string;
  quarantined?: boolean;
  quarantineReason?: string;
  issueIds?: string[];
  /** 最近一次对账对定稿哈希的复核结论。 */
  hashStatus?: "verified" | "missing" | "mismatch";
  /** 定稿快照的规范基线，仅服务端用于复核 contentHash。 */
  hashBasis?: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  batchId?: string;
  opSeq?: number;
  /** 该日志覆盖的业务实体编号（意见/澄清/版本）。 */
  entityRefId?: string;
}

/**
 * 可恢复审计批次。
 *
 * prepared 阶段先把批次意图（含确定性操作编号）落盘，
 * 业务数据与审计日志在同一互斥区追加后再转为 committed。
 * 重启时 prepared 批次按 payload 重放，重试按编号幂等返回原结果。
 */
export interface AuditBatch {
  id: string;
  revision: number;
  operation: BatchOperationType;
  opSeq: number;
  status: BatchStatus;
  createdAt: string;
  committedAt?: string;
  actor: string;
  role?: ReviewRole;
  /** 乐观锁：提交时客户端所见修订号（定稿批次为全局修订号）。 */
  expectedRevision: number;
  /** 目标响应编号，定稿批次为空。 */
  responseId?: string;
  /** 重放所需的原始输入。 */
  payload: Record<string, unknown>;
  /** 提交后生成的业务实体编号，供幂等重试返回原结果。 */
  resultEntityId?: string;
  resultEntityType?: "opinion" | "clarification" | "version";
  /** 重放次数。 */
  replayCount?: number;
  lastReplayAt?: string;
}

export interface ReconciliationIssue {
  id: string;
  kind: ReconciliationIssueKind;
  severity: IssueSeverity;
  entityType: "response" | "version" | "batch" | "audit";
  entityId: string;
  responseId?: string;
  message: string;
  detail?: string;
  detectedAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
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
  /** 组长确认修复的记录编号，避免下次对账重复隔离。 */
  resolutions: Array<{
    issueId: string;
    at: string;
    by: string;
    note: string;
  }>;
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

export interface ReviewDatabase {
  clauses: Clause[];
  responses: SupplierResponse[];
  versions: ReviewVersion[];
  auditLogs: AuditLog[];
  suppliers: Array<{ id: string; name: string }>;
  batches: AuditBatch[];
  reconciliation: ReconciliationState;
  /** 全局修订号：版本定稿等全局操作使用。 */
  globalRevision: number;
  schemaVersion: number;
}

export interface BatchContext {
  batchId: string;
  opSeq: number;
  revision: number;
  auditId: string;
}

export interface AssessmentInput {
  responseId: string;
  decision: ComplianceStatus;
  score: number;
  comment: string;
  reviewer: string;
  role: ReviewRole;
  batchId?: string;
  expectedRevision?: number;
}

export interface ClarificationInput {
  responseId: string;
  requestText: string;
  dueAt: string;
  actor: string;
  role?: ReviewRole;
  batchId?: string;
  expectedRevision?: number;
}

export interface ClarificationResponseInput {
  clarificationId: string;
  responseText: string;
  actor: string;
  role?: ReviewRole;
  batchId?: string;
  expectedRevision?: number;
}

export interface FinalizeVersionInput {
  label: string;
  actor: string;
  role: ReviewRole;
  batchId?: string;
  expectedRevision?: number;
}

export interface ResolveQuarantineInput {
  issueId: string;
  note: string;
  actor: string;
  role: ReviewRole;
  batchId?: string;
}
