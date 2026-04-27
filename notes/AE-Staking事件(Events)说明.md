# AE-Staking 合约事件 (Events) 说明

本文档整理了 AE-Staking 合约中所有与**质押、团队奖励、推荐人**相关的事件，供前端对接参考。

事件定义来源：
- `contracts/AE-Staking/src/interfaces/IStaking.sol`
- `contracts/AE-Staking/src/abstract/StakingBase.sol`

---

## 一、质押相关事件

### 1.1 Staked — 用户质押

用户成功质押 USDX 时触发。

```solidity
event Staked(
    address indexed user,      // 质押者地址
    uint256 amount,            // 质押金额
    uint256 timestamp,         // 区块时间戳
    uint256 index,             // 质押记录索引
    uint256 stakeTime          // 质押周期时长（秒）
);
```

**触发函数：** `stake()`

**前端用途：** 监听用户质押成功，更新质押列表、余额显示。

---

### 1.2 WithdrawalCompleted — 提取完成（解除质押）

用户到期赎回本金+收益时触发，包含完整的费用分配明细。

```solidity
event WithdrawalCompleted(
    address indexed user,          // 用户地址
    uint256 indexed stakeIndex,    // 质押记录索引
    uint256 principalAmount,       // 原始质押本金
    uint256 calculatedReward,      // 计算的总收益
    uint256 usdxReceived,          // 实际从 swap 获得的 USDX
    uint256 aeTokensUsed,          // swap 消耗的 AE 代币数量
    uint256 referralFee,           // 支付给推荐人的费用
    uint256 teamFee,               // 团队费用总计
    uint256 userPayout,            // 用户最终到账金额
    uint256 interestEarned,        // 赚取的利息
    uint40 withdrawalTime          // 提取时间戳
);
```

**触发函数：** `unstake()` → 内部 `_recordWithdrawal()`

**前端用途：** 展示赎回详情（本金、收益、各项手续费、实际到账金额）。

---

### 1.3 InterestWithdrawn — 提前提取利息

用户在质押到期前提取已累积利息时触发。

```solidity
event InterestWithdrawn(
    address indexed user,          // 用户地址
    uint256 indexed stakeIndex,    // 质押记录索引
    uint256 interestAmount,        // 提取的利息金额
    uint256 usdxReceived,          // 实际从 swap 获得的 USDX
    uint256 aeTokensUsed,          // swap 消耗的 AE 代币数量
    uint256 referralFee,           // 教育基金费用 (5%)
    uint256 teamFee,               // 团队费用 (35%)
    uint256 userPayout,            // 用户最终到账金额
    uint40 timestamp               // 提取时间戳
);
```

**触发函数：** `withdrawInterest()`

**前端用途：** 展示利息提取详情，更新已提取利息累计额。

---

### 1.4 RewardPaid — 奖励发放（兼容事件）

奖励发放时触发的旧版兼容事件。

```solidity
event RewardPaid(
    address indexed user,      // 接收奖励的地址
    uint256 reward,            // 奖励金额
    uint40 timestamp,          // 区块时间戳
    uint256 index              // 质押记录索引
);
```

**触发函数：** `_recordWithdrawal()` (内部函数)

**前端用途：** 可用于追踪奖励发放历史。

---

### 1.5 RedemptionFeeCollected — 赎回手续费收取

赎回（unstake 或 withdrawInterest）时收取手续费后触发。

```solidity
event RedemptionFeeCollected(
    address indexed user,          // 用户地址
    uint256 stakeIndex,            // 质押记录索引
    uint256 aeAmount,              // 手续费的 AE 代币数量
    uint256 usdxAmount,            // 手续费的 USDX 等值
    address indexed feeRecipient,  // 手续费接收地址
    uint256 timestamp              // 时间戳
);
```

**触发函数：** `unstake()`、`withdrawInterest()`

**前端用途：** 展示手续费收取明细。

---

### 1.6 FirstTime7DayStakeUsed — 首次使用7天质押

用户首次使用7天期质押时触发。

```solidity
event FirstTime7DayStakeUsed(
    address indexed user,      // 用户地址
    uint256 timestamp          // 时间戳
);
```

**触发函数：** `stake()`

**前端用途：** 可用于前端提示用户已使用过首次7天质押优惠。

---

### 1.7 Stake7DayUsageReset — 7天质押使用次数重置

管理员重置用户的7天质押使用记录时触发。

```solidity
event Stake7DayUsageReset(
    address indexed user,      // 用户地址
    uint256 timestamp          // 时间戳
);
```

**触发函数：** `reset7DayStakeUsage()`、`batchReset7DayStakeUsage()`

**前端用途：** 管理后台监控。

---

### 1.8 Transfer — 质押代币转账（铸造/销毁）

质押代币铸造（mint）或销毁（burn）时触发。

```solidity
event Transfer(
    address indexed from,      // 来源地址 (address(0) 为铸造)
    address indexed to,        // 目标地址 (address(0) 为销毁)
    uint256 amount             // 数量
);
```

**触发函数：** `_update()` (内部函数)

**前端用途：** 追踪质押凭证代币的铸造和销毁。

---

## 二、推荐人相关事件

### 2.1 ReferralBound — 绑定推荐人

用户自行绑定推荐人时触发。

```solidity
event ReferralBound(
    address indexed user,      // 被推荐的用户
    address indexed referrer,  // 推荐人地址
    uint256 timestamp          // 绑定时间戳
);
```

**触发函数：** `lockReferral()`

**前端用途：** 确认推荐关系绑定成功，显示推荐人信息。

---

### 2.2 AdminReferralBound — 管理员绑定推荐人

管理员为用户绑定推荐关系时触发。

```solidity
event AdminReferralBound(
    address indexed user,      // 被推荐的用户
    address indexed referrer,  // 推荐人地址
    address indexed admin,     // 执行绑定的管理员地址
    uint256 timestamp          // 绑定时间戳
);
```

**触发函数：** `adminBindReferral()`、`batchAdminBindReferral()`

**前端用途：** 管理后台追踪推荐关系批量绑定记录。

---

## 三、团队奖励相关事件

### 3.1 TeamRewardDistributionCompleted — 团队奖励分配完成

每次有利息产生时，团队奖励分配完成后触发，包含完整的分配明细。

```solidity
event TeamRewardDistributionCompleted(
    uint256 interestAmount,            // 触发分配的利息总额
    uint256 totalTeamRewardPool,       // 团队奖励池总额（利息的 35%）
    uint256 totalDistributed,          // 实际分配给各层级的总额
    uint256 marketingAmount,           // 发送给营销地址的金额
    address[7] tierRecipients,         // 各层级接收者地址 [V1..V7]，无则为 address(0)
    uint256[7] tierAmounts,            // 各层级奖励金额 [V1..V7]，无则为 0
    uint8 activeTiers                  // 活跃层级位图 (bit 0=V1, bit 1=V2, ... bit 6=V7)
);
```

**触发函数：** `_distributeTeamReward()` (内部函数)

**前端用途：** 展示团队奖励分配详情，各层级收益情况。

**activeTiers 位图解读：**
| 位 | 层级 | 含义 |
|---|------|------|
| bit 0 | V1 | 该位为1表示 V1 有接收者 |
| bit 1 | V2 | 该位为1表示 V2 有接收者 |
| bit 2 | V3 | 该位为1表示 V3 有接收者 |
| bit 3 | V4 | 该位为1表示 V4 有接收者 |
| bit 4 | V5 | 该位为1表示 V5 有接收者 |
| bit 5 | V6 | 该位为1表示 V6 有接收者 |
| bit 6 | V7 | 该位为1表示 V7 有接收者 |

---

### 3.2 StrictDifferentialRewardPaid — 差异化奖励发放

按差异化利率向各层级成员发放奖励时触发。

```solidity
event StrictDifferentialRewardPaid(
    address indexed recipient,         // 接收奖励的地址
    uint8 indexed tier,                // 用户层级 (1-7)
    uint256 actualRewardRate,          // 实际应用的差异化利率
    uint256 rewardAmount,              // 实际奖励金额
    uint256 previousCumulativeRate,    // 该层级之前的累积利率
    uint256 currentTierRate            // 当前层级的完整利率
);
```

**触发函数：** `_distributeHybridRewards()` (内部函数)

**前端用途：** 展示各层级的差异化奖励计算过程和金额。

---

### 3.3 PreacherCheckFailed — 布道者检查失败

团队奖励分配时，用户未通过布道者资格检查时触发。

```solidity
event PreacherCheckFailed(
    address indexed user,      // 未通过检查的用户地址
    uint8 indexed tier,        // 本应获得的层级
    string reason              // 失败原因
);
```

**前端用途：** 调试和追踪布道者资格失败情况。

---

## 四、管理/配置事件

### 4.1 StakingRatesUpdated — 质押利率更新

质押利率更新时触发。

```solidity
event StakingRatesUpdated(uint256[5] newRates);  // 新的每秒利率数组
```

**触发函数：** `_updateRatesForMode()` (内部函数)

---

### 4.2 AEContractSet — AE 合约地址设置

设置 AE 代币合约地址时触发。

```solidity
event AEContractSet(address indexed aeAddress);   // AE 合约地址
```

**触发函数：** `setAE()`

---

### 4.3 FeeRecipientUpdated — 手续费接收地址更新

```solidity
event FeeRecipientUpdated(
    address indexed oldRecipient,  // 旧地址
    address indexed newRecipient   // 新地址
);
```

**触发函数：** `setFeeRecipient()`

---

### 4.4 MarketingAddressUpdated — 营销地址更新

```solidity
event MarketingAddressUpdated(
    address indexed oldAddress,    // 旧地址
    address indexed newAddress     // 新地址
);
```

---

### 4.5 TestModeSet — 测试模式开关

```solidity
event TestModeSet(bool enabled);   // 是否启用测试模式
```

---

### 4.6 PresaleDurationUpdated — 预售时长更新

```solidity
event PresaleDurationUpdated(uint256 duration);  // 预售时长
```

---

## 五、前端监听建议

### 核心业务事件（建议优先监听）

| 事件 | 场景 | 优先级 |
|------|------|--------|
| `Staked` | 用户质押成功 | 高 |
| `WithdrawalCompleted` | 用户赎回完成 | 高 |
| `InterestWithdrawn` | 用户提取利息 | 高 |
| `ReferralBound` | 推荐关系绑定 | 高 |
| `TeamRewardDistributionCompleted` | 团队奖励分配 | 中 |
| `RedemptionFeeCollected` | 赎回手续费 | 中 |
| `StrictDifferentialRewardPaid` | 差异化奖励 | 中 |

### 监听示例（ethers.js v6）

```javascript
// 监听质押事件
stakingContract.on("Staked", (user, amount, timestamp, index, stakeTime) => {
    console.log(`用户 ${user} 质押 ${amount}, 周期 ${stakeTime}秒, 索引 ${index}`);
});

// 监听赎回完成事件
stakingContract.on("WithdrawalCompleted",
    (user, stakeIndex, principalAmount, calculatedReward,
     usdxReceived, aeTokensUsed, referralFee, teamFee,
     userPayout, interestEarned, withdrawalTime) => {
        console.log(`用户 ${user} 赎回质押#${stakeIndex}`);
        console.log(`本金: ${principalAmount}, 收益: ${interestEarned}`);
        console.log(`实际到账: ${userPayout}`);
    }
);

// 监听推荐关系绑定
stakingContract.on("ReferralBound", (user, referrer, timestamp) => {
    console.log(`用户 ${user} 绑定推荐人 ${referrer}`);
});

// 监听团队奖励分配
stakingContract.on("TeamRewardDistributionCompleted",
    (interestAmount, totalTeamRewardPool, totalDistributed,
     marketingAmount, tierRecipients, tierAmounts, activeTiers) => {
        console.log(`团队奖励池: ${totalTeamRewardPool}`);
        console.log(`实际分配: ${totalDistributed}, 营销: ${marketingAmount}`);
    }
);
```

### 查询历史事件示例

```javascript
// 查询用户历史质押记录
const filter = stakingContract.filters.Staked(userAddress);
const events = await stakingContract.queryFilter(filter, fromBlock, toBlock);

// 查询用户的推荐关系
const referralFilter = stakingContract.filters.ReferralBound(userAddress);
const referralEvents = await stakingContract.queryFilter(referralFilter);
```
