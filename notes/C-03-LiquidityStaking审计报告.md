# LiquidityStaking 合约安全审计报告

## 审计范围

| 文件 | 路径 |
|------|------|
| LiquidityStakingBase.sol | `contracts/LiquidityStaking/src/abstract/LiquidityStakingBase.sol` |
| LiquidityStaking.sol | `contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol` |
| IAE.sol | `contracts/LiquidityStaking/src/interfaces/IAE.sol` |

Solidity 版本: `^0.8.20`
依赖: OpenZeppelin (Ownable, ReentrancyGuard, IERC20), Uniswap V2 Router

---

## 漏洞汇总

| 编号 | 严重程度 | 标题 | 位置 |
|------|----------|------|------|
| V-01 | **严重** | `_processAccumulatedBLA` 条件逻辑错误，BLA 永远无法被兑换 | Base:414 |
| V-02 | **严重** | 奖励超发 — timeMultiplier 导致实际分发超过奖池总量 | Base:338-352 |
| V-03 | **高** | Swap 滑点保护为零，易遭三明治攻击 | Base:452 |
| V-04 | **高** | stakers 数组无限增长导致 DoS 风险 | Base:376-388, 400-408 |
| V-05 | **高** | `depositRewards` 覆盖未分发奖励的分发速率 | Base:266-270 |
| V-06 | **中** | `emergencyWithdraw` 可提取用户质押的 LP 代币 | Base:573-578 |
| V-07 | **中** | 追加质押不重置 stakeTime，timeMultiplier 可被博弈 | Base:160-172 |
| V-08 | **中** | `_rewardPerToken` 使用 totalStaked 而非 totalWeight 计算 | Base:309-320 |
| V-09 | **低** | `_swapBLAForUSDT` 使用 approve 而非 safeApprove/增量授权 | Base:443 |
| V-10 | **低** | 构造函数未校验 `_marketingAddress` 和 `_admin` | Base:118 |
| V-11 | **信息** | `_calculateCurrentTotalWeight` 和 `rewardPool.totalWeight` 未同步 | Base:46,369 |
| V-12 | **信息** | 事件缺少关键索引字段 | Base:74-81 |

---

## 详细分析

### V-01 [严重] `_processAccumulatedBLA` 条件逻辑错误

**位置:** `LiquidityStakingBase.sol:414`

```solidity
if (accumulatedBLA == 0 && accumulatedBLA > 10 ether) return;
```

**问题:** 这个条件永远为 `true`（当 `accumulatedBLA == 0` 时）或永远导致函数继续执行（当 `accumulatedBLA != 0` 时，第一个条件为 false，整个 AND 为 false）。但实际意图应该是：
- 当 `accumulatedBLA == 0` 时跳过（没有可兑换的）
- 当 `accumulatedBLA < 10 ether` 时跳过（累积不够）

**实际效果:**
- 当 `accumulatedBLA == 0` 时：`0 == 0` 为 true，`0 > 10 ether` 为 false → AND 结果为 false → **不 return，继续执行**
- 这意味着即使 `accumulatedBLA == 0`，也会执行后续的 swap 操作（`blaToSwap = 0`）
- 当 `accumulatedBLA > 0` 时：`!= 0` 为 false → AND 结果为 false → **不 return，继续执行**
- 这意味着任何金额都会被立即兑换，无法实现"累积到 10 ether 再兑换"的设计意图

**应改为:**
```solidity
if (accumulatedBLA == 0 || accumulatedBLA < 10 ether) return;
```

**影响:** BLA 累积机制完全失效。每次 stake/unstake/claim 都会触发一次 swap（即使金额很小），浪费 gas 且可能因小额交易产生极差的兑换率。

---

### V-02 [严重] 奖励超发 — timeMultiplier 导致分发超过奖池总量

**位置:** `LiquidityStakingBase.sol:338-352`

```solidity
function _calculateEarnedRewards(...) internal view returns (uint256) {
    // ...
    uint256 timeMultiplier = 1e18 + (stakeDuration * 1e18) / (365 days);
    uint256 baseRewards = (userStake.amount * rewardPerTokenDelta) / 1e18;
    return (baseRewards * timeMultiplier) / 1e18;
}
```

**问题:** `rewardPerToken` 的计算基于 `totalStaked`（纯数量），但实际分发时乘以了 `timeMultiplier`（大于 1x）。这意味着：

- 假设只有一个用户质押了 100 LP，质押了 365 天
- `timeMultiplier = 2e18`（2倍）
- 用户实际获得的奖励 = baseRewards × 2 = 奖池的 2 倍

**后果:** 合约中的 USDT 余额可能不足以支付所有用户的奖励，导致后来 claim 的用户无法提取。这是一个典型的"先到先得"问题，可能导致银行挤兑。

`rewardPool.pendingRewards` 的扣减也不准确 — 它只减去实际发放的 reward，但 `rewardPerSecond` 的计算没有考虑 timeMultiplier 的放大效应。

---

### V-03 [高] Swap 滑点保护为零

**位置:** `LiquidityStakingBase.sol:450-457`

```solidity
router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    blaAmount,
    0, // accept any amount of USDT  ← 零滑点保护
    path,
    address(this),
    block.timestamp + 300
);
```

**问题:** `amountOutMin` 设为 0，意味着接受任意兑换比例。攻击者可以：
1. 监控 mempool 中的 `stake()`/`unstake()`/`claimReward()` 交易
2. 在交易前大量卖出 USDT 买入 BLA（拉高 BLA 价格）
3. 合约以极差的价格将 BLA 换成 USDT
4. 攻击者反向操作获利

**建议:** 使用预言机（如 Chainlink）或 TWAP 价格来设置合理的 `amountOutMin`。

---

### V-04 [高] stakers 数组无限增长导致 DoS 风险

**位置:** `LiquidityStakingBase.sol:376-388`（`_calculateCurrentTotalWeight`）和 `400-408`（`_removeStaker`）

```solidity
function _calculateCurrentTotalWeight() internal view returns (uint256) {
    for (uint256 i = 0; i < stakers.length; i++) {  // 遍历所有 staker
        // ...
    }
}

function _removeStaker(address account) internal {
    for (uint256 i = 0; i < stakers.length; i++) {  // 线性搜索
        // ...
    }
}
```

**问题:**
1. `_calculateCurrentTotalWeight()` 遍历整个 stakers 数组，被 `getRewardPoolInfo()` view 函数调用
2. `_removeStaker()` 也是线性搜索
3. 虽然有 block-level 缓存（`cachedWeightTimestamp`），但每个新区块的第一次调用仍需完整遍历
4. 当 stakers 数量达到数千时，gas 消耗可能超过区块 gas limit

**攻击场景:** 攻击者可以用大量地址各质押最小金额，使数组膨胀到导致 `_updateCachedTotalWeight()` 超出 gas limit，从而阻止所有人 stake/unstake。

**注意:** `_calculateCurrentTotalWeight()` 实际上在核心的 stake/unstake/claim 流程中并不直接参与奖励计算（奖励计算用的是 `_rewardPerToken` 基于 `totalStaked`），但 `_updateCachedTotalWeight()` 在每次 stake/unstake 时被调用，仍然会消耗大量 gas。

**建议:** 移除对 stakers 数组的遍历，改用增量更新 totalWeight 的方式。

---

### V-05 [高] `depositRewards` 覆盖未分发奖励的分发速率

**位置:** `LiquidityStakingBase.sol:254-272`

```solidity
function depositRewards(uint256 amount) external onlyAdmin updateReward(address(0)) {
    rewardPool.totalRewards += amount;
    rewardPool.pendingRewards += amount;

    uint256 distributionPeriod = 7 days;
    rewardPool.rewardPerSecond = rewardPool.pendingRewards / distributionPeriod;
}
```

**问题:** 每次 deposit 都用 `pendingRewards / 7 days` 重新计算 `rewardPerSecond`。如果在第一次 deposit 的 7 天分发期内再次 deposit：

- 第 1 天 deposit 700 USDT → `rewardPerSecond = 700 / 604800`
- 第 3 天 deposit 700 USDT → `pendingRewards` 此时约为 `700 - 已分发 + 700`
- 但 `pendingRewards` 的减少只在用户 claim 时发生，如果没人 claim，`pendingRewards` 仍为 700 + 700 = 1400
- 新的 `rewardPerSecond = 1400 / 604800`，这意味着 7 天内要分发 1400，但实际上前 3 天已经按旧速率分发了一部分

**后果:** `pendingRewards` 的追踪不准确，可能导致奖励分发速率与实际可用奖励不匹配。

---

### V-06 [中] `emergencyWithdraw` 可提取用户质押的 LP 代币

**位置:** `LiquidityStakingBase.sol:573-578`

```solidity
function emergencyWithdraw(address token, uint256 amount) external onlyAdmin {
    IERC20(token).transfer(olaContract, amount);
}
```

**问题:**
1. `token` 参数没有限制，admin 可以提取用户质押的 LP 代币
2. 没有检查提取后是否仍有足够余额覆盖用户的质押
3. 未检查 `transfer` 返回值（虽然 OZ 的 IERC20 在 0.8.x 下会 revert）
4. 没有 timelock 或多签保护

**建议:** 至少应排除 `lpToken` 地址，或限制提取金额不超过"合约余额 - totalStaked"。

---

### V-07 [中] 追加质押不重置 stakeTime，timeMultiplier 可被博弈

**位置:** `LiquidityStakingBase.sol:160-172`

```solidity
if (!isStaker[msg.sender]) {
    stakers.push(msg.sender);
    isStaker[msg.sender] = true;
    userStake.stakeTime = block.timestamp;  // 只在首次质押时设置
    // ...
}
userStake.amount += amount;  // 追加质押不更新 stakeTime
```

**问题:** 用户可以先质押 1 wei LP 代币，等待 365 天后获得 2x timeMultiplier，然后追加大量 LP 代币，立即享受 2x 的奖励倍率。

**攻击步骤:**
1. 质押 1 wei LP → stakeTime = now
2. 等待 365 天 → timeMultiplier = 2x
3. 追加质押 1000000 LP → stakeTime 不变，立即享受 2x 倍率
4. 相比同时质押 1000000 LP 的用户（timeMultiplier ≈ 1x），攻击者获得近 2 倍奖励

**建议:** 追加质押时应使用加权平均时间更新 stakeTime，或对每笔质押单独计算 timeMultiplier。

---

### V-08 [中] `_rewardPerToken` 使用 totalStaked 而非 totalWeight

**位置:** `LiquidityStakingBase.sol:309-320`

```solidity
function _rewardPerToken() internal view returns (uint256) {
    if (rewardPool.totalStaked == 0) {
        return rewardPool.rewardPerTokenStored;
    }
    uint256 additionalRewardPerToken = (timeDelta *
        rewardPool.rewardPerSecond * 1e18) / rewardPool.totalStaked;
    return rewardPool.rewardPerTokenStored + additionalRewardPerToken;
}
```

**问题:** `rewardPerToken` 基于 `totalStaked`（纯数量）计算，但 `_calculateEarnedRewards` 中又乘以了 `timeMultiplier`。这导致：

1. 奖励分配不是按权重比例的 — 所有人先按数量比例分，再各自乘以自己的 timeMultiplier
2. 这与 `_calculateWeight` 函数的设计意图不一致（weight 考虑了时间，但 rewardPerToken 没有）
3. `rewardPool.totalWeight` 字段在 struct 中定义了但从未被正确使用

**后果:** 时间乘数的效果是"额外奖励"而非"按权重分配"，这会导致 V-02 中描述的超发问题。

---

### V-09 [低] `_swapBLAForUSDT` 使用 approve 而非安全授权模式

**位置:** `LiquidityStakingBase.sol:443`

```solidity
IERC20(olaContract).approve(address(router), blaAmount);
```

**问题:** 某些代币（如 USDT 本身）要求先将 allowance 设为 0 再设新值。虽然这里是 BLA 代币（项目自有），但如果 BLA 代币有类似行为，approve 可能会 revert。

**建议:** 使用 OpenZeppelin 的 `SafeERC20.forceApprove()` 或先 approve(0) 再 approve(amount)。

---

### V-10 [低] 构造函数未校验关键地址参数

**位置:** `LiquidityStakingBase.sol:118`

```solidity
constructor(...) Ownable(_admin) {
    if (_usdt == address(0) || _olaContract == address(0) ||
        _lpToken == address(0) || _staking == address(0) ||
        _router == address(0)) {
        revert InvalidAddress();
    }
    // _marketingAddress 和 _admin 未校验
```

**问题:** `_admin` 传给 `Ownable` 作为 owner，如果为 `address(0)` 则合约将无 owner（虽然 OZ Ownable 会 revert）。`_marketingAddress` 如果传入错误地址，会将错误地址排除在质押之外（影响较小）。

---

### V-11 [信息] `totalWeight` 字段未被同步维护

**位置:** `LiquidityStakingBase.sol:46` 和 `369-396`

`RewardPool` 结构体中定义了 `totalWeight` 字段，但在整个合约中从未被写入。`_calculateCurrentTotalWeight()` 每次都重新计算但只存入 `cachedTotalWeight`，而 `rewardPool.totalWeight` 始终为 0。

`getRewardPoolInfo()` 返回的 `totalWeight` 是通过 `_calculateCurrentTotalWeight()` 实时计算的，所以对外部查询没有影响，但这是一个死代码/冗余字段。

---

### V-12 [信息] 事件缺少关键索引字段

**位置:** `LiquidityStakingBase.sol:74-81`

```solidity
event RewardsDeposited(uint256 amount, uint256 newRewardRate);
event BLARewardsAccumulated(uint256 blaAmount, uint256 totalAccumulated);
event BLASwappedToRewards(uint256 blaAmount, uint256 usdtAmount, uint256 newRewardRate);
```

这些事件没有 `indexed` 参数，不便于链下过滤和监控。建议至少对关键事件添加 indexed 字段。

---

## 其他观察

### 1. 重入保护 ✅
所有外部函数都使用了 `nonReentrant` modifier，防护到位。

### 2. 整数溢出 ✅
使用 Solidity 0.8.x，内置溢出检查。

### 3. `transferFrom` 返回值检查 ✅
所有 `transferFrom` 和 `transfer` 调用都检查了返回值（除了 `emergencyWithdraw`）。

### 4. `_processAccumulatedBLA` 中的 try-catch
`triggerFundRelayDistribution()` 和 swap 操作都用了 try-catch，不会因外部调用失败而阻塞主流程。这是好的防御性编程。

### 5. 最小质押时间
mainnet 设置为 24 小时，可以防止闪电贷攻击（闪电贷必须在同一交易内归还）。

---

## 风险评级总结

| 严重程度 | 数量 | 说明 |
|----------|------|------|
| 严重 (Critical) | 2 | V-01 逻辑 bug 导致功能失效；V-02 奖励超发可耗尽资金池 |
| 高 (High) | 3 | V-03 三明治攻击；V-04 DoS 风险；V-05 奖励速率计算问题 |
| 中 (Medium) | 3 | V-06 紧急提取无限制；V-07 时间乘数可博弈；V-08 权重计算不一致 |
| 低 (Low) | 2 | V-09 approve 模式；V-10 构造函数校验 |
| 信息 (Info) | 2 | V-11 死字段；V-12 事件索引 |

---

## 优先修复建议

1. **立即修复 V-01** — 将 `&&` 改为 `||`，这是一个明显的逻辑 bug
2. **重新设计奖励机制 (V-02, V-08)** — 要么让 `rewardPerToken` 基于 totalWeight 计算，要么移除 timeMultiplier 的放大效应，确保总分发量不超过奖池
3. **添加滑点保护 (V-03)** — 使用预言机价格或 TWAP 设置 amountOutMin
4. **优化 stakers 数组 (V-04)** — 改用 EnumerableSet 或增量更新 totalWeight
5. **限制 emergencyWithdraw (V-06)** — 至少排除 lpToken，或限制金额
