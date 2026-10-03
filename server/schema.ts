import { parse } from "graphql";

export const typeDefs = parse(`
  enum ClauseType {
    mandatory
    scoring
    evidence
  }

  enum ComplianceStatus {
    compliant
    deviation
    clarification
    pending
  }

  enum ReviewRole {
    procurement
    reviewer_a
    reviewer_b
    chair
  }

  enum ClarificationStatus {
    open
    responded
    overdue
  }

  enum VersionStatus {
    draft
    finalized
  }

  enum BatchStatus {
    prepared
    committed
    aborted
  }

  enum BatchOperationType {
    submit_assessment
    request_clarification
    respond_clarification
    finalize_version
  }

  enum IssueSeverity {
    quarantined
    pending
  }

  enum HashVerifyStatus {
    verified
    missing
    mismatch
  }

  type Clause {
    id: ID!
    code: String!
    title: String!
    category: String!
    requirement: String!
    type: ClauseType!
    weight: Int!
    parentId: String
    evidenceRequired: Boolean!
    order: Int!
    responses: [SupplierResponse!]!
  }

  type ReviewerOpinion {
    id: ID!
    responseId: String!
    reviewer: String!
    role: ReviewRole!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    createdAt: String!
    batchId: String
    opSeq: Int
    auditId: String
  }

  type Clarification {
    id: ID!
    responseId: String!
    clauseId: String!
    round: Int!
    requestText: String!
    supplierResponse: String
    requestedAt: String!
    dueAt: String!
    respondedAt: String
    status: ClarificationStatus!
    batchId: String
    opSeq: Int
    responseBatchId: String
    responseOpSeq: Int
    requestAuditId: String
    responseAuditId: String
  }

  type SupplierResponse {
    id: ID!
    clauseId: String!
    supplierId: String!
    supplierName: String!
    status: ComplianceStatus!
    responseText: String!
    claimedScore: Int!
    attachmentName: String!
    proofFingerprint: String!
    submittedBy: String!
    submittedAt: String!
    reviewRound: Int!
    revision: Int!
    quarantined: Boolean!
    quarantineReason: String
    issueIds: [String!]!
    reviews: [ReviewerOpinion!]!
    clarifications: [Clarification!]!
  }

  type ReviewVersion {
    id: ID!
    version: String!
    label: String!
    status: VersionStatus!
    createdAt: String!
    createdBy: String!
    signedBy: [String!]!
    clauseCount: Int!
    responseCount: Int!
    contentHash: String!
    batchId: String
    opSeq: Int
    auditId: String
    quarantined: Boolean!
    quarantineReason: String
    issueIds: [String!]!
    hashStatus: HashVerifyStatus
  }

  type AuditLog {
    id: ID!
    at: String!
    actor: String!
    action: String!
    entity: String!
    detail: String!
    batchId: String
    opSeq: Int
    entityRefId: String
  }

  type AuditBatch {
    id: ID!
    revision: Int!
    operation: BatchOperationType!
    opSeq: Int!
    status: BatchStatus!
    createdAt: String!
    committedAt: String
    actor: String!
    role: ReviewRole
    expectedRevision: Int!
    responseId: String
    resultEntityId: String
    resultEntityType: String
    replayCount: Int!
    lastReplayAt: String
  }

  type ReconciliationIssue {
    id: ID!
    kind: String!
    severity: IssueSeverity!
    entityType: String!
    entityId: String!
    responseId: String
    message: String!
    detail: String
    detectedAt: String!
    resolved: Boolean!
    resolvedAt: String
    resolvedBy: String
    resolution: String
  }

  type ReconciliationSummary {
    reconciledAt: String!
    totalBatches: Int!
    unfinishedBatches: Int!
    replayedBatches: Int!
    backfilledBatches: Int!
    quarantinedResponses: Int!
    quarantinedVersions: Int!
    pendingIssues: Int!
    resolvedIssues: Int!
  }

  type ReconciliationState {
    summary: ReconciliationSummary!
    issues: [ReconciliationIssue!]!
    lastStartupReplay: String!
  }

  type DashboardStats {
    totalClauses: Int!
    mandatoryCount: Int!
    pendingReviews: Int!
    differences: Int!
    overdueClarifications: Int!
    reusedProofs: Int!
    activeVersion: String!
    quarantinedResponses: Int!
    quarantinedVersions: Int!
    pendingReconciliation: Int!
    unfinishedBatches: Int!
  }

  type Supplier {
    id: ID!
    name: String!
  }

  type BatchReceipt {
    batchId: ID!
    opSeq: Int!
    revision: Int!
    replayed: Boolean!
    auditId: String!
  }

  type ConcurrentChange {
    batchId: ID!
    expectedRevision: Int!
    currentRevision: Int!
    responseId: String
    message: String!
    latestBy: String
    latestAt: String
    latestDetail: String
  }

  type QuarantineConflict {
    batchId: ID!
    issueId: String
    responseId: String
    message: String!
  }

  type AssessmentResult {
    opinion: ReviewerOpinion!
    receipt: BatchReceipt!
  }

  type ClarificationResult {
    clarification: Clarification!
    receipt: BatchReceipt!
  }

  type FinalizeResult {
    version: ReviewVersion!
    receipt: BatchReceipt!
  }

  type ResolveQuarantineResult {
    issue: ReconciliationIssue!
    receipt: BatchReceipt!
  }

  union SubmitAssessmentPayload =
      AssessmentResult
    | ConcurrentChange
    | QuarantineConflict

  union RequestClarificationPayload =
      ClarificationResult
    | ConcurrentChange
    | QuarantineConflict

  union RespondClarificationPayload =
      ClarificationResult
    | ConcurrentChange
    | QuarantineConflict

  union FinalizeVersionPayload =
      FinalizeResult
    | ConcurrentChange
    | QuarantineConflict

  type WorkspaceData {
    clauses: [Clause!]!
    versions: [ReviewVersion!]!
    auditLogs: [AuditLog!]!
    batches: [AuditBatch!]!
    reconciliation: ReconciliationState!
    globalRevision: Int!
    dashboard: DashboardStats!
    suppliers: [Supplier!]!
  }

  input AssessmentInput {
    responseId: ID!
    decision: ComplianceStatus!
    score: Int!
    comment: String!
    reviewer: String!
    role: ReviewRole!
    batchId: ID
    expectedRevision: Int
  }

  input ClarificationInput {
    responseId: ID!
    requestText: String!
    dueAt: String!
    actor: String!
    role: ReviewRole
    batchId: ID
    expectedRevision: Int
  }

  input ClarificationResponseInput {
    clarificationId: ID!
    responseText: String!
    actor: String!
    role: ReviewRole
    batchId: ID
    expectedRevision: Int
  }

  input FinalizeVersionInput {
    label: String!
    actor: String!
    role: ReviewRole!
    batchId: ID
    expectedRevision: Int
  }

  input ResolveQuarantineInput {
    issueId: ID!
    note: String!
    actor: String!
    role: ReviewRole!
  }

  type Query {
    workspace: WorkspaceData!
    dashboard: DashboardStats!
    reconciliation: ReconciliationState!
  }

  type Mutation {
    submitAssessment(input: AssessmentInput!): SubmitAssessmentPayload!
    requestClarification(input: ClarificationInput!): RequestClarificationPayload!
    respondClarification(
      input: ClarificationResponseInput!
    ): RespondClarificationPayload!
    finalizeVersion(input: FinalizeVersionInput!): FinalizeVersionPayload!
    resolveQuarantine(
      input: ResolveQuarantineInput!
    ): ResolveQuarantineResult!
    rerunReconciliation(role: ReviewRole!): ReconciliationState!
    resetReviewData: Boolean!
  }
`);
