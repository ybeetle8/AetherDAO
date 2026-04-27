# 每日全网质押限额测试

## 功能说明

测试每日全网质押限额机制：

- **每日全网限额**: 50,000 USDX（所有用户共享）
- **刷新时间**: 北京时间每天 14:00（UTC 06:00）
- **重置方式**: 惰性重置，下一次 `stake()` 调用时自动重置

## 测试用例

| 编号 | 测试项 | 说明 |
|------|--------|------|
| DL-1 | 限额常量验证 | `DAILY_NETWORK_STAKE_LIMIT` = 50,000 USDX |
| DL-2 | 正常质押消耗额度 | 质押 500 USDX 后，剩余额度减少 500 |
| DL-3 | 多用户共享限额 | 用户 A 质押后，用户 B 的可用额度同步减少 |
| DL-4 | 超出限额被拒绝 | 累计质押接近 50,000 后，超出部分 revert |
| DL-5 | 周期刷新后额度恢复 | 用 `evm_increaseTime` 推进到下个周期，额度恢复为 50,000 |
| DL-6 | 剩余额度查询准确 | `getDailyStakeRemaining()` 在各种状态下返回正确值 |
| DL-7 | 已使用额度查询 | `getDailyStakeUsed()` 返回当前周期已消耗量 |
| DL-8 | 下次刷新时间查询 | `getNextDailyResetTime()` 返回正确的下次刷新时间戳 |
| DL-9 | 与现有限制共存 | 每日限额与单笔限制、用户累计限制互不干扰 |

## 运行方式

### 前置条件

1. 启动本地 Hardhat 节点（Fork BSC 主网）：

```bash
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000
```

2. 部署合约（在另一个终端）：

```bash
npx hardhat run scripts/deployAE.js --network localhost
```

### 运行测试

```bash
npx hardhat run test/daily-stake-limit/daily-stake-limit.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deployAE.js --network localhost && \
npx hardhat run test/daily-stake-limit/daily-stake-limit.test.js --network localhost
```

## 修改的合约文件

| 文件 | 修改内容 |
|------|----------|
| `contracts/AE-Staking/src/abstract/StakingBase.sol` | 新增常量、状态变量、`_checkAndUpdateDailyLimit()`、`_getCurrentPeriodStart()`、view 函数 |
| `contracts/AE-Staking/src/interfaces/IStaking.sol` | 新增 view 函数声明 |
