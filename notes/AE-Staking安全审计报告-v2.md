# AE-Staking 合约安全审计报告 (v2)

## 1. 审计概览

| 项目 | 详情 |
|------|------|
| **合约名称** | AE-Staking (StakingBase + Staking) |
| **Solidity 版本** | ^0.8.20 |
| **审计范围** | `StakingBase.sol` (1910行), `Staking.sol` (115行), `IStaking.sol`, `IAE.sol` |
| **依赖库** | OpenZeppelin (Ownable, IERC20), PRB-Math (UD60x18), Uniswap V2 |
| **部署目标** | BSC 主网 |
| **审计日期** | 2026-04-27 |
| **基准版本** | 基于 v1 审计报告修复后的最新代码 |

---

## 2. v1 审计问题修复状态

| 编号 | 问题 | 修复状态 |
|------|------|---------|
| C-01 | tierAllocated 数组越界 (bool[8]) | ✅ **已修复** — 改为 `bool[10]` |
| C-02 | withdrawInterest + unstake 双重利息获取 | ✅ **已修复** — `_burn` 中增加 `withdrawnInterest` 扣除 |
| H-01 | _swapAEForReward maxInput 硬限制 | ⚠️ **未修复** — 仍存在, 见下文 H-01 |
| H-02 | unstake 费用基数膨胀 | ⚠️ **部分修复** — 见下文 H-02 详细分析 |
| M-01 | setRootAddress 推荐链不一致 | ⚠️ **未修复** — 见下文 M-01 |
| M-02 | tierRecipients/tierAmounts 数组越界 | ✅ **已修复** — 改为 `[9]`, activeTiers 改为 `uint16` |

---

## 3. 发现问题汇总

| 严重等级 | 数量 |
|---------|------|
| **严重 (Critical)** | 1 |
| **高危 (High)** | 2 |
| **中危 (Medium)** | 1 |

---

## 4. 严重 (Critical) 问题

### C-01: unstake 中 interestEarned 计算未扣除已提取利息 — 导致费用超额扣除 + 潜在下溢 revert

**位置:** `StakingBase.sol:289-306`

**描述:**

v1 的 C-02 双重利息漏洞已修复: `_burn` 现在会从 `reward` 中扣除 `withdrawnInterest`。但 `unstake` 中的**费用计算基数**仍然存在严重问题。

`_burn` 修复后返回的 `calculatedReward` 已经是扣除了已提取利息的值, 随后通过 swap 得到 `usdxReceived`。但费用计算中的 `interestEarned` 仍按如下方式计算:

```solidity
uint256 interestEarned = usdxReceived > principalAmount
    ? usdxReceived - principalAmount
    : 0;
```

**问题核心:** 当用户先 `withdrawInterest` 提取了大量利息后, `_burn` 返回的 `reward` 已扣除这部分利息, 导致 `usdxReceived` 可能**小于 `principalAmount`**, 此时 `interestEarned = 0`, 教育基金和团队费用也为 0。

但更严重的是**反向场景**: 如果 swap 滑点导致 `usdxReceived` 略大于 `principalAmount`, 则 `interestEarned` 是一个很小的值, 费用计算正常。然而, 如果用户没有提前领取利息, 一切正常; 如果用户提前领取了利息, `interestEarned` 可能不准确。

**具体的资金损失场景:**

假设用户质押 1000 USDX, 90天档, 到期后总值 2677 USDX (利息 1677 USDX):

1. 用户在第 80 天 `withdrawInterest` 提取了 1200 USDX 利息 (swap 后扣费)
2. 到期后 `unstake`:
   - `_burn` 返回: `reward = 2677 - 1200 = 1477` (扣除已提取利息)
   - `_swapAEForReward(1477)` → `usdxReceived ≈ 1477`
   - `interestEarned = 1477 - 1000 = 477`
   - 教育基金 = 477 * 5% = 23.85
   - 团队奖励 = 477 * 35% = 166.95
   - `userPayout = 1477 - 23.85 - 166.95 = 1286.2`

**问题在于**: 用户 `withdrawInterest` 时已经对 1200 USDX 利息交过一次费用 (5% 教育基金 + 35% 团队 + 5% 赎回)。现在 `unstake` 时, 剩余利息 477 USDX 的费用计算是正确的。**但 `_recordWithdrawal` 中记录的 `interestEarned` 值 (477) 不等于用户实际从该笔质押获得的总利息, 这导致事件/历史记录数据不一致。**

**但更关键的问题在另一面 —— `usdxReceived` 与 `principalAmount` 的关系:**

由于 `_swapAEForReward` 使用 `swapTokensForExactTokens`, 传入的 `calculatedReward` 是"目标 USDX 数量"。如果 `calculatedReward = reward` (已扣除已提取利息), 则:
- `usdxReceived` 应该等于 `calculatedReward`
- 但实际上 `usdxReceived` 是通过 before/after 差额计算的, 可能因为 AE 代币的 fee-on-transfer 特性而偏差

如果 `usdxReceived < principalAmount` (当已提取利息 > 总利息的大部分时), 则:
- `interestEarned = 0`
- `educationFund = 0`, `teamFee = 0`
- `userPayout = usdxReceived` (用户拿回全部, 无费用)
- **这意味着 unstake 时的本金部分完全免费, 没有收取赎回费**

**影响:**
1. 用户可以利用 `withdrawInterest` + `unstake` 的组合来规避 unstake 时的赎回费
2. 当 `usdxReceived` 恰好等于 `principalAmount` 时, 费用为 0 但赎回费 (REDEMPTION_FEE_RATE = 5%) 仍会从 `userPayout` 中扣除, 导致用户连本金都拿不回全部
3. 事件日志和历史记录中的 `interestEarned` 不准确

**修复建议:**

`unstake` 的费用计算应基于 `usdxReceived - (principalAmount - 已通过withdrawInterest提取的利息对应的本金价值)` 或更简单地:
- 赎回费应始终基于 `userPayout` (已是如此, 这部分OK)
- 教育基金和团队费用应仅基于 unstake 时实际的新增利息, 即 `usdxReceived - principalAmount`, 但要考虑已提取部分. 当 `usdxReceived <= principalAmount` 时费用为 0 是合理的 (因为利息已在 withdrawInterest 时交过费)
- 关键修复: **赎回费(5%)不应仅对 `interestEarned` 部分收取, 还应对本金部分收取** (当前逻辑是对 `userPayout` 整体收取, 这是正确的). 但需要确认业务意图: 如果赎回费本意是对本金+利息整体收取, 当前逻辑无误; 如果仅对利息收取, 则当前对 `userPayout` (含本金) 收取是超额的.

---

## 5. 高危 (High) 问题

### H-01: _swapAEForReward 的 maxInput 硬限制可导致 unstake 永久失败

**位置:** `StakingBase.sol:1315-1360`

**描述:**

此问题自 v1 审计以来一直未修复。

```solidity
function _calculateMaxAEInput(
    uint256 usdxNeeded,
    uint256 availableXF
) private view returns (uint256 maxInput) {
    // ...
    uint256 maxAllowedInput = availableXF / 2;
    if (maxInput > maxAllowedInput) {
        maxInput = maxAllowedInput;
    }
}
```

`_swapAEForReward` 调用 `swapTokensForExactTokens`, 传入 `maxXFInput` 作为最大 AE 投入量。这个值被硬性限制为合约 AE 余额的 50%。

**触发场景:**
1. **长期质押大额**: 365天档 2%日复利, 1000 USDX 到期后总值约 137.7万 USDX. 如果 AE/USDX 池子深度不够, 用 50% 合约 AE 余额无法换出 137.7万 USDX
2. **AE 余额被消耗**: 多个用户连续 unstake 后, 合约 AE 余额逐渐减少
3. **AE 价格大幅下跌**: 需要更多 AE 才能换出同等 USDX

**影响:**
- `swapTokensForExactTokens` 因 maxInput 不足而 revert
- 用户无法 unstake, 资金永久锁定
- 没有备用路径 (如分批提取) 让用户取回资金
- `emergencyWithdrawUSDX` 只能由 owner 操作, 且依赖合约有足够 USDX 余额

**修复建议:**
- 增加一个 fallback 机制: 当 `swapTokensForExactTokens` 失败时, 改用 `swapExactTokensForTokens` 将可用 AE 全部卖出, 用户获得尽可能多的 USDX
- 或者增加 owner 可调用的 `emergencyUnstake` 函数, 允许在极端情况下直接返还用户本金
- 或移除 50% 硬限制, 改用更灵活的策略

---

### H-02: unstake 中 unchecked 块包含多个外部调用和状态更新

**位置:** `StakingBase.sol:330-353`

**描述:**

```solidity
unchecked {
    _recordWithdrawal(
        msg.sender, stakeIndex, principalAmount,
        calculatedReward, usdxReceived, aeTokensUsed,
        educationFund, teamFee, userPayout, interestEarned
    );

    IERC20(USDX).transfer(msg.sender, userPayout);

    // 累计分红统计
    totalDividendsDistributed += userPayout;
    emit GlobalDividendUpdated(userPayout, totalDividendsDistributed);

    // 累计用户质押收益
    totalClaimedStakingReward[msg.sender] += userPayout;
    emit UserStakingRewardUpdated(msg.sender, userPayout, totalClaimedStakingReward[msg.sender]);
}
```

这个 `unchecked` 块包含:
1. `IERC20(USDX).transfer` — 外部调用
2. `totalDividendsDistributed += userPayout` — 累加操作
3. `totalClaimedStakingReward[msg.sender] += userPayout` — 累加操作

**风险:**
- `totalDividendsDistributed` 和 `totalClaimedStakingReward` 的累加在 `unchecked` 中执行, 溢出不会被检测
- 虽然 `uint256` 溢出在实践中几乎不可能, 但将非平凡的状态变更放在 `unchecked` 中是不良实践
- 如果 USDX 是一个有回调机制的代币 (如 ERC-777), `transfer` 可能触发重入. 虽然目前 USDX 不是 ERC-777, 但如果未来更换 USDX 地址或使用代理合约, 这将成为真实风险

**影响:**
- 当前实际风险较低 (USDX 为标准 ERC-20)
- 但违反安全编码最佳实践, 增加了未来维护的风险

**修复建议:** 将 `unchecked` 块移除, 或仅保留真正需要的算术操作在 unchecked 中.

---

## 6. 中危 (Medium) 问题

### M-01: setRootAddress 导致推荐链数据不一致 (未修复)

**位置:** `StakingBase.sol:542-546`

```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;
}
```

**问题:**
1. 旧 rootAddress 的 `_hasLocked` 被设为 false, 但所有以旧 root 为推荐人的用户的 `_referrals[user]` 仍指向旧 root
2. 旧 root 的 `teamTotalInvestValue` 不会迁移到新 root
3. `_getUserTier(rootAddress)` 始终返回 0 (因为有特判 `if (user == rootAddress) return 0`), 但切换后旧 root 不再被识别为 rootAddress, 其 tier 会按正常逻辑计算, 可能导致意外的团队奖励分配
4. `_children[oldRoot]` 数组不会被迁移, 导致新 root 没有任何直接下级

**影响:**
- 推荐树结构出现断裂
- 团队奖励分配可能异常
- `getReferrals` 遍历到旧 root 时不会停止 (旧 root 的 `_referrals` 为 address(0), 会自然停止, 这部分OK)
- 但旧 root 下的用户进行 unstake 时, 团队奖励分配中旧 root 可能被当作普通用户获取 tier 奖励

**修复建议:** 增加旧推荐关系的迁移逻辑, 或至少将旧 root 的 tier 显式设为 0 (如使用黑名单机制).

---

## 7. 安全审计检查清单

| 检查项 | 状态 | 备注 |
|-------|------|------|
| 重入攻击 | ⚠️ | unstake 有多个外部调用 (swap, transfer, recycle), 无 ReentrancyGuard |
| 整数溢出/下溢 | ⚠️ | unchecked 块中的累加操作理论上安全, 但不是最佳实践 |
| 数组越界 | ✅ | v1 的 tierAllocated 和 tierRecipients 已修复 |
| 访问控制 | ✅ | 使用 OpenZeppelin Ownable |
| 三明治攻击 | ✅ | addLiquidity 已有 5% 滑点保护 |
| 双重利息获取 | ✅ | `_burn` 已扣除 `withdrawnInterest` |
| DoS / 资金锁定 | ❌ | AE 余额不足时 unstake 失败, 无备用路径 |
| 闪电贷攻击 | ✅ | onlyEOA 修饰符提供保护 |
| 权限过大 | ⚠️ | Owner 可 emergencyWithdraw 所有资金, setRootAddress 无时间锁 |
| 费用计算准确性 | ⚠️ | withdrawInterest + unstake 组合时费用基数可能不准确 |

---

## 8. 优先修复建议

| 优先级 | 编号 | 描述 |
|-------|------|------|
| **P0 (立即)** | C-01 | unstake 费用计算逻辑需考虑 withdrawnInterest, 避免费用异常和赎回费逃避 |
| **P1 (尽快)** | H-01 | 增加 unstake 的备用路径或紧急提取机制, 防止资金永久锁定 |
| **P1 (尽快)** | H-02 | 移除 unchecked 块中的外部调用和状态累加, 增加 ReentrancyGuard |
| **P2 (计划)** | M-01 | setRootAddress 增加迁移逻辑或保护措施 |
