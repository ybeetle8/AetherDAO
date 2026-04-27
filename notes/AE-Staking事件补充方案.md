# AE-Staking 事件补充方案

本文档对照 `notes/AE-Staking事件(Events)说明.md` 与合约源码，列出**文档中缺失的事件**和**代码中缺少但应补充的事件**。

---

## 一、文档中已有但描述需修正的事件

### 1.1 TeamRewardDistributionCompleted — 参数类型不一致

文档中写的是 `address[7]` / `uint256[7]` / `uint8 activeTiers`，但实际 IStaking.sol 声明为：

```solidity
// IStaking.sol:291-299
event TeamRewardDistributionCompleted(
    uint256 interestAmount,
    uint256 totalTeamRewardPool,
    uint256 totalDistributed,
    uint256 marketingAmount,
    address[9] tierRecipients,    // ← 实际是 [9]，不是 [7]
    uint256[9] tierAmounts,       // ← 实际是 [9]，不是 [7]
    uint16 activeTiers            // ← 实际是 uint16，不是 uint8
);
```

**需要修正文档中的参数类型。**

---

## 二、文档中完全缺失的事件（代码中已声明且已 emit）

以下事件在合约中已正常声明和触发，但原文档中未收录：

### 2.1 GlobalDividendUpdated — 全网累计分红更新

每次用户 unstake 或 withdrawInterest 到账时触发，用于追踪全网累计分红总额。

```solidity
// IStaking.sol:322
event GlobalDividendUpdated(
    uint256 userPayout,           // 本次用户到账金额
    uint256 newTotalDividends     // 更新后的全网累计分红
);
```

**触发位置：**
- `unstake()` → StakingBase.sol:348
- `withdrawInterest()` → StakingBase.sol:437

**前端用途：** Dashboard 展示全网累计分红总额，实时更新。

**优先级：高** — 涉及用户资金到账的关键统计。

---

### 2.2 GlobalEducationFundUpdated — 全网累计教育基金更新

每次利息分配时，5% 教育基金转账完成后触发。

```solidity
// IStaking.sol:329
event GlobalEducationFundUpdated(
    uint256 amount,                   // 本次教育基金金额
    uint256 newTotalEducationFund     // 更新后的全网累计教育基金
);
```

**触发位置：** `_distributeTeamReward()` → StakingBase.sol:1373

**前端用途：** Dashboard 展示全网累计教育基金总额。

**优先级：中** — 资金分配透明度。

---

### 2.3 StakerCountChanged — 质押参与人数变更

用户首次质押（加入）或最后一笔质押赎回（离开）时触发。

```solidity
// IStaking.sol:337
event StakerCountChanged(
    address indexed user,         // 用户地址
    bool isJoin,                  // true=加入, false=离开
    uint256 newTotalStakers       // 更新后的总质押人数
);
```

**触发位置：**
- 加入：`_mintStakeRecord()` → StakingBase.sol:1215
- 离开：`_recordWithdrawal()` → StakingBase.sol:1277

**前端用途：** Dashboard 展示当前质押参与人数。

**优先级：中**

---

### 2.4 UserStakingRewardUpdated — 用户质押收益累计更新

用户每次 unstake 或 withdrawInterest 到账时触发，记录用户累计质押收益。

```solidity
// IStaking.sol:347
event UserStakingRewardUpdated(
    address indexed user,         // 用户地址
    uint256 amount,               // 本次到账金额
    uint256 newTotal              // 更新后的累计质押收益
);
```

**触发位置：**
- `unstake()` → StakingBase.sol:352
- `withdrawInterest()` → StakingBase.sol:441

**前端用途：** 用户个人中心展示累计质押收益。

**优先级：高** — 直接关系用户资金。

---

### 2.5 UserCommunityRewardUpdated — 用户社区收益累计更新

团队奖励分配时，每个接收团队奖励的用户都会触发此事件。

```solidity
// IStaking.sol:353
event UserCommunityRewardUpdated(
    address indexed user,         // 用户地址
    uint256 amount,               // 本次到账金额
    uint256 newTotal              // 更新后的累计社区收益
);
```

**触发位置：**
- rootAddress 兜底：StakingBase.sol:1388, 1432
- 团队成员奖励：StakingBase.sol:1498

**前端用途：** 用户个人中心展示累计社区（团队）收益。这是**团队奖励领取**的核心追踪事件。

**优先级：高** — 这正是"领取团队奖励"的事件，直接关系用户资金到账。

---

## 三、代码中已声明但从未 emit 的事件

以下事件在 IStaking.sol 中声明，但在 StakingBase.sol 中**未找到任何 emit 语句**：

### 3.1 PreacherCheckFailed — 布道者检查失败

```solidity
// IStaking.sol:307-311
event PreacherCheckFailed(
    address indexed user,
    uint8 indexed tier,
    string reason
);
```

**状态：已声明，未使用。**

原文档中已收录此事件，但实际合约中从未触发。建议在 `_distributeHybridRewards()` 中布道者资格校验失败时补充 emit。

---

### 3.2 TestModeSet — 测试模式设置

```solidity
// IStaking.sol:247
event TestModeSet(bool enabled);
```

**状态：已声明，未使用。** Staking 合约中无 testMode 相关逻辑（该事件可能来自 AE 代币合约侧）。

---

### 3.3 PresaleDurationUpdated — 预售时长更新

```solidity
// IStaking.sol:261
event PresaleDurationUpdated(uint256 duration);
```

**状态：已声明，未使用。** Staking 合约中无预售相关逻辑。

---

## 四、有资金转移但缺少独立事件的场景（建议新增）

以下函数涉及资金转移，但**没有专门的事件**来追踪：

### 4.1 emergencyWithdrawAE — 紧急提取 AE 代币

```solidity
// StakingBase.sol:1808-1813
function emergencyWithdrawAE(address to, uint256 _amount) external onlyOwner {
    AE.transfer(to, _amount);
    // ❌ 无事件
}
```

**建议新增事件：**
```solidity
event EmergencyWithdraw(
    address indexed token,        // 代币地址 (AE 或 USDX)
    address indexed to,           // 接收地址
    uint256 amount,               // 提取数量
    uint256 timestamp             // 时间戳
);
```

**理由：** 紧急提取涉及合约资金安全，必须有链上记录供审计追踪。

**优先级：高**

---

### 4.2 emergencyWithdrawUSDX — 紧急提取 USDX 代币

```solidity
// StakingBase.sol:1815-1820
function emergencyWithdrawUSDX(address to, uint256 _amount) external onlyOwner {
    IERC20(USDX).transfer(to, _amount);
    // ❌ 无事件
}
```

**建议与 4.1 共用 `EmergencyWithdraw` 事件。**

**优先级：高**

---

### 4.3 教育基金转账 — 缺少独立的到账事件

```solidity
// StakingBase.sol:1369
IERC20(USDX).transfer(educationFundAddress, fee);
```

虽然有 `GlobalEducationFundUpdated` 全局统计事件，但没有针对教育基金地址的独立到账事件（类似 `UserCommunityRewardUpdated`）。

**建议：** 可选新增，目前 `GlobalEducationFundUpdated` 已经能满足基本追踪需求。

**优先级：低**

---

## 五、总结：需补充的事件清单

### 文档层面（需更新 `AE-Staking事件(Events)说明.md`）

| 序号 | 事件名 | 操作 | 优先级 |
|------|--------|------|--------|
| 1 | `TeamRewardDistributionCompleted` | 修正参数类型 `[7]→[9]`, `uint8→uint16` | 高 |
| 2 | `GlobalDividendUpdated` | 新增收录 | 高 |
| 3 | `UserStakingRewardUpdated` | 新增收录 | 高 |
| 4 | `UserCommunityRewardUpdated` | 新增收录（团队奖励到账追踪） | 高 |
| 5 | `GlobalEducationFundUpdated` | 新增收录 | 中 |
| 6 | `StakerCountChanged` | 新增收录 | 中 |
| 7 | `PreacherCheckFailed` | 标注为"已声明未使用" | 低 |

### 合约层面（需修改 Solidity 代码）

| 序号 | 场景 | 建议新增事件 | 优先级 |
|------|------|-------------|--------|
| 1 | `emergencyWithdrawAE()` | `EmergencyWithdraw` | 高 |
| 2 | `emergencyWithdrawUSDX()` | `EmergencyWithdraw` | 高 |
| 3 | `_distributeHybridRewards()` 布道者失败 | emit `PreacherCheckFailed` | 中 |

### 前端监听建议表（补充）

| 事件 | 场景 | 优先级 |
|------|------|--------|
| `UserStakingRewardUpdated` | 用户质押收益到账（含 unstake 和 withdrawInterest） | 高 |
| `UserCommunityRewardUpdated` | 用户团队奖励到账 | 高 |
| `GlobalDividendUpdated` | Dashboard 全网分红统计 | 高 |
| `EmergencyWithdraw` *(待新增)* | 管理后台安全告警 | 高 |
| `GlobalEducationFundUpdated` | Dashboard 教育基金统计 | 中 |
| `StakerCountChanged` | Dashboard 质押人数 | 中 |

---

## 六、补充：监听示例（ethers.js v6）

```javascript
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

// 查询用户历史社区收益（团队奖励领取记录）
const filter = stakingContract.filters.UserCommunityRewardUpdated(userAddress);
const events = await stakingContract.queryFilter(filter, fromBlock, toBlock);
```
