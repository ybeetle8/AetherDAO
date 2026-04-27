# C-02: withdrawInterest + unstake 双重利息漏洞修复验证测试

## 修复内容

`StakingBase._burn()` 在计算 unstake 奖励时, 调用 `_calculateStakeReward()` 获得的是从质押开始到当前时刻的全部复利总额, 但完全没有扣除用户已通过 `withdrawInterest` 提取的利息部分, 导致利息被双重发放。

修复方案 (方案 A): 在 `_burn()` 中读取 `withdrawnInterest` 并从 `reward` 中扣除。

```solidity
// [修复 C-02] 扣除已通过 withdrawInterest 提取的利息
uint256 alreadyWithdrawn = withdrawnInterest[sender][index];
if (alreadyWithdrawn > 0) {
    require(reward > alreadyWithdrawn, "Reward calculation error");
    reward -= alreadyWithdrawn;
}
```

此修复同时消除了 H-02 (费用基数膨胀) 问题。

## 测试项说明

| 编号 | 测试项 | 说明 |
|------|--------|------|
| DI-1 | 仅 unstake 行为不变 | 未调用 withdrawInterest 的用户, unstake 行为与修复前一致 |
| DI-2 | 单次 withdrawInterest 后 unstake | 总利息到账不超过全额利息, 验证不重复发放 |
| DI-3 | 多次 withdrawInterest 后 unstake | 多次提取 + unstake 的总利息不超额 |
| DI-4 | 到期后全额提取利息再 unstake | unstake 的 interestEarned 趋近 0, 仅返还本金 |
| DI-5 | 从未 withdrawInterest 的 90 天期 | alreadyWithdrawn = 0, unstake 利息接近 full interest |
| DI-6 | 对照组比较 | 两用户同额质押, 一个 WI+US vs 仅 US, 总利息一致 |
| DI-7 | H-02 费用基数验证 | unstake 费用基数不含已提取利息, 教育基金/团队奖励正确 |

## 执行方式

确保本地节点已启动且已部署合约:

```bash
# 1. 启动本地节点 (Fork BSC 主网)
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 2. 编译并部署合约 (在另一个终端)
npx hardhat compile
npx hardhat run scripts/deploySYI.js --network localhost

# 3. 运行测试
npx hardhat run test/double-interest-fix/double-interest-fix.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deploySYI.js --network localhost && \
npx hardhat run test/double-interest-fix/double-interest-fix.test.js --network localhost
```
