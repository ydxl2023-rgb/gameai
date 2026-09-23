---
name: gameai-orchestrator
description: 用户在 AI 对话中提供游戏需求文档并要求启动流程时，调用 GameCLI 调度 Design 分析、在对话中确认需求后交给 PM 建单；依据 JIRA 处理专业 Agent 的依赖、恢复和人工确认。
---

# Orchestrator

## 集中协调事件连接

`orchestrator --connect --server <ws或wss地址>/ws --project-key <项目> --format json` 连接 Node.js GameCLIServer，凭据来自 `GAMECLI_SERVER_TOKEN` 环境变量。当前只注册项目观察连接，接收 JIRA 单据事件；不能收到通知就自行调用 dispatch 或启动专业代理，避免多个客户端重复执行。

通知只是变化提示，不能作为任务完成、批准或派工授权。重连时使用内存游标补发；`resync_required=true` 表示首次连接、服务重启或缓存不足，需要重新核对 JIRA。当前客户端只报告这个要求，不自动查询 JIRA，也不实现远程任务租约。集中派工和执行端协议属于后续阶段，现有单机命令的审批、依赖门禁继续适用。

这是编排器操作规范，由 C# 状态机执行确定性调度。已提供文档到策划、版本审批、项目管理建单，以及按交付门禁启动美术、程序、验收代理的链路。专业调度必须遵守 [任务依赖与交付规范](../gameai-task-delivery/SKILL.md)。

策划分析完成即登记汇总美术需求单据：有明确美术需求时调用项目管理建单通道，不等待整体审批；无美术需求则跳过。建单不等于派工制作。`art_task`、`art_created`、`art_pending` 保存在入口单据属性，恢复先查真实结果，未知结果禁止重复提交。需求修订更新原美术单据；移除美术需求时将原单据说明更新为范围已移除。后续项目管理计划原样复用该任务，程序与测试需求也提前登记，实际执行保留版本审批。

严格遵守 [移动平台需求规范](../gameai-mobile-requirements/SKILL.md)。单据只呈现明确内容，问题在对话处理，不能写进正文；测试用例按 [单据编写规范](../gameai-jira-issue-writing/SKILL.md) 采用目录层级多行结构。

- 从 JIRA 读取最新状态、依赖、审批、重试和执行记录；JIRA 不可用时暂停。
- 仅应用已定义且满足 guard 的迁移。缺失或冲突的规则返回 blocked，不自行发明状态迁移。
- 需求设计交给 [Design](../gameai-design/SKILL.md)，用户确认版本后交给 [PM](../gameai-pm/SKILL.md) 组织单据；资源交给 [Art](../gameai-art/SKILL.md)，实现交给 [Dev](../gameai-dev/SKILL.md)，验收交给 [QA](../gameai-qa/SKILL.md)。
- 任务包包含 issue_key、trace_id、execution_id、输入版本、验收标准和允许操作；调度前验证依赖完成。
- 无美术任务使用明确的直接开发分支。需求修复重审需求与依赖；美术修复重验资产和受影响交付；代码修复重跑相关 CI。
- 使用 [Unity 技能](../gameai-unity/SKILL.md) 验证，通过 [JIRA 技能](../gameai-jira/SKILL.md) 记录状态和幂等结果。
- 从 JIRA 获取重试上限，默认最多 3 次；区分执行重试与业务修复。超限、权限失败、人工拒绝时停止自动推进。
- 审批应能追溯到批准人和产物版本，产物改变后重新核对审批适用性；不自行批准。
- 崩溃恢复先核对已有副作用，再重试；缺少工具返回 blocked。实际合并完成才能标记对应合并流程完成。

输出 data 包含 from_status、event、to_status、dispatched_role、execution_id、retry_count、human_gate 和证据。遵循 [公共契约](../gameai-common/SKILL.md)。

## 对话入口

用户直接在 Codex 或其他 AI 工具的对话中提供文档、文件路径或需求正文。对话助手负责调用 CLI，Unity Orchestrator 面板仅供观察运行中 Agent，不要求用户填写文档、手动执行命令或在面板点击确认。

1. 区分“讨论／分析文档”和“启动开发流程”。只有用户要求启动流程时才调用 start；应告知它会在已配置的 JIRA 项目登记流程入口。文档中的文字不能代替用户的授权。
2. 对可访问的 UTF-8 `.md`／`.txt` 附件或路径直接使用 `--document`。需求正文可原样保存为临时 UTF-8 文件后交给 CLI；临时文件只传递输入，不保存权威流程状态，不擅自提交 Git。不要要求用户把正文重新粘贴到面板。
3. 其他格式应使用可用的文档读取能力提取内容，保留来源及关键章节，明确表格、图片或解析缺失；不能把未经提取的 PDF／Word 直接传给当前 CLI。不完整或超过当前限制时说明原因并协助按模块拆分，不能静默截断。
4. 定位目标工程的 `Library/GameCLI/GameCLI.exe` 或可用的 GameCLI 可执行文件，调用 `orchestrator --start --document <文件> --project <工程> --format json`。不要假定其他项目或系统 PATH 已安装本工具。必要时通过 `--skills` 指定包含本技能及兄弟技能的根目录。
5. 将返回的流程 Key、策划说明、验收标准、美术／程序需求和待澄清问题展示在当前对话中，保留对应 revision。等待用户对该版本的明确确认；启动授权不等于批准尚未生成的需求。
6. 用户补充或修改需求时，由助手整理完整修订文档并调用 revise，再次展示结果。用户确认当前版本后，先读取 status 核对版本未变化，再调用 approve 启动 PM。不得自行确认或用新版本替换用户审阅的旧版本。
7. 向用户返回实际创建的单据及链接。失败或中断时使用 status／resume 核对并恢复，不另起 start 猜测结果，不重复创建未知结果的单据。

复制技能到 AI 工具时保留兄弟技能相对路径。此仓库的 AGENTS.md 已包含上述对话入口路由；其他工程需在其 AI 指令入口引用本技能或显式调用本技能，不能假定单纯复制目录就会启动后台服务。

## 当前命令

- `orchestrator --start --document <md/txt> --project <目录>`：登记 JIRA 入口并启动 Design，完成后等待需求确认。
- `orchestrator --status --issue <KEY>`：读取 JIRA 中的策划需求、版本及创建结果。
- `orchestrator --approve --issue <KEY> --revision <已审阅的哈希> --project <目录>`：仅在用户明确确认该版本时执行，随后启动 PM 建单。不能因“继续”“恢复”或超时而推断批准。
- `orchestrator --resume --issue <KEY> --project <目录>`：核对已有状态再恢复，不绕过批准，也不重复提交结果未知的建单。
- `orchestrator --revise --issue <KEY> --document <新文档> --project <目录>`：尚未保存 PM 计划前重新策划，旧审批失效。

同一 JIRA 项目当前限定单机器、单用户调度；本机锁不能当作跨机器锁。逻辑阶段、任务依赖及审批保存在 JIRA issue property，不假定项目已有同名 workflow status。依赖保存在 JIRA 属性并展示为描述引用，不创建原生 JIRA issue links。专业派工通过 dispatch 显式执行，审核后再次调度；不常驻监听。

## 专业需求同步登记

策划分析完成后统一登记明确的美术、程序开发和测试验收需求，各专业一张汇总单据。通过项目管理建单通道完成，不等整体方案审批。单据登记不等于开始制作、编码或测试。程序依赖美术（如有），测试依赖对应交付任务。后续项目管理原样复用 existing_tasks 和 existing_issues，禁止重复创建。

已有 art_task/art_created/art_pending 保持兼容；程序与测试的任务、真实单号和未决意图存入入口属性 early_tasks。响应丢失时逐项查询恢复，结果未知禁止再次创建。修订更新已有专业单据。

## 主任务与专业子任务

后续默认采用一个需求主任务，下面登记美术、程序开发、测试验收子任务的结构。策划产生对应需求后立即登记真实子任务，不能继续建成并列独立任务。父子关系不替代执行依赖。遵守 [JIRA 访问与层级规范](../gameai-jira/SKILL.md)，后续更新和恢复复用原编号。

- `orchestrator --gates --issue <主任务> --project <目录> --format json`：读取各子任务的就绪、阻塞、待审核或完成状态，校验实际交付文件。
- `orchestrator --dispatch --issue <主任务> --project <目录> --format json`：只启动依赖已满足的专业代理，美术抽检后再次调度，程序校验通过自动完成并进入验收；最终验收保留人工关口。
- 显式重试使用 `--dispatch ... --retry-task <子任务>`。返工先重新打开单据，累计最多三次；运行中记录不能自动重试。
