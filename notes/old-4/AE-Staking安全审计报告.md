# AE-Staking 合约安全审计报告

## 1. 审计概览

| 项目 | 详情 |
|------|------|
| **合约名称** | AE-Staking (StakingBase + Staking) |
| **Solidity 版本** | ^0.8.20 |
| **审计范围** | `StakingBase.sol` (1902行), `Staking.sol` (115行), `IStaking.sol`, `IAE.sol` |
| **依赖库** | OpenZeppelin (Ownable, IERC20), PRB-Math (UD60x18), Uniswap V2 |
| **部署目标** | BSC 主网 |
| **审计日期** | 2026-04-27 |
| **对比版本** | 基于 old-3 审计报告进行对比审计 |

---

## 2. 旧版问题修复状态

| 编号 | 问题 | 修复状态 |
|------|------|---------|
| C-01 | unstake 赎回费未实际收取 | ✅ **已修复** — 现在从 userPayout 扣除并 transfer 给 feeRecipient |
| C-02 | withdrawInterest 赎回费问题 | ✅ **已修复** — 同 C-01 |
| H-01 | addLiquidity amountMin=0 三明治攻击 | ✅ **已修复** — 现在基于实际 swap 结果计算 5% 滑点保护 |
| H-02 | _swapAEForReward maxInput 导致 unstake 失败 | ⚠️ **未修复** — 仍存在 |
| H-03 | LP Token 发送到 address(0) | ⚠️ **未修复** — 可能为设计意图 |
| H-04 | unchecked 导致下溢 | ✅ **低风险** — Solidity 0.8+ 自动检查 |
| L-06 | tierAllocated 数组越界 | ⚠️ **未修复** — 仍然是 `bool[8]`, 见下文 C-01 |
| M-05 | withdrawInterest + unstake 双重利息获取 | ❌ **未修复** — 见下文 C-02, 这是最关键的漏洞 |

---

## 3. 发现问题汇总

| 严重等级 | 数量 |
|---------|------|
| **严重 (Critical)** | 2 |
| **高危 (High)** | 2 |
| **中危 (Medium)** | 2 |

---

## 4. 严重 (Critical) 问题

### C-01: tierAllocated 数组越界 — 高 Tier 用户 unstake/withdrawInterest 必定 revert

**位置:** `StakingBase.sol:1461`

**描述:**

```solidity
bool[8] memory tierAllocated;  // 索引 0-7
```

系统有 9 个等级(tier 1-9), 但 `tierAllocated` 数组只有 8 个元素。当推荐链上有 tier 8 或 tier 9 的用户时:

```solidity
if (
    currentTier > 0 &&
    !tierAllocated[currentTier]  // currentTier=8 → tierAllocated[8] → 越界!
) {
```

Solidity 0.8+ 数组越界会自动 revert, 导致整个 `_distributeHybridRewards` 失败, 进而导致 `_distributeTeamReward` 失败, 最终 `unstake()` 和 `withdrawInterest()` 全部 revert.

**触发条件:**
- 推荐链上任何人的 `_getUserTier()` 返回 8 或 9
- 即团队 KPI >= 10,000,000 USDX 且个人质押 >= 15,000 USDX (tier 8)
- 或团队 KPI >= 30,000,000 USDX 且个人质押 >= 20,000 USDX (tier 9)

**影响:**
1. 推荐链上有 V8/V9 用户的所有下级, **unstake 和 withdrawInterest 都会失败**
2. 用户资金被锁定, 无法提取
3. 随着系统运行, 达到 V8/V9 的用户越多, 受影响范围越大
4. 这会级联影响: 即使你自己不是 V8/V9, 只要推荐链上有一个 V8/V9 就会触发

**修复:** 将 `bool[8]` 改为 `bool[10]`

---

### C-02: withdrawInterest + unstake 双重利息获取

**位置:** `StakingBase.sol:286-357` (unstake) + `StakingBase.sol:368-460` (withdrawInterest)

**描述:**

这是当前合约中最严重的经济漏洞。用户可以先通过 `withdrawInterest` 提取利息, 然后在到期后通过 `unstake` **再次获取全部利息**, 实现双重获利。

**攻击流程:**

1. 用户质押 1000 USDX, 选择 90 天档位 (1.1% 日复利)
2. 在第 89 天, 调用 `withdrawInterest` — 此时利息约为 1677 USDX (本金+利息=2677)
   - `withdrawnInterest[user][stakeIndex]` 被更新为 ~1677
   - 合约 swap AE → USDX, 将利息的 USDX 转给用户 (扣费后)
3. 第 90 天到期后, 调用 `unstake`:

```solidity
// _burn 函数中:
reward = _calculateStakeReward(user_record);  // 返回 ~2677 (包含全部利息!)
// ↑ 这里没有扣除 withdrawnInterest

(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(calculatedReward);
// ↑ 按照全部 reward 来 swap, 包含了已提取的利息
```

**关键问题在 `_burn` 函数 (L1245-1275):**

```solidity
function _burn(uint256 index) private returns (uint256 reward, uint256 amount) {
    // ...
    amount = user_record.amount;
    reward = _calculateStakeReward(user_record);  // 计算全部利息, 未扣除已提取部分
    user_record.status = true;
    _update(sender, address(0), amount);
    // ...
}
```

`_calculateStakeReward` 计算的是从质押开始到当前的全部复利, **完全不考虑 `withdrawnInterest` 映射中已经提取的利息**。随后在 `unstake` 中:

```solidity
(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(calculatedReward);
// calculatedReward 包含了已提取的利息, 导致多 swap 出 USDX
```

**数值分析 (90天档, 1000 USDX本金):**

| 步骤 | 操作 | 利息获取 |
|------|------|---------|
| 第89天 | withdrawInterest | ~1677 USDX (扣费前) |
| 第90天 | unstake | ~2697 USDX total reward, 扣除本金1000后利息 ~1697 USDX (扣费前) |
| **合计** | | **~3374 USDX 利息** (正常应为 ~1697) |

用户获得了大约 **2倍利息**, 多余部分来自合约中的 AE 代币余额。

**影响:**
1. 攻击者可反复利用此漏洞掏空合约 AE 余额
2. 导致后续正常用户 unstake 时因 AE 不足而失败
3. 协议实际 APY 远超设计预期, 可能导致系统破产

---

## 5. 高危 (High) 问题

### H-01: _swapAEForReward 的 maxInput 硬限制可能导致 unstake 永久失败

**位置:** `StakingBase.sol:1307-1352`

**描述:**

```solidity
function _calculateMaxAEInput(
    uint256 usdxNeeded,
    uint256 availableXF
) private view returns (uint256 maxInput) {
    // ...计算逻辑...

    // 硬性上限: 最多使用合约 AE 余额的 50%
    uint256 maxAllowedInput = availableXF / 2;
    if (maxInput > maxAllowedInput) {
        maxInput = maxAllowedInput;
    }
}
```

此函数将最大 AE 输入限制为合约余额的 50%。当合约 AE 余额不足以通过卖出 50% 来获得所需 USDX 时, `swapTokensForExactTokens` 会 revert。

**触发场景:**
- 长期质押用户 (如365天档, 2%日复利) 到期后 reward 金额巨大
- C-02 漏洞被利用后, 合约 AE 余额快速消耗
- 多个用户同时 unstake, 合约 AE 余额不足以覆盖

**影响:** 用户资金永久锁定, 无法提取。没有任何备用路径让用户取回资金。

---

### H-02: unstake 中未扣除已提取利息导致费用分配基数膨胀

**位置:** `StakingBase.sol:294-306`

**描述:**

即使不考虑 C-02 的双重利息获取, `unstake` 中费用计算基数也存在问题:

```solidity
uint256 interestEarned = usdxReceived > principalAmount
    ? usdxReceived - principalAmount
    : 0;

// 教育基金: 基于 interestEarned 的 5%
uint256 educationFund = _distributeEducationFund(interestEarned);
// 团队奖励: 基于 interestEarned 的 35%
uint256 teamFee = _distributeTeamReward(referralChain, interestEarned);
```

如果用户已经通过 `withdrawInterest` 提取了部分利息 (且该利息已被扣过费), 在 `unstake` 时 `interestEarned` 仍然按全额计算, 导致教育基金和团队奖励被重复收取。

**影响:**
- 用户被多收费 (教育基金和团队奖励在已提取利息上重复收取)
- 费用分配金额超出预期
- `userPayout = usdxReceived - educationFund - teamFee` 可能因为费用过多而使用户实际到手金额异常偏低

---

## 6. 中危 (Medium) 问题

### M-01: setRootAddress 导致推荐链数据不一致

**位置:** `StakingBase.sol:542-546`

```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;
}
```

**问题:**
1. 旧 rootAddress 的 `_hasLocked` 被设为 false, 但 `_referrals[user] == oldRoot` 的用户推荐关系没有更新
2. 旧 root 的 `teamTotalInvestValue` 没有迁移到新 root
3. 旧 root 变为 `_hasLocked = false` 后, 如果有用户的推荐人是旧 root, 当他们在推荐链上被遍历时, 旧 root 的 tier 判断、团队奖励分配都不再正确
4. 如果旧 root 尝试重新绑定推荐关系, 由于 `_hasLocked` 已为 false 且 `_referrals[oldRoot] == address(0)`, 状态会混乱

---

### M-02: _distributeHybridRewards 的 tierRecipients/tierAmounts 数组只有 7 个槽位

**位置:** `StakingBase.sol:1448-1449, 1492-1493`

```solidity
address[7] memory tierRecipients;
uint256[7] memory tierAmounts;
// ...
tierRecipients[currentTier - 1] = referralChain[i];  // currentTier=8 → index 7 → OK
tierAmounts[currentTier - 1] = memberReward;          // currentTier=8 → index 7 → OK
// 但 currentTier=9 → index 8 → 越界!
```

即使修复了 C-01 的 `tierAllocated` 越界问题, `tierRecipients[currentTier - 1]` 在 `currentTier = 8` 时访问 index 7 (最后一个元素, OK), 但 `currentTier = 9` 时访问 index 8, 仍然越界 revert。

此外, `activeTiers` 使用 `uint8` 位图:
```solidity
activeTiers = activeTiers | uint8(1 << (currentTier - 1));
// currentTier=9 → 1 << 8 = 256 → 超出 uint8 范围, 结果为 0
```

这意味着 tier 9 的位图标记也会丢失。

**修复:** `tierRecipients` 和 `tierAmounts` 应扩展为 `[9]`, `activeTiers` 应改为 `uint16`。

> **注:** 此问题与 C-01 联合作用, 实际上 tier 8 和 tier 9 的存在会导致连锁 revert。单独来看此问题等级为中危, 但与 C-01 组合后为严重。

---

## 7. 安全审计检查清单

| 检查项 | 状态 | 备注 |
|-------|------|------|
| 重入攻击 | ⚠️ | withdrawInterest 遵循 CEI, 但 unstake 中外部调用较多且无 ReentrancyGuard |
| 整数溢出/下溢 | ✅ | Solidity 0.8+ 自动检查 |
| 数组越界 | ❌ | tierAllocated[8], tierRecipients[8] 越界导致 revert |
| 访问控制 | ✅ | 使用 OpenZeppelin Ownable |
| 三明治攻击 | ✅ | addLiquidity 已增加 5% 滑点保护 (已修复) |
| 双重利息获取 | ❌ | withdrawInterest + unstake 可双重获利 |
| DoS / 资金锁定 | ❌ | AE 余额不足时 unstake 失败, 无备用路径 |
| 闪电贷攻击 | ✅ | onlyEOA 修饰符提供保护 |
| 权限过大 | ⚠️ | Owner 可 emergencyWithdraw 所有资金 |

---

## 8. 优先修复建议

| 优先级 | 编号 | 描述 |
|-------|------|------|
| **P0 (立即)** | C-02 | unstake 中扣除 withdrawnInterest, 防止双重利息获取 |
| **P0 (立即)** | C-01 + M-02 | tierAllocated 改为 `bool[10]`, tierRecipients/tierAmounts 改为 `[9]`, activeTiers 改为 `uint16` |
| **P1 (尽快)** | H-01 | 增加 unstake 的紧急提取路径, 或优化 maxInput 限制策略 |
| **P1 (尽快)** | H-02 | unstake 费用计算时扣除已提取利息, 避免重复收费 |
| **P2 (计划)** | M-01 | setRootAddress 增加旧推荐关系迁移逻辑 |
