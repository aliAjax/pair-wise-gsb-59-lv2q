# 公共采购技术响应符合性评审平台

基于 Angular、PrimeNG、NgRx、Angular Router、Apollo Angular、GraphQL、Nx 和 TypeScript 实现。前端不会用普通 JSON 占位接口，而是通过 Apollo Angular 对本地 GraphQL mock server 发起真实查询和 mutation。

## 功能

- 评审概览：否决项遗漏、评审覆盖、评分分歧、逾期澄清、重复证明、当前版本和启动对账结果。
- 条款评审：技术条款树、供应商响应、证明文件、独立评审意见、评分和澄清发起。
- 批量比对：动态供应商列、评分差异定位、证明复用提示和差异筛选。
- 小组复核：保留各评审员独立意见，显示评分区间和分歧处理队列。
- 澄清轮次：发起澄清、登记回复、轮次和期限校验，未完成项目阻止定稿。
- 评审版本：创建并锁定定稿快照，保存内容哈希、响应数量和签署人。
- 角色分权：采购人员、评审员 A、评审员 B 和评审组长的操作入口按角色限制。
- 审计导出：GraphQL mutation 和版本操作写入审计日志，支持 JSON、CSV 导出。

## 可恢复审计批次

业务数据与审计日志分文件写入，磁盘出错或进程中断可能造成"意见已入库但日志缺失"。为此，关键操作（提交意见、发起/回复澄清、定稿、隔离修复）都包装为可恢复审计批次：

- **批次协议**：每次提交先落批次日志（pending，含修订号与操作编号），再分别写业务数据和审计日志，最后标记 applied。批次日志是恢复的权威依据。
- **幂等重试**：操作编号（opId）相同的重试直接返回原批次结果，不重复追加意见或日志；前端在表单内容未变化时复用同一操作编号。
- **并发冲突**：提交携带基于的修订号（baseRevision）。两个窗口并发修改同一响应时，后写入者收到 `REVISION_CONFLICT` 错误，响应中附带对方当前数据；前端保留用户输入并弹出对方改动对照，可基于最新修订号重新提交，双方意见都保留。
- **重启恢复**：服务启动时重放 pending 批次（apply 按批次号幂等，补齐缺失的意见、澄清或日志），再与当前数据对账。已应用批次效果不完整、定稿哈希与批次记录不一致的响应和版本会被隔离。
- **隔离与越权**：隔离待核项仅评审组长可确认修复（本身也是审计批次，会从批次记录补登缺失日志）；采购人员和评审员操作被服务端拒绝。隔离中的响应禁止新的 mutation，存在待处理隔离项时禁止定稿。
- **旧数据回填**：缺批次号的历史数据按意见/澄清/版本与审计日志配对回填批次号；补不全的（意见无日志、日志无业务记录、历史定稿哈希无法复核）进入待核队列。
- **同源对账**：总览、条款页、复核队列和审计导出读取同一份对账结果（`reconciliation`）。

## 技术栈

- Angular 22 standalone
- PrimeNG 22
- NgRx Store / Effects
- Angular Router
- Apollo Angular + GraphQL
- Nx workspace
- TypeScript 6
- Apollo Server 5 mock schema/server

## 本地 GraphQL

mock server 位于 `server/`，GraphQL 地址为 `http://127.0.0.1:18462/graphql`。schema 和 resolver 定义在 `server/schema.ts`、`server/server.ts`，初始数据位于 `server/data.ts`，批次存储与恢复逻辑位于 `server/store.ts`。运行时写入三个被 Git 忽略的文件：

- `server/runtime-data.json`：业务数据（条款、响应、版本）
- `server/audit-log.json`：审计日志
- `server/batch-journal.json`：审计批次日志（含隔离待核队列）

## 运行

```bash
npm install
npm run dev
```

- 前端：`http://localhost:18459`
- GraphQL：`http://127.0.0.1:18462/graphql`

## 构建

```bash
npm run build
```

构建由 `nx build procurement-review` 执行 Angular application builder，并包含 TypeScript 与 Angular 模板严格检查。
