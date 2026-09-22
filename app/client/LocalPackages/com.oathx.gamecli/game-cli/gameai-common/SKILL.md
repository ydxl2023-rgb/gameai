---
name: gameai-common
description: 提供流水线共用的结构化结果、文件哈希与 Trace 约定；用于角色交付和证据整理。
---

# 公共契约

JIRA 是任务状态、审批、重试与执行记录的唯一可信来源。Git、文件和对象存储保存产物与证据，不保存第二套权威流程状态。

每次输出可解析的 JSON 对象：
- schema_version：默认 1。
- issue_key：真实 JIRA 编号，尚未建单时为 null。
- trace_id、execution_id：沿用调用方传入值；缺失时说明，不伪造已有执行。
- status：success、blocked 或 failed，仅表示本次执行结果，不替代 JIRA 业务状态。
- data：角色专属输出。
- artifacts：真实路径或 URL，以及可获得的实际 sha256。
- errors：错误类别、消息、证据及是否可重试。

对实际文件字节计算 SHA-256；记录输入版本、UTC 时间、耗时和工具结果。日志不含密钥或令牌。区分未执行、桩执行和真实验证；缺失字段使用 null，不猜测链接、编号或结果。报告可落盘，状态仍回写 JIRA。
