# getClaimedNetInterest 赎回后返回 0 问题分析

## 问题现象

用户质押 200 USDC / 7天，中途领取过一次收益（到账 0.68），到期赎回后调用 `getClaimedNetInterest()` 返回 **0**。

## 根因分析

### 合约代码逻辑

```solidity
// StakingBase.sol:590-594
function getClaimedNetInterest(address user) external view returns (uint256 netInterest) {
    uint256 stakingReward = totalClaimedStakingReward[user];       // ①
    uint256 principalReturned = totalPrincipalReturned[user];      // ②
    netInterest = stakingReward > principalReturned ? stakingReward - principalReturned : 0;  // ③
}
```

计算公式：**净利息 = totalClaimedStakingReward - totalPrincipalReturned**

### 问题出在哪里

在 `unstake()` 中（第 289-364 行），关键赋值：

```solidity
totalClaimedStakingReward[msg.sender] += userPayout;      // 第 354 行
totalPrincipalReturned[msg.sender] += principalAmount;     // 第 358 行
```

**核心问题：`userPayout` 是扣除了全部费用（教育基金+团队奖励+赎回手续费）后的金额，它包含了本金部分，但本金也被扣了费。**

### 费用扣除流程详解

以 unstake 为例，看 `userPayout` 的推导过程：

```
① usdxReceived = swap 得到的 USDX 总额（本金 + 利息）
② interestEarned = usdxReceived - principalAmount   （纯利息部分）
③ educationFund = interestEarned × 5%               （从利息中扣）
④ teamFee = interestEarned × 35%                    （从利息中扣）
⑤ userPayout = usdxReceived - educationFund - teamFee
⑥ redemptionFee = userPayout × 5%                   （从 userPayout 整体扣，包含本金！）
⑦ 最终 userPayout = ⑤ - redemptionFee
```

**第⑥步是关键：赎回手续费是对 `userPayout`（本金+剩余利息）整体收 5%，而不仅是对利息收。**

### 数值验证

假设：质押 200 USDC，7天到期，日利率 0.6%，总利息 = 200 × 0.6% × 7 = 8.4 USDC

#### 场景 A：未中途领取，直接到期赎回

| 步骤 | 金额 |
|------|------|
| usdxReceived（假设 swap 无滑点） | 208.4 |
| interestEarned | 8.4 |
| educationFund（8.4 × 5%） | 0.42 |
| teamFee（8.4 × 35%） | 2.94 |
| userPayout（扣教育+团队后） | 208.4 - 0.42 - 2.94 = **205.04** |
| redemptionFee（205.04 × 5%） | 10.252 |
| **最终 userPayout** | **194.788** |
| principalAmount | **200** |

结果：
- `totalClaimedStakingReward` = **194.788**
- `totalPrincipalReturned` = **200**
- **194.788 < 200 → `getClaimedNetInterest` = 0**

#### 场景 B：中途领取 1 天利息，再到期赎回

**第1次：withdrawInterest（1天利息 = 1.2）**

| 步骤 | 金额 |
|------|------|
| usdxReceived | 1.2 |
| educationFund（1.2 × 5%） | 0.06 |
| teamFee（1.2 × 35%） | 0.42 |
| userPayout（扣教育+团队后） | 1.2 - 0.06 - 0.42 = 0.72 |
| redemptionFee（0.72 × 5%） | 0.036 |
| **最终 userPayout** | **0.684** |

此时：`totalClaimedStakingReward` = 0.684，`totalPrincipalReturned` = 0

**第2次：unstake（到期赎回）**

剩余利息 = 8.4 - 1.2 = 7.2，usdxReceived = 200 + 7.2 = 207.2

| 步骤 | 金额 |
|------|------|
| interestEarned | 7.2 |
| educationFund（7.2 × 5%） | 0.36 |
| teamFee（7.2 × 35%） | 2.52 |
| userPayout（扣教育+团队后） | 207.2 - 0.36 - 2.52 = 204.32 |
| redemptionFee（204.32 × 5%） | 10.216 |
| **最终 userPayout** | **194.104** |

结果：
- `totalClaimedStakingReward` = 0.684 + 194.104 = **194.788**
- `totalPrincipalReturned` = 0 + 200 = **200**
- **194.788 < 200 → `getClaimedNetInterest` = 0**

无论是否中途领取，结果一样是 0。

## 根本原因总结

**赎回手续费（5%）是对 `userPayout` 整体（本金+剩余利息）收取，而不是仅对利息收取。** 这导致：

1. `totalClaimedStakingReward` 累计的是扣除全部费用后的到账金额（本金被扣了费）
2. `totalPrincipalReturned` 累计的是原始本金（未扣费）
3. 当利息较少时，本金部分被扣掉的赎回手续费 > 利息扣费后剩余，导致 `stakingReward < principalReturned`，结果被截断为 0

**用公式表达：**

```
设 P = 本金, I = 利息

educationFund = I × 5%
teamFee = I × 35%
redemptionFee = (P + I × 60%) × 5%

最终到账 = P + I × 60% - (P + I × 60%) × 5%
         = (P + I × 60%) × 95%
         = 0.95P + 0.57I

净利息 = 最终到账 - P = 0.57I - 0.05P

当 0.57I < 0.05P，即 I < P × 0.0877（约8.77%）时，净利息为负 → 返回 0
```

对 7 天订单：I = P × 0.6% × 7 = 0.042P，远小于 0.0877P，所以必定返回 0。

实际上 **只有当利息超过本金的 ~8.77% 时**，`getClaimedNetInterest` 才能返回正数。这意味着：
- 7天订单（利息率 4.2%）→ **必定返回 0**
- 30天订单（利息率 18%）→ 可以返回正数
- 90天订单（利息率 54%）→ 可以返回正数

## 已实施修复：方案 A — 分别追踪净利息

### 改动概述

新增独立 `totalClaimedNetInterest` mapping，在 `unstake()` 和 `withdrawInterest()` 中分别计算并累加纯利息到账金额，`getClaimedNetInterest()` 直接返回该 mapping 的值。

### 改动文件

**StakingBase.sol：**

#### 1. 新增状态变量（第 201 行）

```solidity
/// @notice 用户累计已领取的净利息 (扣除教育基金+团队奖励+赎回手续费后的纯利息到账金额)
mapping(address => uint256) public totalClaimedNetInterest;
```

#### 2. unstake() 中新增净利息追踪（第 363-366 行）

```solidity
// 累计净利息（利息扣除教育基金+团队奖励后，再按比例扣赎回手续费）
uint256 interestAfterEduTeam = interestEarned - educationFund - teamFee;
uint256 interestRedemptionFee = (interestAfterEduTeam * REDEMPTION_FEE_RATE) / BASIS_POINTS_DENOMINATOR;
totalClaimedNetInterest[msg.sender] += interestAfterEduTeam - interestRedemptionFee;
```

计算逻辑：
- `interestEarned` 是毛利息（已知值）
- 扣掉教育基金（5%）和团队奖励（35%）后得到 `interestAfterEduTeam`（= interestEarned × 60%）
- 再按比例扣赎回手续费（5%），得到纯利息到账金额（= interestEarned × 60% × 95% = interestEarned × 57%）

#### 3. withdrawInterest() 中新增净利息追踪（第 457-458 行）

```solidity
// 累计净利息（withdrawInterest 的 userPayout 全部是纯利息，无本金）
totalClaimedNetInterest[user] += userPayout;
```

`withdrawInterest()` 没有本金返还，`userPayout` 已经是扣除全部费用后的纯利息，直接累加即可。

#### 4. getClaimedNetInterest() 简化为直接读取（第 601-602 行）

```solidity
function getClaimedNetInterest(address user) external view returns (uint256 netInterest) {
    netInterest = totalClaimedNetInterest[user];
}
```

**IStaking.sol：** 接口注释同步更新，函数签名不变。

### 修复后数值验证

沿用之前的例子：质押 200 USDC / 7天，日利率 0.6%

#### 场景 B（中途领取 + 到期赎回）

**第1次：withdrawInterest（1天利息 = 1.2）**
- userPayout = 0.684（扣全部费用后）
- `totalClaimedNetInterest` += 0.684 → **累计 0.684**

**第2次：unstake（到期赎回，剩余利息 = 7.2）**
- interestEarned = 7.2
- educationFund = 0.36, teamFee = 2.52
- interestAfterEduTeam = 7.2 - 0.36 - 2.52 = 4.32
- interestRedemptionFee = 4.32 × 5% = 0.216
- 净利息 = 4.32 - 0.216 = **4.104**
- `totalClaimedNetInterest` += 4.104 → **累计 4.788**

**最终 `getClaimedNetInterest()` = 4.788** ✅（不再是 0）

### 前端调用方式

不变，仍然一次调用：

```javascript
const netInterest = await staking.getClaimedNetInterest(userAddress);
```

## 总结

| 项目 | 说明 |
|------|------|
| 问题 | `getClaimedNetInterest` 在赎回后返回 0 |
| 原因 | 旧逻辑用 `totalClaimedStakingReward - totalPrincipalReturned` 反推，赎回手续费对本金也收了 5%，导致差值为负 |
| 修复方案 | 方案 A：新增 `totalClaimedNetInterest` mapping 独立追踪纯利息到账金额 |
| 影响范围 | 仅影响统计展示，不改变资金流和费用结构 |
| 状态 | ✅ 已实施，编译通过 |
