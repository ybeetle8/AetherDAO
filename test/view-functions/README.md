# 模块 9：View 函数与查询 测试

## 文件说明

| 文件 | 测试项 | 说明 |
|------|--------|------|
| view-basic.test.js | 9.1 ~ 9.10 | 用户信息、余额、利息、槽位收益、赎回状态、质押计数、容量、最低额度 |
| view-advanced.test.js | 9.11 ~ 9.20 | 总上限、期限、提取状态、提取历史、提取计数、提取记录、动态限额、网络流入、滑点配置、预览输出 |

## 执行方式

先确保本地节点已启动并完成部署：

```bash
# 运行基础测试 (9.1~9.10)
npx hardhat run test/view-functions/view-basic.test.js --network localhost

# 运行高级测试 (9.11~9.20)
npx hardhat run test/view-functions/view-advanced.test.js --network localhost
```

## 测试覆盖

| 编号 | 测试项 | 文件 |
|------|--------|------|
| 9.1 | getUserInfo | view-basic |
| 9.2 | balanceOf | view-basic |
| 9.3 | principalBalance | view-basic |
| 9.4 | currentStakeValue | view-basic |
| 9.5 | earnedInterest | view-basic |
| 9.6 | rewardOfSlot | view-basic |
| 9.7 | canWithdrawStake | view-basic |
| 9.8 | stakeCount | view-basic |
| 9.9 | getRemainingStakeCapacity | view-basic |
| 9.10 | getMinStakeAmount | view-basic |
| 9.11 | getMaxUserTotalStake | view-advanced |
| 9.12 | getStakePeriods | view-advanced |
| 9.13 | getUserStakeWithdrawalStatus | view-advanced |
| 9.14 | getWithdrawalHistory | view-advanced |
| 9.15 | getWithdrawalCount | view-advanced |
| 9.16 | getWithdrawalRecord | view-advanced |
| 9.17 | maxStakeAmount | view-advanced |
| 9.18 | getRecentNetworkInflow | view-advanced |
| 9.19 | getSlippageConfig | view-advanced |
| 9.20 | previewStakeOutput | view-advanced |
