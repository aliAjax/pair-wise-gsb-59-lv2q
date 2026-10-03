import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { GraphQLError } from "graphql";
import { typeDefs } from "./schema";
import { RevisionConflictError, reviewStore } from "./store";
import type {
  AssessmentInput,
  ClarificationInput,
  ClarificationResponseInput,
  Clause,
  DashboardStats,
  FinalizeVersionInput,
  ResolveQuarantineInput,
  ReviewDatabase,
} from "./types";

const getDashboard = (database: ReviewDatabase): DashboardStats => {
  const opinionsByResponse = database.responses.map((response) => {
    const decisions = new Set(
      response.reviews
        .filter((review) => review.decision !== "clarification")
        .map((review) => review.decision),
    );
    return decisions.size > 1;
  });
  const proofCounts = database.responses.reduce<Record<string, number>>(
    (counts, response) => {
      if (response.proofFingerprint) {
        counts[response.proofFingerprint] =
          (counts[response.proofFingerprint] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  const activeVersion =
    database.versions.find((version) => version.status === "draft") ??
    database.versions[0];

  return {
    totalClauses: database.clauses.length,
    mandatoryCount: database.clauses.filter(
      (clause) => clause.type === "mandatory",
    ).length,
    pendingReviews: database.responses.filter(
      (response) => response.reviews.length < 2,
    ).length,
    differences: opinionsByResponse.filter(Boolean).length,
    overdueClarifications: database.responses.reduce(
      (count, response) =>
        count +
        response.clarifications.filter(
          (clarification) => clarification.status === "overdue",
        ).length,
      0,
    ),
    reusedProofs: Object.values(proofCounts).filter((count) => count > 1)
      .length,
    activeVersion: activeVersion
      ? `${activeVersion.version} ${activeVersion.label}`
      : "未建立版本",
  };
};

/**
 * 把存储层抛出的修订冲突转成带对方当前数据的 GraphQL 错误，
 * 前端据此保留用户输入并展示对方改动。
 */
const rethrowAsGraphQLError = (error: unknown): never => {
  if (error instanceof RevisionConflictError) {
    throw new GraphQLError(error.message, {
      extensions: {
        code: "REVISION_CONFLICT",
        conflict: error.conflict,
      },
    });
  }
  if (error instanceof Error) {
    throw new GraphQLError(error.message, {
      extensions: { code: "BATCH_REJECTED" },
    });
  }
  throw error;
};

const commit = <T>(work: () => T): T => {
  try {
    return work();
  } catch (error) {
    return rethrowAsGraphQLError(error);
  }
};

const resolvers = {
  Query: {
    workspace: () => {
      const snapshot = reviewStore.snapshot();
      return {
        ...snapshot,
        dashboard: getDashboard(snapshot),
      };
    },
    dashboard: () => getDashboard(reviewStore.snapshot()),
    reconciliation: () => reviewStore.reconciliation(),
  },
  Clause: {
    responses: (
      clause: Clause,
      _args: unknown,
      context: { database: ReviewDatabase },
    ) =>
      context.database.responses.filter(
        (response) => response.clauseId === clause.id,
      ),
  },
  Mutation: {
    submitAssessment: (
      _parent: unknown,
      { input }: { input: AssessmentInput },
    ) =>
      commit(() => {
        const batch = reviewStore.submitAssessment(input);
        return {
          opinion: batch.result,
          batchId: batch.batchId,
          revision: batch.revision,
          replayed: batch.replayed,
        };
      }),
    requestClarification: (
      _parent: unknown,
      { input }: { input: ClarificationInput },
    ) =>
      commit(() => {
        const batch = reviewStore.requestClarification(input);
        return {
          clarification: batch.result,
          batchId: batch.batchId,
          revision: batch.revision,
          replayed: batch.replayed,
        };
      }),
    respondClarification: (
      _parent: unknown,
      { input }: { input: ClarificationResponseInput },
    ) =>
      commit(() => {
        const batch = reviewStore.respondClarification(input);
        return {
          clarification: batch.result,
          batchId: batch.batchId,
          revision: batch.revision,
          replayed: batch.replayed,
        };
      }),
    finalizeVersion: (
      _parent: unknown,
      { input }: { input: FinalizeVersionInput },
    ) =>
      commit(() => {
        const batch = reviewStore.finalizeVersion(input);
        return {
          version: batch.result,
          batchId: batch.batchId,
          replayed: batch.replayed,
        };
      }),
    resolveQuarantine: (
      _parent: unknown,
      { input }: { input: ResolveQuarantineInput },
    ) =>
      commit(() => {
        const batch = reviewStore.resolveQuarantine(input);
        return {
          item: batch.result,
          batchId: batch.batchId,
          replayed: batch.replayed,
        };
      }),
    resetReviewData: () => {
      reviewStore.reset();
      return true;
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

async function startServer(): Promise<void> {
  const { url } = await startStandaloneServer(server, {
    listen: { port: 18462, host: "0.0.0.0" },
    context: async () => ({
      database: reviewStore.snapshot(),
    }),
  });
  console.log(`GraphQL mock server ready at ${url}`);
  const report = reviewStore.reconciliation();
  console.log(
    `启动对账完成：批次 ${report.batchCount}，重放 ${report.replayedBatches}，回填 ${report.backfilledBatches}，隔离待核 ${report.pendingQuarantine}。`,
  );
}

void startServer();
