# Unstake 赎回时 AE 代币的来源分析

## 核心问题

在 `unstake(recordIndex)` 赎回流程中，合约需要将 **AE 兑换成 USDT** 支付给用户。那么这些 AE 是从哪里来的？

## 简短回答

AE 来自 **`recycle()` 回收机制** —— 每次 unstake 结束后，合约调用 `AE.recycle()` 从 Uniswap 流动性池中直接提取 AE 代币到 Staking 合约，为下一次赎回做储备。

---

## 完整的 AE 代币循环

### 第一步：质押时 — AE 进入流动性池

用户调用 `stake()` 时（`StakingBase.sol:229`），执行 `_swapAndAddLiquidity()`（`StakingBase.sol:1297`）：

```
用户存入 100 USDT
    ├── 50 USDT → 通过 Uniswap 兑换为 AE 代币
    ├── 50 USDT + 兑换得到的 AE → 添加为 Uniswap 流动性
    └── LP Token → 发送到 dead 地址（永久锁定）
```

此时 AE 和 USDT 都进入了流动性池，Staking 合约本身**不持有** AE。

### 第二步：赎回时 — 用 AE 兑换 USDT

用户调用 `unstake()` 时（`StakingBase.sol:244`），执行 `_swapAEForReward()`（`StakingBase.sol:1022`）：

```solidity
// StakingBase.sol:1037-1043
ROUTER.swapTokensForExactTokens(
    calculatedReward,    // 需要的 USDT 数量（本金+利息）
    maxXFInput,          // 最大可花费的 AE 数量
    [AE, USDT],          // 兑换路径：AE → USDT
    address(this),       // 接收 USDT 到 Staking 合约
    block.timestamp
);
```

关键点：Staking 合约用**自己持有的 AE 余额**，通过 Uniswap 卖出 AE 换回 USDT。

### 第三步：回收 — 从流动性池补充 AE

赎回完成后（`StakingBase.sol:305`），调用 `AE.recycle(aeTokensUsed)`：

```solidity
// AEBase.sol:451-464
function recycle(uint256 amount) external {
    require(msg.sender == address(staking), "Only staking contract");

    uint256 pairBalance = balanceOf(address(uniswapV2Pair));
    uint256 maxRecyclable = pairBalance / 3;  // 最多回收池中 1/3 的 AE
    uint256 recycleAmount = amount >= maxRecyclable
        ? maxRecyclable
        : amount;

    if (recycleAmount > 0) {
        _update(address(uniswapV2Pair), address(staking), recycleAmount);
        uniswapV2Pair.sync();  // 同步流动性池储备量
    }
}
```

`recycle()` 做了什么：
1. 直接从 Uniswap LP 对（`uniswapV2Pair`）的余额中，**转移 AE 代币到 Staking 合约**
2. 使用 `_update()` 内部转账（不经过 swap，是直接账本转移）
3. 调用 `pair.sync()` 让 LP 合约重新计算储备量
4. 限制单次最多回收池中 AE 的 **1/3**，防止过度抽取

---

## 循环图示

```
                    ┌─────────────────────────────────┐
                    │        Uniswap 流动性池          │
                    │      (AE / USDT 交易对)          │
                    │                                  │
       stake 时     │    AE储备      USDT储备          │    unstake 时
    ──────────────► │   ┌──────┐   ┌──────┐           │ ◄──────────────
    50% USDT买入AE  │   │ +AE  │   │ +USDT│           │  AE卖出换USDT
    AE+USDT加流动性 │   └──────┘   └──────┘           │  (swapTokensForExactTokens)
                    │                                  │
                    └──────────┬───────────────────────┘
                               │
                               │ recycle()
                               │ 直接提取 AE（最多1/3）
                               ▼
                    ┌─────────────────────────────────┐
                    │        Staking 合约              │
                    │                                  │
                    │   AE余额：由 recycle 补充         │
                    │   用于下次 unstake 时卖出换 USDT  │
                    │                                  │
                    └─────────────────────────────────┘
```

---

## 关键理解

| 问题 | 答案 |
|------|------|
| AE 最初来自哪里？ | Staking 合约首次部署后，通过 `recycle()` 从流动性池获取 |
| 为什么不直接从池里取 USDT？ | 设计上通过卖出 AE 换 USDT，对 AE 产生卖压，再通过 recycle 补充 |
| recycle 会不会掏空池子？ | 不会，每次最多取池中 AE 的 1/3（`maxRecyclable = pairBalance / 3`） |
| 如果 Staking 合约 AE 余额不足？ | `_calculateMaxAEInput()` 会限制输入量，可能导致无法兑换足够 USDT |

---

## 涉及的代码文件

- **unstake 主逻辑**：`contracts/AE-Staking/src/abstract/StakingBase.sol:244-308`
- **AE → USDT 兑换**：`contracts/AE-Staking/src/abstract/StakingBase.sol:1022-1050`
- **AE 回收机制**：`contracts/AE/src/abstract/AEBase.sol:451-464`
- **质押时加流动性**：`contracts/AE-Staking/src/abstract/StakingBase.sol:1297-1331`
