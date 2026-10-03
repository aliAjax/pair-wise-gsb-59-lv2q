import { Injectable, inject } from "@angular/core";
import { Apollo, gql } from "apollo-angular";
import { Observable, map } from "rxjs";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationMutationResult,
  ClarificationResponseInput,
  FinalizeVersionInput,
  FinalizeVersionResult,
  RespondClarificationResult,
  SubmitAssessmentResult,
  WorkspaceQueryResult,
} from "../models/review.models";

const WORKSPACE_QUERY = gql`
  query ProcurementReviewWorkspace {
    workspace {
      clauses {
        id
        code
        title
        category
        requirement
        type
        weight
        parentId
        evidenceRequired
        order
        responses {
          id
          clauseId
          supplierId
          supplierName
          status
          responseText
          claimedScore
          attachmentName
          proofFingerprint
          submittedBy
          submittedAt
          reviewRound
          revision
          quarantined
          quarantineReason
          issueIds
          reviews {
            id
            responseId
            reviewer
            role
            decision
            score
            comment
            createdAt
            batchId
            opSeq
            auditId
          }
          clarifications {
            id
            responseId
            clauseId
            round
            requestText
            supplierResponse
            requestedAt
            dueAt
            respondedAt
            status
            batchId
            opSeq
            responseBatchId
            responseOpSeq
            requestAuditId
            responseAuditId
          }
        }
      }
      versions {
        id
        version
        label
        status
        createdAt
        createdBy
        signedBy
        clauseCount
        responseCount
        contentHash
        batchId
        opSeq
        auditId
        quarantined
        quarantineReason
        issueIds
        hashStatus
      }
      auditLogs {
        id
        at
        actor
        action
        entity
        detail
        batchId
        opSeq
        entityRefId
      }
      batches {
        id
        revision
        operation
        opSeq
        status
        createdAt
        committedAt
        actor
        role
        expectedRevision
        responseId
        resultEntityId
        resultEntityType
        replayCount
        lastReplayAt
      }
      reconciliation {
        summary {
          reconciledAt
          totalBatches
          unfinishedBatches
          replayedBatches
          backfilledBatches
          quarantinedResponses
          quarantinedVersions
          pendingIssues
          resolvedIssues
        }
        issues {
          id
          kind
          severity
          entityType
          entityId
          responseId
          message
          detail
          detectedAt
          resolved
          resolvedAt
          resolvedBy
          resolution
        }
        lastStartupReplay
      }
      globalRevision
      dashboard {
        totalClauses
        mandatoryCount
        pendingReviews
        differences
        overdueClarifications
        reusedProofs
        activeVersion
        quarantinedResponses
        quarantinedVersions
        pendingReconciliation
        unfinishedBatches
      }
      suppliers {
        id
        name
      }
    }
  }
`;

const RECEIPT_FIELDS = gql`
  fragment BatchReceiptFields on BatchReceipt {
    batchId
    opSeq
    revision
    replayed
    auditId
  }
`;

const SUBMIT_ASSESSMENT = gql`
  ${RECEIPT_FIELDS}
  mutation SubmitAssessment($input: AssessmentInput!) {
    submitAssessment(input: $input) {
      __typename
      ... on AssessmentResult {
        opinion {
          id
          responseId
          reviewer
          role
          decision
          score
          comment
          createdAt
          batchId
          opSeq
          auditId
        }
        receipt {
          ...BatchReceiptFields
        }
      }
      ... on ConcurrentChange {
        batchId
        expectedRevision
        currentRevision
        responseId
        message
        latestBy
        latestAt
        latestDetail
      }
      ... on QuarantineConflict {
        batchId
        issueId
        responseId
        message
      }
    }
  }
`;

const REQUEST_CLARIFICATION = gql`
  ${RECEIPT_FIELDS}
  mutation RequestClarification($input: ClarificationInput!) {
    requestClarification(input: $input) {
      __typename
      ... on ClarificationResult {
        clarification {
          id
          responseId
          clauseId
          round
          requestText
          supplierResponse
          requestedAt
          dueAt
          respondedAt
          status
          batchId
          opSeq
          responseBatchId
          responseOpSeq
          requestAuditId
          responseAuditId
        }
        receipt {
          ...BatchReceiptFields
        }
      }
      ... on ConcurrentChange {
        batchId
        expectedRevision
        currentRevision
        responseId
        message
        latestBy
        latestAt
        latestDetail
      }
      ... on QuarantineConflict {
        batchId
        issueId
        responseId
        message
      }
    }
  }
`;

const RESPOND_CLARIFICATION = gql`
  ${RECEIPT_FIELDS}
  mutation RespondClarification($input: ClarificationResponseInput!) {
    respondClarification(input: $input) {
      __typename
      ... on ClarificationResult {
        clarification {
          id
          responseId
          clauseId
          round
          requestText
          supplierResponse
          requestedAt
          dueAt
          respondedAt
          status
          batchId
          opSeq
          responseBatchId
          responseOpSeq
          requestAuditId
          responseAuditId
        }
        receipt {
          ...BatchReceiptFields
        }
      }
      ... on ConcurrentChange {
        batchId
        expectedRevision
        currentRevision
        responseId
        message
        latestBy
        latestAt
        latestDetail
      }
      ... on QuarantineConflict {
        batchId
        issueId
        responseId
        message
      }
    }
  }
`;

const FINALIZE_VERSION = gql`
  ${RECEIPT_FIELDS}
  mutation FinalizeVersion($input: FinalizeVersionInput!) {
    finalizeVersion(input: $input) {
      __typename
      ... on FinalizeResult {
        version {
          id
          version
          label
          status
          createdAt
          createdBy
          signedBy
          clauseCount
          responseCount
          contentHash
          batchId
          opSeq
          auditId
          quarantined
          quarantineReason
          issueIds
          hashStatus
        }
        receipt {
          ...BatchReceiptFields
        }
      }
      ... on ConcurrentChange {
        batchId
        expectedRevision
        currentRevision
        responseId
        message
        latestBy
        latestAt
        latestDetail
      }
      ... on QuarantineConflict {
        batchId
        issueId
        responseId
        message
      }
    }
  }
`;

const RESOLVE_QUARANTINE = gql`
  mutation ResolveQuarantine($input: ResolveQuarantineInput!) {
    resolveQuarantine(input: $input) {
      issue {
        id
        kind
        severity
        entityType
        entityId
        responseId
        message
        detail
        detectedAt
        resolved
        resolvedAt
        resolvedBy
        resolution
      }
      receipt {
        batchId
        opSeq
        revision
        replayed
        auditId
      }
    }
  }
`;

const RERUN_RECONCILIATION = gql`
  mutation RerunReconciliation($role: ReviewRole!) {
    rerunReconciliation(role: $role) {
      summary {
        reconciledAt
        totalBatches
        unfinishedBatches
        replayedBatches
        backfilledBatches
        quarantinedResponses
        quarantinedVersions
        pendingIssues
        resolvedIssues
      }
      issues {
        id
        kind
        severity
        entityType
        entityId
        responseId
        message
        detail
        detectedAt
        resolved
        resolvedAt
        resolvedBy
        resolution
      }
      lastStartupReplay
    }
  }
`;

const RESET_REVIEW_DATA = gql`
  mutation ResetReviewData {
    resetReviewData
  }
`;

@Injectable({ providedIn: "root" })
export class ReviewGraphqlService {
  private readonly apollo = inject(Apollo);

  loadWorkspace(): Observable<WorkspaceQueryResult> {
    return this.apollo
      .query<WorkspaceQueryResult>({
        query: WORKSPACE_QUERY,
        fetchPolicy: "network-only",
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审工作区。");
          }
          return result.data as WorkspaceQueryResult;
        }),
      );
  }

  submitAssessment(
    input: AssessmentInput,
  ): Observable<SubmitAssessmentResult> {
    return this.apollo
      .mutate<{ submitAssessment: SubmitAssessmentResult }>({
        mutation: SUBMIT_ASSESSMENT,
        variables: { input },
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回评审意见。");
          }
          return result.data.submitAssessment;
        }),
      );
  }

  requestClarification(
    input: ClarificationInput,
  ): Observable<ClarificationMutationResult> {
    return this.apollo
      .mutate<{ requestClarification: ClarificationMutationResult }>({
        mutation: REQUEST_CLARIFICATION,
        variables: { input },
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清记录。");
          }
          return result.data.requestClarification;
        }),
      );
  }

  respondClarification(
    input: ClarificationResponseInput,
  ): Observable<RespondClarificationResult> {
    return this.apollo
      .mutate<{ respondClarification: RespondClarificationResult }>({
        mutation: RESPOND_CLARIFICATION,
        variables: { input },
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回澄清回复。");
          }
          return result.data.respondClarification;
        }),
      );
  }

  finalizeVersion(
    input: FinalizeVersionInput,
  ): Observable<FinalizeVersionResult> {
    return this.apollo
      .mutate<{ finalizeVersion: FinalizeVersionResult }>({
        mutation: FINALIZE_VERSION,
        variables: { input },
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回版本信息。");
          }
          return result.data.finalizeVersion;
        }),
      );
  }

  resolveQuarantine(input: {
    issueId: string;
    note: string;
    actor: string;
    role: import("../models/review.models").ReviewRole;
  }) {
    return this.apollo
      .mutate<{
        resolveQuarantine: {
          issue: import("../models/review.models").ReconciliationIssue;
        };
      }>({
        mutation: RESOLVE_QUARANTINE,
        variables: { input },
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回复核结果。");
          }
          return result.data.resolveQuarantine.issue;
        }),
      );
  }

  rerunReconciliation(role: import("../models/review.models").ReviewRole) {
    return this.apollo
      .mutate<{
        rerunReconciliation: import("../models/review.models").ReconciliationState;
      }>({
        mutation: RERUN_RECONCILIATION,
        variables: { role },
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回复核结果。");
          }
          return result.data.rerunReconciliation;
        }),
      );
  }

  resetReviewData(): Observable<boolean> {
    return this.apollo
      .mutate<{ resetReviewData: boolean }>({
        mutation: RESET_REVIEW_DATA,
      })
      .pipe(
        map((result) => {
          if (!result.data) {
            throw new Error("GraphQL 未返回重置结果。");
          }
          return result.data.resetReviewData;
        }),
      );
  }
}

