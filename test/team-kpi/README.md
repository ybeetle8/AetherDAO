# 模块 5：团队等级与 KPI 测试

## 执行方式

确保本地节点已启动并已部署合约：

```bash
# 先启动节点（如果还没启动）
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 部署合约（另一个终端）
npx hardhat run scripts/deployAE.js --network localhost
```

运行测试：

```bash
# 第一部分 (5.1~5.5)
npx hardhat run test/team-kpi/team-kpi-basic.test.js --network localhost

# 第二部分 (5.6~5.9)
npx hardhat run test/team-kpi/team-kpi-advanced.test.js --network localhost
```

## 测试用例

| 编号 | 测试项 | 文件 |
|------|--------|------|
| 5.1 | 团队 KPI 计算（下级质押增加上级 KPI，不含自身） | team-kpi-basic.test.js |
| 5.2 | 多级 KPI 累计 | team-kpi-basic.test.js |
| 5.3 | V1-V9 KPI 门槛值验证 | team-kpi-basic.test.js |
| 5.4 | 个人质押等级门槛验证 | team-kpi-basic.test.js |
| 5.5 | 双维度取低 | team-kpi-basic.test.js |
| 5.6 | 等级动态变化（赎回后等级下降） | team-kpi-advanced.test.js |
| 5.7 | getTeamPerformanceDetails 返回值验证 | team-kpi-advanced.test.js |
| 5.8 | getTeamRewardThresholds 返回 9 个门槛值 | team-kpi-advanced.test.js |
| 5.9 | getTeamRewardRates 返回 9 个奖励比例 | team-kpi-advanced.test.js |
