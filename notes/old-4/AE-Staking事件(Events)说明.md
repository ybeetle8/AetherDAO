# AE-Staking 合约事件 (Events) 说明

本文档整理了 AE-Staking 合约中所有与**质押、团队奖励、推荐人、全局统计、用户收益**相关的事件，供前端对接参考。

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

**触发函数：** `stake()` → 内部 `_mintStakeRecord()`

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

### 1.9 StakerCountChanged — 质押参与人数变更

用户首次质押（加入）或最后一笔质押赎回（离开）时触发。

```solidity
event StakerCountChanged(
    address indexed user,         // 用户地址
    bool isJoin,                  // true=加入, false=离开
    uint256 newTotalStakers       // 更新后的总质押人数
);
```

**触发函数：**
- 加入：`_mintStakeRecord()` (内部函数)
- 离开：`_recordWithdrawal()` (内部函数)

**前端用途：** Dashboard 展示当前质押参与人数，实时更新。

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
    address[9] tierRecipients,         // 各层级接收者地址 [V1..V9]，无则为 address(0)
    uint256[9] tierAmounts,            // 各层级奖励金额 [V1..V9]，无则为 0
    uint16 activeTiers                 // 活跃层级位图 (bit 0=V1, bit 1=V2, ... bit 8=V9)
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
| bit 7 | V8 | 该位为1表示 V8 有接收者 |
| bit 8 | V9 | 该位为1表示 V9 有接收者 |

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

### 3.3 UserCommunityRewardUpdated — 用户社区（团队）收益到账

团队奖励分配时，每个接收到团队奖励的用户都会触发此事件。**这是"领取团队奖励"的核心追踪事件。**

```solidity
event UserCommunityRewardUpdated(
    address indexed user,         // 用户地址
    uint256 amount,               // 本次到账金额
    uint256 newTotal              // 更新后的累计社区收益
);
```

**触发函数：** `_distributeTeamReward()` → `_distributeHybridRewards()` (内部函数)

**触发位置：**
- rootAddress 兜底分配 (无推荐链时)
- rootAddress 接收未分配余额
- 各层级团队成员接收奖励

**前端用途：** 用户个人中心展示**累计社区（团队）收益**，追踪每一笔团队奖励到账记录。

---

### 3.4 GlobalEducationFundUpdated — 全网累计教育基金更新

每次利息分配时，5% 教育基金转账完成后触发。

```solidity
event GlobalEducationFundUpdated(
    uint256 amount,                   // 本次教育基金金额
    uint256 newTotalEducationFund     // 更新后的全网累计教育基金
);
```

**触发函数：** `_distributeTeamReward()` (内部函数)

**前端用途：** Dashboard 展示全网累计教育基金总额。

---

### 3.5 PreacherCheckFailed — 布道者检查失败

> **注意：此事件已在 IStaking.sol 中声明，但合约代码中尚未 emit。属于预留事件。**

团队奖励分配时，用户未通过布道者资格检查时应触发。

```solidity
event PreacherCheckFailed(
    address indexed user,      // 未通过检查的用户地址
    uint8 indexed tier,        // 本应获得的层级
    string reason              // 失败原因
);
```

**前端用途：** 调试和追踪布道者资格失败情况。

---

## 四、用户收益统计事件

### 4.1 UserStakingRewardUpdated — 用户质押收益累计更新

用户每次 unstake 或 withdrawInterest 到账时触发，记录用户累计质押收益。

```solidity
event UserStakingRewardUpdated(
    address indexed user,         // 用户地址
    uint256 amount,               // 本次到账金额
    uint256 newTotal              // 更新后的累计质押收益
);
```

**触发函数：**
- `unstake()` — 用户赎回到账时
- `withdrawInterest()` — 用户提前提取利息到账时

**前端用途：** 用户个人中心展示**累计质押收益**（已领取总额）。

---

### 4.2 GlobalDividendUpdated — 全网累计分红更新

每次用户 unstake 或 withdrawInterest 到账时触发，用于追踪全网累计分红总额。

```solidity
event GlobalDividendUpdated(
    uint256 userPayout,           // 本次用户到账金额
    uint256 newTotalDividends     // 更新后的全网累计分红
);
```

**触发函数：**
- `unstake()` — 用户赎回到账时
- `withdrawInterest()` — 用户提前提取利息到账时

**前端用途：** Dashboard 展示全网累计分红总额，实时更新。

---

## 五、管理/配置事件

### 5.1 StakingRatesUpdated — 质押利率更新

质押利率更新时触发。

```solidity
event StakingRatesUpdated(uint256[5] newRates);  // 新的每秒利率数组
```

**触发函数：** `_updateRatesForMode()` (内部函数)

---

### 5.2 AEContractSet — AE 合约地址设置

设置 AE 代币合约地址时触发。

```solidity
event AEContractSet(address indexed aeAddress);   // AE 合约地址
```

**触发函数：** `setAE()`

---

### 5.3 FeeRecipientUpdated — 手续费接收地址更新

```solidity
event FeeRecipientUpdated(
    address indexed oldRecipient,  // 旧地址
    address indexed newRecipient   // 新地址
);
```

**触发函数：** `setFeeRecipient()`

---

### 5.4 MarketingAddressUpdated — 营销地址更新

```solidity
event MarketingAddressUpdated(
    address indexed oldAddress,    // 旧地址
    address indexed newAddress     // 新地址
);
```

---

### 5.5 TestModeSet — 测试模式开关

> **注意：此事件已在 IStaking.sol 中声明，但 Staking 合约中无 testMode 相关逻辑，尚未 emit。属于预留事件。**

```solidity
event TestModeSet(bool enabled);   // 是否启用测试模式
```

---

### 5.6 PresaleDurationUpdated — 预售时长更新

> **注意：此事件已在 IStaking.sol 中声明，但 Staking 合约中无预售相关逻辑，尚未 emit。属于预留事件。**

```solidity
event PresaleDurationUpdated(uint256 duration);  // 预售时长
```

---

## 六、前端监听建议

### 核心业务事件（建议优先监听）

| 事件 | 场景 | 优先级 |
|------|------|--------|
| `Staked` | 用户质押成功 | 高 |
| `WithdrawalCompleted` | 用户赎回完成 | 高 |
| `InterestWithdrawn` | 用户提取利息 | 高 |
| `UserStakingRewardUpdated` | 用户质押收益到账（含 unstake 和 withdrawInterest） | 高 |
| `UserCommunityRewardUpdated` | 用户团队奖励到账 | 高 |
| `ReferralBound` | 推荐关系绑定 | 高 |
| `GlobalDividendUpdated` | Dashboard 全网分红统计 | 高 |
| `TeamRewardDistributionCompleted` | 团队奖励分配 | 中 |
| `RedemptionFeeCollected` | 赎回手续费 | 中 |
| `StrictDifferentialRewardPaid` | 差异化奖励 | 中 |
| `GlobalEducationFundUpdated` | Dashboard 教育基金统计 | 中 |
| `StakerCountChanged` | Dashboard 质押人数 | 中 |

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

// 监听用户质押收益到账
stakingContract.on("UserStakingRewardUpdated", (user, amount, newTotal) => {
    console.log(`用户 ${user} 质押收益到账 ${amount}, 累计 ${newTotal}`);
});

// 监听用户团队奖励到账（领取团队奖励）
stakingContract.on("UserCommunityRewardUpdated", (user, amount, newTotal) => {
    console.log(`用户 ${user} 社区收益到账 ${amount}, 累计 ${newTotal}`);
});

// 监听全网分红更新
stakingContract.on("GlobalDividendUpdated", (userPayout, newTotalDividends) => {
    console.log(`全网累计分红: ${newTotalDividends}`);
});

// 监听质押人数变化
stakingContract.on("StakerCountChanged", (user, isJoin, newTotalStakers) => {
    console.log(`${isJoin ? '加入' : '离开'}: ${user}, 当前总人数: ${newTotalStakers}`);
});
```

### 查询历史事件示例

```javascript
// 查询用户历史质押记录
const filter = stakingContract.filters.Staked(userAddress);
const events = await stakingContract.queryFilter(filter, fromBlock, toBlock);

// 查询用户的推荐关系
const referralFilter = stakingContract.filters.ReferralBound(userAddress);
const referralEvents = await stakingContract.queryFilter(referralFilter);

// 查询用户历史社区收益（团队奖励领取记录）
const communityFilter = stakingContract.filters.UserCommunityRewardUpdated(userAddress);
const communityEvents = await stakingContract.queryFilter(communityFilter, fromBlock, toBlock);

// 查询用户历史质押收益记录
const stakingRewardFilter = stakingContract.filters.UserStakingRewardUpdated(userAddress);
const stakingRewardEvents = await stakingContract.queryFilter(stakingRewardFilter, fromBlock, toBlock);
```
