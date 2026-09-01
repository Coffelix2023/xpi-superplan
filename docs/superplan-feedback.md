# xpi-superplan实际使用反馈

1. 为命令`/xpi-superplan <参数>`添加命令参数如下(参考 openspec 的`/opsx-<参数>`命令):
  - `/xpi-superplan start`: 初始化一个计划并进入交互流程(agent以引导方式, 用交互面板和可视化的`design_deck`引导挖掘用户的选型和决策, 该功能比较全面综合, 相当于省去用户其他命令参数的使用, 同时起到指导用户如何使用其他命令参数的教程,因为agent会主动提出进入哪种命令模式,通过实际事件让用户熟悉各命令的用法) (讨论: 是否需要将这个工作流形成`xpi-superplan`专属skill?确保每次agent都严格遵循结构化的咨询).
  - `/xpi-superplan grillme`: 盘问模式, 采用`grilling`技能深度探索用户需求, 采用交互面板 + `deck`甲板可视化界面让用户选型做决策.盘问结束保存符合`xpi-superplan`目录结构的决策结论.
  - `/xpi-superplan save`: 结束explore/brainstorm/grillme等流程, 直接保存符合`xpi-superplan`目录结构的决策结论与tasks文档
  - `/xpi-superplan archive`: 参考openspec的`/opsx-archive`同样的流程(目录结构的变更归档)
  - `/xpi-superplan fix`: 无论用户的开发任务是否归档, 都可以使用该命令插入用户对于开发任务的反馈意见,并再次采用`/xpi-superplan grillme`对修改意见盘问,摸清用户具体想法/决策, 然后更新结论和任务(注意不会覆盖之前版本,而是新建version)
  - `/xpi-superplan fix-fast`: 同fix, 不过是快速模式,以最简洁的方式修改,不要深入盘问额外的问题, 仅针对当前用户反馈需求快速修改, 然后更新结论和任务(注意不会覆盖之前版本,而是新建version)

2. 当用户输入命令`/xpi-superplan`直接发送(缺少正文)的情况下, 视为`/xpi-superplan start`
