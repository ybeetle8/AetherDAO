# maxStakeAmount 返回 600 而非 1000 的原因分析

## 问题描述

前端调用质押合约的 `maxStakeAmount()` 函数，期望返回 1000（即 MAX_STAKE_LIMIT），但实际返回了 600。

## 核心结论

**`maxStakeAmount()` 不是一个固定值，而是一个动态计算的值。** 返回 600 是因为当前 LP 池中 USDX 储备量约为 60,000 USDX，池子容量限制（1% of pool）比硬上限（1000）更小，成为了实际的约束条件。

## 函数源码分析

**文件**: `contracts/AE-Staking/src/abstract/StakingBase.sol:1048-1059`

```solidity
function maxStakeAmount() public view returns (uint256 maxAmount) {
    uint256 recentInflow = getRecentNetworkInflow();
    uint112 poolReserveUsdx = AE.getUSDXReserve();
    uint256 onePercentOfPool = poolReserveUsdx / POOL_PERCENTAGE_DIVISOR; // ÷ 100

    if (recentInflow > onePercentOfPool) {
        return 0;
    } else {
        uint256 availableCapacity = onePercentOfPool - recentInflow;
        return _min256(availableCapacity, MAX_STAKE_LIMIT);
    }
}
```

## 计算逻辑拆解

函数的返回值由三个因素共同决定：

| 步骤 | 变量 | 含义 |
|------|------|------|
| 1 | `recentInflow` | 最近 1 分钟内全网的质押流入总量 |
| 2 | `poolReserveUsdx` | AE/USDX LP 池中 USDX 的储备量 |
| 3 | `onePercentOfPool` | 池子储备的 1%（= poolReserveUsdx / 100） |

**最终返回值** = `min(onePercentOfPool - recentInflow, MAX_STAKE_LIMIT)`

即取**池子可用容量**和**硬上限 1000**中的**较小值**。

## 返回 600 的具体推导

假设当前链上状态：

```
poolReserveUsdx  ≈ 60,000 USDX  （LP池中USDX储备）
recentInflow     ≈ 0 USDX       （最近1分钟无人质押）
POOL_PERCENTAGE_DIVISOR = 100
MAX_STAKE_LIMIT  = 1000 USDX
```

计算过程：

```
onePercentOfPool = 60,000 / 100 = 600
availableCapacity = 600 - 0 = 600
return min(600, 1000) = 600  ← 池子容量是瓶颈
```

**所以返回 600 是因为池子里只有约 60,000 USDX，其 1% = 600，小于硬上限 1000。**

## 什么情况下会返回 1000？

当 LP 池中 USDX 储备 ≥ 100,000 USDX，且最近 1 分钟无人质押时：

```
onePercentOfPool = 100,000 / 100 = 1000
availableCapacity = 1000 - 0 = 1000
return min(1000, 1000) = 1000  ✓
```

**要使 maxStakeAmount 返回 1000，需要 LP 池中至少有 100,000 USDX 的储备。**

## 相关常量汇总

**文件**: `contracts/AE-Staking/src/abstract/StakingBase.sol:54-110`

| 常量 | 值 | 用途 |
|------|-----|------|
| `MIN_STAKE_AMOUNT` | 100 USDX | 单笔最低质押额 |
| `MAX_STAKE_LIMIT` | 1000 USDX | 单笔最高质押额（硬上限） |
| `MAX_USER_TOTAL_STAKE` | 10,000 USDX | 单用户最高累计质押 |
| `POOL_PERCENTAGE_DIVISOR` | 100 | 用于计算池子的 1% |
| `NETWORK_CHECK_INTERVAL` | 1 分钟 | 近期流入的检测窗口 |
| `DAILY_NETWORK_STAKE_LIMIT` | 50,000 USDX | 全网每日质押上限 |

## 影响 maxStakeAmount 的动态因素

### 1. LP 池 USDX 储备（主要因素）

`getUSDXReserve()` 读取 Uniswap V2 LP 对中的 USDX 储备：

```solidity
// contracts/AE/src/abstract/AEBase.sol:507-517
function getUSDXReserve() external view returns (uint112 usdxReserve) {
    try uniswapV2Pair.getReserves() returns (
        uint112 reserve0, uint112 reserve1, uint32
    ) {
        return uniswapV2Pair.token0() == USDX ? reserve0 : reserve1;
    } catch {
        return 0;
    }
}
```

池子越大 → 1% 越大 → maxStakeAmount 越高（上限 1000）。

### 2. 近期网络流入（次要因素）

`getRecentNetworkInflow()` 统计最近 1 分钟内全网的质押总额：

```solidity
// contracts/AE-Staking/src/abstract/StakingBase.sol:1021-1046
function getRecentNetworkInflow() public view returns (uint256 recentInflow) {
    // 遍历 t_supply 记录，找出最近1分钟内的净流入
    // 返回 totalSupply - previousTotalSupply
}
```

如果最近 1 分钟有人质押了 X，则可用容量进一步减少 X。

## 不同池子规模下的 maxStakeAmount 对照表

| 池子 USDX 储备 | 1% of Pool | 近期流入为 0 时的返回值 | 约束来源 |
|----------------|-----------|----------------------|---------|
| 30,000 | 300 | **300** | 池子容量 |
| 50,000 | 500 | **500** | 池子容量 |
| 60,000 | 600 | **600** ← 当前状态 | 池子容量 |
| 80,000 | 800 | **800** | 池子容量 |
| 100,000 | 1,000 | **1,000** | 两者持平 |
| 150,000 | 1,500 | **1,000** | 硬上限 |
| 200,000 | 2,000 | **1,000** | 硬上限 |

## 设计意图

这个动态限制机制的目的是**保护 LP 池的流动性**：

1. **防止大额质押冲击池子** — 单笔质押不能超过池子 USDX 储备的 1%
2. **防止短时间内大量质押** — 1 分钟内的累计质押量也受 1% 限制
3. **池子越大，允许的单笔越大** — 随着流动性增长，限制自动放宽
4. **硬上限兜底** — 无论池子多大，单笔不超过 1000 USDX

## 总结

- `MAX_STAKE_LIMIT = 1000` 是硬上限，代码里确实写的是 1000
- 但 `maxStakeAmount()` 取的是 `min(池子1%, 1000)`
- 当前池子 USDX 约 60,000，所以 1% = 600，成为实际瓶颈
- **这是正常的保护机制，不是 bug**
- 要让返回值达到 1000，需要 LP 池至少有 100,000 USDX
