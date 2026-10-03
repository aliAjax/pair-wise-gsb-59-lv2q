import { runBatch } from "./batches";
import {
  backfillLegacyBatches,
  reconcileDatabase,
} from "./reconciliation";
import type { ReviewDatabase } from "./types";

export interface RecoverableStore {
  snapshot(): ReviewDatabase;
  transaction<T>(
    work: (database: ReviewDatabase, checkpoint: () => void) => T,
  ): T;
  recover(hooks: {
    replay: () => number;
    backfill: () => number;
    reconcile: (
      database: ReviewDatabase,
      stats: { replayedBatches: number; backfilledBatches: number },
    ) => ReviewDatabase["reconciliation"];
  }): void;
}

const replayPrepared =
  (store: RecoverableStore) =>
  (): number => {
    let replayed = 0;
    const database = store.snapshot();
    for (const batch of database.batches) {
      if (batch.status !== "prepared") {
        continue;
      }
      const outcome = runBatch(store, {
        operation: batch.operation,
        actor: batch.actor,
        role: batch.role,
        responseId: batch.responseId,
        batchId: batch.id,
        expectedRevision: batch.expectedRevision,
        payload: batch.payload,
        startupReplay: true,
      });
      if (outcome.outcome === "recovered") {
        replayed += 1;
      }
    }
    return replayed;
  };

const backfill =
  (store: RecoverableStore) =>
  (): number =>
    store.transaction(
      (database) => backfillLegacyBatches(database).batches,
    );

/**
 * 启动恢复：旧数据回填 → 未完成批次重放 → 与当前数据对账。
 * 重置演示数据后再次调用即可对新种子完成同一套流程。
 */
export const runStartupRecovery = (
  store: RecoverableStore,
): void => {
  store.recover({
    backfill: backfill(store),
    replay: replayPrepared(store),
    reconcile: (database, stats) =>
      reconcileDatabase(database, stats, database.reconciliation),
  });
};
