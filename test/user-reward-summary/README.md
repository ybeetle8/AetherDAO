# 用户累计收益记录功能测试

## 功能说明

为每个用户地址新增两个链上累计值，记录已领取（实际到账）的收益金额：

| 字段 | 含义 | 累加时机 |
|------|------|----------|
| `totalClaimedStakingReward` | 用户累计质押收益 | `unstake()` / `withdrawInterest()` 时累加 `userPayout` |
| `totalClaimedCommunityReward` | 用户累计社区收益 | 团队奖励分配时累加 `memberReward` |

## 运行方式

### 前置条件

1. 启动本地测试网络（Fork BSC 主网）：

```bash
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000
```

2. 部署合约（在另一个终端）：

```bash
npx hardhat run scripts/deployAE.js --network localhost
```

### 运行测试

```bash
npx hardhat run test/user-reward-summary/user-reward-summary.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deployAE.js --network localhost && \
npx hardhat run test/user-reward-summary/user-reward-summary.test.js --network localhost
```

## 测试用例

| 编号 | 测试项 | 说明 |
|------|--------|------|
| URS-1 | 初始值为零 | 未操作用户两项累计均为 0 |
| URS-2 | unstake 后质押收益累加 | unstake 后 `totalClaimedStakingReward` == userPayout |
| URS-3 | withdrawInterest 后质押收益累加 | withdrawInterest 后 `totalClaimedStakingReward` 增加 |
| URS-4 | 社区收益累加 | 下级 unstake 后，上级的 `totalClaimedCommunityReward` 增加 |
| URS-5 | 多次操作正确累加 | 多次 unstake 后质押收益持续累加 |
| URS-6 | getUserRewardSummary 返回一致 | view 函数返回值与直接查 mapping 一致 |
| URS-7 | 打印收益汇总 | 打印用户的质押收益总数和社区收益总数 |

## 修改的合约文件

| 文件 | 修改内容 |
|------|----------|
| `contracts/AE-Staking/src/interfaces/IStaking.sol` | 新增 2 个 event、`getUserRewardSummary` 函数声明 |
| `contracts/AE-Staking/src/abstract/StakingBase.sol` | 新增 2 个 mapping、修改 `unstake()` / `withdrawInterest()` / `_distributeHybridRewards()` / `_distributeTeamReward()`、实现 `getUserRewardSummary()` |
