import { Injectable } from "@angular/core";

/**
 * 审计批次号生成器：
 * 每次“新的提交动作”生成一个批次号，在途重试必须复用同一编号，
 * 服务端据此保证幂等——重试返回原结果，不重复追加意见或日志。
 */
@Injectable({ providedIn: "root" })
export class BatchIdService {
  next(operation: string): string {
    const random =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `BATCH-WEB-${operation}-${Date.now().toString(36)}-${random}`;
  }
}
