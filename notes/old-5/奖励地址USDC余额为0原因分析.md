# 奖励地址余额为 0 原因分析

## 问题描述

运行 `checkAddressUsdc.js` 后，以下地址的 AE 和 USDC 余额均为 0：

| 地址名称 | 地址 | 余额 |
|----------|------|------|
| 买入税节点奖励地址 | `0x06Ba...D721d9` | 0.0 AE |
| 买入税社区奖励地址 | `0xeE12...CE5537` | 0.0 AE |
| 营销基金地址 | `0x498B...63D17` | 0.0 AE |
| 周Top15奖励地址 | `0x82B3...DF591` | 0.0 USDC |

按设计，这些地址应在买入/卖出时收到费用。为什么一直为 0？

## 根本原因：质押合约在白名单中，所有 swap 绕过了费用逻辑

### 费用分配的触发条件

费用分配只在 `_handleBuy` 和 `_handleSell` 中执行：

- **买入时** → 2% AE 到节点奖励地址，1% AE 到社区奖励地址（`AEBase.sol:743-768`）
- **卖出时** → 1.5% AE 到营销基金地址（`AEBase.sol:794-800`）

但 `_handleBuy` / `_handleSell` 能否被调用，取决于 `_update` 的白名单检查：

```solidity
// AEBase.sol:656-663
function _update(address from, address to, uint256 value) internal override {
    bool isWhitelisted = feeWhitelisted[from] || feeWhitelisted[to];

    if (isWhitelisted) {
        super._update(from, to, value);  // 直接转账，跳过所有费用逻辑
        return;
    }

    // 只有走到这里才会进入 _handleBuy / _handleSell
    bool isBuy = _isBuyOperation(from, to);
    bool isSell = _isSellOperation(from, to);
    ...
}
```

**关键**：只要交易的 `from` 或 `to` 任一方在白名单中，就直接走 `super._update`，完全跳过费用分配。

### 质押合约在白名单中

```solidity
// AEBase.sol:343
feeWhitelisted[address(staking)] = true;
```

### 质押/解质押的 swap 流程

**质押（stake）** 过程中（`StakingBase.sol:1600-1618`）：
1. 用户 USDX → 质押合约
2. 质押合约通过 Router swap：USDX → AE（**买入 AE**）
3. swap 过程：Pair 将 AE 转给 Staking 合约
4. 此时 `to = Staking`（白名单）→ **白名单命中，跳过 `_handleBuy`**
5. 买入税节点奖励和社区奖励地址拿不到任何 AE

**解质押（unstake）** 过程中（`StakingBase.sol:1312-1340`）：
1. 质押合约通过 Router swap：AE → USDX（**卖出 AE**）
2. swap 过程：Staking 合约将 AE 转给 Pair
3. 此时 `from = Staking`（白名单）→ **白名单命中，跳过 `_handleSell`**
4. 营销基金地址拿不到任何 AE

### 流程图

```
普通用户通过 DEX 买入:
  Pair → 用户地址 (双方都不在白名单)
  → _isBuyOperation = true → _handleBuy()
  → 2% 到节点奖励, 1% 到社区奖励 ✅ 正常收费

质押合约通过 Router 买入:
  Pair → Staking 合约 (Staking 在白名单中)
  → isWhitelisted = true → super._update() 直接返回
  → 完全跳过 _handleBuy() ❌ 不收费
```

### 为什么周Top15奖励地址也为 0

weeklyTop15RewardAddress 收到 USDC 的唯一途径是**盈利税分配**（`AEBase.sol:855-859`），需要用户卖出 AE 时满足 `estimatedUSDXFromSale > userCurrentInvestment`。在当前测试环境中：

1. 质押/解质押的 swap 因白名单跳过了费用逻辑（如上所述）
2. 即使有普通用户的卖出操作，买入后立即卖出因 AMM 滑点必然亏损，无法触发盈利税

## 另一个问题：`setPresaleActive(false)` 未 await

```javascript
// deployAE.js:366
ae.setPresaleActive(false);  // ← 没有 await！
```

部署脚本第 366 行调用了 `setPresaleActive(false)` 但没有 `await`。之后第 379 行 `process.exit(0)` 可能在交易确认前就退出了进程。如果预售模式没有成功关闭，所有普通用户的买入操作都会被 `NotAllowedBuy()` revert（`AEBase.sol:736-741`），进一步导致费用地址无法收到任何代币。

## 总结

| 地址 | 余额为 0 的直接原因 | 根本原因 |
|------|---------------------|----------|
| 买入税节点奖励 | 0 AE | 质押 swap 因白名单跳过 `_handleBuy` |
| 买入税社区奖励 | 0 AE | 质押 swap 因白名单跳过 `_handleBuy` |
| 营销基金地址 | 0 AE | 解质押 swap 因白名单跳过 `_handleSell` |
| 周Top15奖励 | 0 USDC | 无盈利卖出触发盈利税 |

**这是设计预期行为**：质押合约加入白名单是为了避免质押/解质押操作被收取交易税（否则会影响质押收益计算的准确性）。这些费用地址只有在**普通用户通过 DEX 直接买卖 AE**时才会收到代币。当前测试环境中只进行了质押/解质押操作，没有普通用户的 DEX 交易，所以这些地址余额为 0。
