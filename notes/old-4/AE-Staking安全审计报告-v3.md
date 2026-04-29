# AE-Staking 合约安全审计报告 (v3)

## 1. 审计概览

| 项目 | 详情 |
|------|------|
| **合约名称** | AE-Staking (StakingBase + Staking) |
| **Solidity 版本** | ^0.8.20 |
| **审计范围** | `StakingBase.sol` (1910行), `Staking.sol` (115行), `IStaking.sol` (745行), `IAE.sol` (500行) |
| **依赖库** | OpenZeppelin (Ownable, IERC20), PRB-Math (UD60x18), Uniswap V2 |
| **部署目标** | BSC 主网 |
| **审计日期** | 2026-04-27 |
| **基准版本** | 基于 v2 审计后的最新代码 |

---

## 2. 历史问题修复状态

| 编号 | 问题 | 当前状态 |
|------|------|---------|
| v1-C-01 | tierAllocated 数组越界 (bool[8]) | ✅ 已修复 — 改为 `bool[10]` |
| v1-C-02 | withdrawInterest + unstake 双重利息 | ✅ 已修复 — `_burn` 中扣除 `withdrawnInterest` |
| v1-M-02 | tierRecipients/tierAmounts 越界 | ✅ 已修复 — 改为 `[9]`, activeTiers 改为 `uint16` |
| v2-H-01 | _swapAEForReward maxInput 硬限制 | ❌ **未修复** — 详见本报告 C-01 |
| v2-H-02 | unchecked 块含外部调用 | ❌ **未修复** — 详见本报告 H-02 |
| v2-M-01 | setRootAddress 推荐链不一致 | ❌ **未修复** — 详见本报告 M-01 |

---

## 3. 发现问题汇总

| 严重等级 | 数量 |
|---------|------|
| **严重 (Critical)** | 2 |
| **高危 (High)** | 2 |
| **中危 (Medium)** | 2 |

---

## 4. 严重 (Critical) 问题

### C-01: unstake 可因 AE 余额不足而永久锁定用户资金 — 无任何补救路径

**位置:** `StakingBase.sol:1285-1313` (`_swapAEForReward`) + `StakingBase.sol:1315-1360` (`_calculateMaxAEInput`)

**描述:**

`unstake` 和 `withdrawInterest` 的核心依赖是 `_swapAEForReward` — 用合约持有的 AE 代币通过 Uniswap 换出 USDX 来支付用户。这一步使用 `swapTokensForExactTokens`, 即"我要精确换出 X 个 USDX, 最多投入 Y 个 AE"。

```solidity
function _swapAEForReward(uint256 calculatedReward)
    private returns (uint256 usdxReceived, uint256 aeTokensUsed)
{
    uint256 maxXFInput = _calculateMaxAEInput(calculatedReward, aeBalanceBefore);

    ROUTER.swapTokensForExactTokens(
        calculatedReward,   // 精确要求的 USDX 数量
        maxXFInput,         // 最大 AE 投入 (被硬性限制为余额的50%)
        swapPath,
        address(this),
        block.timestamp
    );
}
```

`_calculateMaxAEInput` 中有硬性限制:

```solidity
uint256 maxAllowedInput = availableXF / 2;
if (maxInput > maxAllowedInput) {
    maxInput = maxAllowedInput;
}
```

**这是一个资金永久锁定漏洞**, 原因如下:

**场景 1: 复利导致的天文级 reward**

365天档, 2%日复利 (rate = 1.02):
- 1000 USDX 质押 365 天 → `1000 × 1.02^365 ≈ 1,377,408 USDX`

即使合约有大量 AE, 在流动性池子不够深的情况下, 用 50% AE 余额根本无法一次换出 137 万 USDX。`swapTokensForExactTokens` 会直接 revert。

**场景 2: 多用户连续提取**

每次 `unstake` 都会消耗合约 AE 余额 (通过 swap 卖出 AE)。当多个大额质押者依次 unstake 后, 剩余用户面临的 AE 余额可能不足以覆盖其 reward。

**场景 3: AE 价格下跌**

AE 对 USDX 价格下跌时, 每换出 1 USDX 需要更多 AE, 50% 限制更容易触发。

**为什么这是 Critical 而非 High:**

合约**没有任何用户可自行使用的备用路径**:
- 没有 `emergencyUnstake` 或 "部分提取" 功能
- 没有 fallback 到 `swapExactTokensForTokens` (卖出全部可用 AE, 获得尽可能多的 USDX)
- `emergencyWithdrawAE` / `emergencyWithdrawUSDX` 仅 owner 可调用, 且依赖 owner 的在线和配合
- 如果 owner 私钥丢失或不作为, 用户资金永久锁定, 不可恢复

**影响:**
1. 用户质押的本金+利息完全无法取回
2. 随着时间推移, 问题会逐渐恶化 (AE 被消耗, 需求增加)
3. 没有降级方案 — 要么全额取出, 要么完全失败
4. 对系统信誉的毁灭性打击

**修复建议:**

方案 A (推荐): 增加 fallback swap 机制

当 `swapTokensForExactTokens` 失败时, 自动降级为 `swapExactTokensForTokensSupportingFeeOnTransferTokens`, 将可用 AE 全部卖出, 用户获得实际能换到的 USDX (可能少于 reward, 但至少能取回部分资金)。

方案 B: 增加分批 unstake

允许用户多次 unstake 同一笔质押, 每次取出部分 reward, 直到全部取出。

方案 C: 移除 50% 硬限制

`_calculateMaxAEInput` 中不再限制为余额的 50%, 而是允许使用全部余额。风险是单次 unstake 可能耗尽所有 AE, 但至少不会锁定资金。

---

### C-02: unstake 费用计算基数在 withdrawInterest 后不准确 — 导致教育基金和团队奖励被逃避或超额收取

**位置:** `StakingBase.sol:289-306`

**描述:**

`unstake` 的费用分配基于 `interestEarned`:

```solidity
uint256 interestEarned = usdxReceived > principalAmount
    ? usdxReceived - principalAmount
    : 0;

uint256 educationFund = _distributeEducationFund(interestEarned);
uint256 teamFee = _distributeTeamReward(referralChain, interestEarned);
```

在 v2 修复后, `_burn` 会从 reward 中扣除 `withdrawnInterest`, 所以 `calculatedReward` = 总reward - 已提取利息。经过 swap 后 `usdxReceived ≈ calculatedReward`。

**问题:** 当用户已通过 `withdrawInterest` 提取了大部分利息后:

```
案例: 1000 USDX 质押, 到期总值 2677 USDX, 利息 1677 USDX

步骤1: 用户 withdrawInterest 提取 1500 USDX 利息
  - withdrawnInterest[user][idx] = 1500
  - 教育基金: 1500 * 5% = 75 (基于 usdxReceived)
  - 团队奖励: 1500 * 35% = 525 (基于 usdxReceived)

步骤2: 用户 unstake
  - _burn: reward = 2677 - 1500 = 1177
  - swap: usdxReceived ≈ 1177
  - interestEarned = 1177 - 1000 = 177
  - 教育基金: 177 * 5% = 8.85
  - 团队奖励: 177 * 35% = 61.95

总费用: 教育基金 75 + 8.85 = 83.85 (应为 1677 * 5% = 83.85) ✅ 看似正确
总费用: 团队 525 + 61.95 = 586.95 (应为 1677 * 35% = 587.05) ≈ 正确
```

**但注意!** `withdrawInterest` 中费用基数是 `usdxReceived` (swap 输出), **不是** `availableInterest` (计算出的利息):

```solidity
// withdrawInterest 中:
(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(availableInterest);
uint256 educationFund = _distributeEducationFund(usdxReceived);  // 基数是 usdxReceived!
uint256 teamFee = _distributeTeamReward(referralChain, usdxReceived);
```

而 `unstake` 中费用基数是 `interestEarned`:

```solidity
// unstake 中:
uint256 educationFund = _distributeEducationFund(interestEarned);  // 基数是 interestEarned!
uint256 teamFee = _distributeTeamReward(referralChain, interestEarned);
```

**两个函数使用了不同的费用基数计算逻辑!**

- `withdrawInterest`: 费用 = (swap后的USDX) × 费率 → **这里 swap 后 USDX = 利息金额, 但费用是从利息金额本身扣除, 用户到手 = usdxReceived - 教育基金 - 团队 - 赎回费**
- `unstake`: 费用 = (usdxReceived - principalAmount) × 费率 → **只对利息部分收费, 但如果 usdxReceived ≈ principalAmount (大部分利息已提取), 则费用趋近于零**

**实际风险场景:**

当用户已提取大部分利息 (如 `withdrawnInterest = 总利息 - 1`), 则 `unstake` 时:
- `reward ≈ principalAmount + 1`
- `usdxReceived ≈ principalAmount + 1`
- `interestEarned = 1`
- 教育基金 ≈ 0, 团队奖励 ≈ 0
- **赎回费仍然基于 userPayout 整体收取 (5%)** — 意味着本金也被收了 5% 赎回费

但如果用户一次性 `unstake` (不先 `withdrawInterest`):
- `interestEarned = 全部利息`
- 教育基金和团队奖励完整收取
- 赎回费同样基于 userPayout

**结论:** 先 `withdrawInterest` 再 `unstake` 不会逃避费用 (因为 withdrawInterest 时已交过了), 但会导致两个问题:
1. 赎回费 (5%) 在 `withdrawInterest` 时基于 (usdxReceived - 教育基金 - 团队) 收取, 在 `unstake` 时也对几乎全是本金的 `userPayout` 收取 → **用户对本金部分被多收了赎回费**
2. `_recordWithdrawal` 中的 `interestEarned` 不反映真实总利息, 链上数据不一致

**影响:**
1. 先提息再unstake的用户, 本金被额外收取 5% 赎回费 (约50 USDX per 1000 本金)
2. 事件日志和提取记录中 `interestEarned` 数据失真
3. 对前端展示和对账造成困扰

---

## 5. 高危 (High) 问题

### H-01: unstake 缺少重入保护 — 多个外部调用之间状态不一致窗口

**位置:** `StakingBase.sol:286-357`

**描述:**

`unstake` 函数的执行流程包含大量外部调用:

```
1. _burn(stakeIndex)
   └─ 内部修改 status = true, burn tokens (状态更新)
2. _swapAEForReward(calculatedReward)
   └─ ROUTER.swapTokensForExactTokens (外部调用 #1 - Uniswap)
3. _distributeEducationFund(interestEarned)
   └─ IERC20(USDX).transfer(educationFundAddress, fee) (外部调用 #2)
4. _distributeTeamReward(referralChain, interestEarned)
   └─ IERC20(USDX).transfer(referralChain[i], memberReward) (外部调用 #3..#N)
   └─ IERC20(USDX).transfer(rootAddress, marketingAmount) (外部调用 #N+1)
5. IERC20(USDX).transfer(feeRecipient, expectedRedemptionFeeUSDX) (外部调用 #N+2)
6. IERC20(USDX).transfer(msg.sender, userPayout) (外部调用 #N+3)
7. AE.recycle(aeTokensUsed) (外部调用 #N+4)
```

虽然 `_burn` 在第 1 步已将 `user_record.status = true`, 防止了同一笔质押被重复 unstake。但:

**风险 1: USDX 是可升级代币**

BSC 上的 USDT/USDC 等稳定币可能通过代理合约实现, 未来升级可能引入回调机制。如果 USDX 在 `transfer` 时触发回调:
- 步骤 5 (`transfer` to feeRecipient) 时, 如果 feeRecipient 是合约且有 `onTokenReceived` 回调, 攻击者可以在回调中再次调用 `unstake` (但会被 status=true 挡住) 或调用其他函数操纵状态

**风险 2: AE.recycle 的潜在回调**

`AE.recycle(aeTokensUsed)` 是最后一个外部调用。此时所有状态更新已完成, 但如果 `recycle` 内部逻辑复杂且会回调 staking 合约, 可能导致意外行为。

**风险 3: _distributeTeamReward 向任意地址 transfer**

团队奖励分配遍历推荐链 (最多 30 层), 向每个符合条件的推荐人 transfer USDX。如果推荐人地址是合约, 可能在接收代币时触发回调。

**当前缓解措施:**
- `onlyEOA` modifier (检查 `tx.origin == msg.sender`) — 防止合约直接调用, 但不防止接收端回调
- `user_record.status = true` — 防止同笔质押重复提取

**影响:**
- 当前 BSC 上 USDX (USDT) 是标准 ERC-20, 无回调, 实际风险低
- 但合约设计应考虑 "defense in depth", 一个简单的 `nonReentrant` modifier 可以消除此类担忧
- 如果未来更换 USDX 为其他稳定币 (如 USDC 的跨链版本), 风险显著增加

**修复建议:** 在 `unstake` 和 `withdrawInterest` 上添加 OpenZeppelin `ReentrancyGuard` 的 `nonReentrant` modifier。

---

### H-02: withdrawInterest 费用基数与 unstake 不一致 — 用户利息被双重收费

**位置:** `StakingBase.sol:396-408` (withdrawInterest) vs `StakingBase.sol:294-302` (unstake)

**描述:**

`withdrawInterest` 中, 费用计算的基数是 **swap 得到的全部 USDX** (`usdxReceived`):

```solidity
// withdrawInterest:
(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(availableInterest);
uint256 educationFund = _distributeEducationFund(usdxReceived);   // ← 基数 = 全部 swap 输出
uint256 teamFee = _distributeTeamReward(referralChain, usdxReceived);
uint256 userPayout = usdxReceived - educationFund - teamFee;
```

`unstake` 中, 费用计算的基数是 **利息部分** (`interestEarned = usdxReceived - principalAmount`):

```solidity
// unstake:
uint256 interestEarned = usdxReceived > principalAmount ? usdxReceived - principalAmount : 0;
uint256 educationFund = _distributeEducationFund(interestEarned);  // ← 基数 = 仅利息部分
uint256 teamFee = _distributeTeamReward(referralChain, interestEarned);
```

**不一致分析:**

如果用户一次性 `unstake` (从不调用 `withdrawInterest`):
- 费用仅对利息部分 (usdxReceived - principalAmount) 收取
- 本金不被收取教育基金和团队奖励

如果用户先 `withdrawInterest` 再 `unstake`:
- `withdrawInterest` 时: 费用对**全部 swap 输出** (即全部利息 USDX) 收取 — 这里 100% 都是利息, 逻辑正确
- `unstake` 时: 费用对 (usdxReceived - principalAmount) 收取 — 如果已提取大部分利息, 这个差值很小

**看起来两种路径的总费用差不多**, 但实际上 `withdrawInterest` 的费用率比 `unstake` 高:

- `withdrawInterest`: 教育基金 = usdxReceived × 5%, 团队 = usdxReceived × 35% → 总扣费 40% of usdxReceived, 然后赎回费 5% of (usdxReceived × 60%) = 3% of usdxReceived, **总扣费 ≈ 43%**
- `unstake` (全部利息): 教育基金 = interestEarned × 5%, 团队 = interestEarned × 35% → 总扣费 40% of interestEarned, 赎回费 5% of (usdxReceived - 40% of interestEarned), **赎回费包含了本金部分**, 但教育基金和团队不含本金

**结论: `withdrawInterest` 对同样金额的利息收取了与 `unstake` 相同的教育基金和团队费用, 但赎回费仅对利息的净额收取 (不含本金)。反之, `unstake` 的赎回费对 userPayout (含本金) 收取。**

**核心问题:** 走 withdrawInterest + unstake 路径的用户, 赎回费被收了两次 — 一次对利息, 一次对本金+剩余利息。而一次性 unstake 的用户, 赎回费只收一次 (对本金+全部利息)。

**影响:** 先提息再unstake的用户额外多付约 3% 的赎回费 (对已提取利息部分)。

---

## 6. 中危 (Medium) 问题

### M-01: setRootAddress 导致推荐链断裂和数据不一致

**位置:** `StakingBase.sol:542-546`

**描述:**

```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;
}
```

更换 rootAddress 后存在多个数据一致性问题:

1. **旧 root 的推荐关系未迁移**: 所有 `_referrals[user] == oldRoot` 的用户, 其推荐链仍指向旧 root。但旧 root 的 `_hasLocked = false`, 不再被视为有效推荐人
2. **旧 root 的 teamTotalInvestValue 不迁移**: 新 root 的团队业绩为 0, 不影响奖励分配 (因为 root tier 始终返回 0), 但影响 `getTeamPerformanceDetails` 等查询
3. **旧 root 可能获得团队奖励**: `_getUserTier` 中 `if (user == rootAddress) return 0` — 切换后, 旧 root 不再被特判为 tier 0, 如果旧 root 有足够的 teamKPI 和个人质押, 它会被分配团队奖励
4. **_children 不迁移**: `_children[oldRoot]` 不会转移到 `_children[newRoot]`, 新 root 没有直接下级
5. **未分配奖励接收地址变更**: `_distributeTeamReward` 中, 未分配部分发送到 `rootAddress`, 切换后立即生效, 可能导致过渡期资金发送到错误地址

**影响:**
- 推荐树结构逻辑性破坏
- 旧 root 下的用户 unstake 时, 团队奖励可能分配给旧 root (本应发给新 root)
- 查询接口数据不一致

---

### M-02: _distributeEducationFund 和 _distributeTeamReward 中 transfer 失败不会 revert — 但 USDX 是标准 ERC-20 会 revert

**位置:** `StakingBase.sol:1362-1374` + `StakingBase.sol:1493`

**描述:**

```solidity
IERC20(USDX).transfer(educationFundAddress, fee);
```

标准 ERC-20 `transfer` 在余额不足时会 revert。但如果合约 USDX 余额因为某种原因不足以覆盖所有费用分配, 整个 `unstake` / `withdrawInterest` 会 revert, 导致用户无法取款。

**场景分析:**

`_swapAEForReward` 换出 USDX 后, 紧接着需要分配:
- 教育基金 (5% of interestEarned)
- 团队奖励 (35% of interestEarned, 分配给推荐链)
- 赎回费 (5% of userPayout)
- 用户到手

如果 swap 的 `usdxReceived` 精确等于 `calculatedReward`, 那么分配应该够用。但 `_swapAEForReward` 中:

```solidity
usdxReceived = IERC20(USDX).balanceOf(address(this)) - usdxBalanceBefore;
```

这个差额**包含了合约本来就有的 USDX 余额变化**。如果在 swap 的同一笔交易中, 合约从其他途径收到了 USDX (如有人 stake), `usdxReceived` 会偏大。虽然 `onlyEOA` 防止了单用户的原子操作, 但 MEV bot 可以在同一区块中排列交易来影响这个差额。

实际上, BSC 主网上 USDX (USDT) 的 transfer 在余额充足时总是成功返回 true, 余额不足时 revert。只要 swap 正常, 后续分配不会遇到余额不足。**此问题的实际风险较低**, 但代码中没有对分配总额做预检查。

**影响:** 当前实际风险低, 但缺少防御性检查。

---

## 7. 安全审计详细检查清单

| 检查项 | 状态 | 详细说明 |
|-------|------|---------|
| **重入攻击** | ⚠️ | 无 ReentrancyGuard. `_burn` 在 swap 前更新 status, 防止同笔重入. 但 unstake 有 7+ 个外部调用, 理论上存在跨函数重入风险 |
| **整数溢出/下溢** | ⚠️ | `unchecked` 块 (L330-353) 中 `totalDividendsDistributed += userPayout` 和 `totalClaimedStakingReward += userPayout` 不做溢出检查. uint256 溢出实际不可能, 但违反最佳实践 |
| **数组越界** | ✅ | tierAllocated[10], tierRecipients[9], tierAmounts[9] 已修复 |
| **访问控制** | ✅ | Ownable 模式, admin 函数受 onlyOwner 保护 |
| **三明治攻击 (stake)** | ✅ | addLiquidity 基于实际 swap 结果计算 5% 滑点 amountMin |
| **三明治攻击 (unstake)** | ⚠️ | `_swapAEForReward` 用 `swapTokensForExactTokens` (指定精确输出), 不存在传统三明治风险, 但 `_calculateMaxAEInput` 的 150% 滑点容忍度可能导致付出更多 AE |
| **双重利息获取** | ✅ | `_burn` 中扣除 `withdrawnInterest`, 已修复 |
| **DoS / 资金锁定** | ❌ | AE 余额不足或 50% 硬限制触发时 unstake 失败, 无备用路径 (C-01) |
| **闪电贷攻击** | ✅ | `onlyEOA` modifier (tx.origin == msg.sender) 防止合约调用, 但不防止 tx.origin 钓鱼 |
| **权限集中** | ⚠️ | Owner 可 emergencyWithdraw 所有 AE 和 USDX, 可 setRootAddress, 可 setAE, 无多签或时间锁 |
| **费用计算一致性** | ❌ | withdrawInterest 和 unstake 的费用基数不一致 (C-02, H-02) |
| **Oracle 操纵** | ✅ | 不依赖外部 Oracle, 价格来自 Uniswap 池子, stake 的池子比例检查 (1%) 提供一定保护 |
| **前端数据一致性** | ⚠️ | `_recordWithdrawal` 中 `interestEarned` 在先提息后unstake场景下不准确 |

---

## 8. 优先修复建议

| 优先级 | 编号 | 描述 | 复杂度 |
|-------|------|------|-------|
| **P0 (必须)** | C-01 | 增加 unstake fallback 机制, 当 swap 失败时提供降级路径, 防止资金永久锁定 | 高 |
| **P0 (必须)** | C-02 | 统一 withdrawInterest 和 unstake 的费用计算基数, 解决先提息再unstake的赎回费双重收取问题 | 中 |
| **P1 (尽快)** | H-01 | 添加 ReentrancyGuard 到 unstake 和 withdrawInterest | 低 |
| **P1 (尽快)** | H-02 | 移除 unchecked 块中的外部调用; 或至少将 transfer 调用移出 unchecked | 低 |
| **P2 (计划)** | M-01 | setRootAddress 增加推荐关系迁移或保护机制 | 中 |
| **P2 (计划)** | M-02 | 增加费用分配前的余额预检查 | 低 |

---

## 9. 总体评估

当前合约相比 v1 审计已有显著改进:
- 双重利息漏洞 (v1-C-02) 已正确修复
- 数组越界问题 (v1-C-01, v1-M-02) 已修复
- 三明治攻击保护 (v1-H-01) 已添加

但仍存在两个关键问题需要在主网部署前解决:
1. **资金锁定风险** (C-01): AE 余额不足时用户无法取回资金, 这是系统性风险
2. **费用计算不一致** (C-02): 先 withdrawInterest 再 unstake 的用户会被多收赎回费

建议在修复 C-01 和 C-02 后再进行主网部署。
