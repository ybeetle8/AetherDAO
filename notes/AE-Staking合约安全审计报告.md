# AE-Staking 合约安全审计报告

## 审计范围

| 文件 | 行数 | 说明 |
|------|------|------|
| `contracts/AE-Staking/src/abstract/StakingBase.sol` | 1680 | 核心逻辑基类 |
| `contracts/AE-Staking/src/mainnet/Staking.sol` | 115 | 主网实现（常量配置） |
| `contracts/AE-Staking/src/interfaces/IStaking.sol` | 621 | 接口定义 |
| `contracts/AE-Staking/src/interfaces/IAE.sol` | 496 | AE 代币接口 |

## 风险等级定义

- **严重 (Critical)**: 可直接导致资金损失
- **高危 (High)**: 可被利用造成显著经济损害或协议功能异常
- **中危 (Medium)**: 可能在特定条件下造成损害
- **低危 (Low)**: 最佳实践偏差，潜在风险较小
- **信息 (Info)**: 代码质量建议

---

## 一、严重 (Critical) 漏洞

### C-01: `unstake` 赎回费未从 `userPayout` 中扣除 — 用户多拿钱

**位置**: `StakingBase.sol:265-286`

**描述**:

`unstake` 函数计算了赎回费 `expectedRedemptionFeeUSDX`，并通过 `_swapAEForReward` 将 AE 换成 USDX 转给 `feeRecipient`。但问题在于：`userPayout` 的计算在赎回费扣除之前完成，且赎回费并没有从 `userPayout` 中减去。

```solidity
uint256 userPayout = usdxReceived - educationFund - teamFee;  // 第265行

// 赎回费从 AE 池中额外换出，但 userPayout 没有减少
uint256 expectedRedemptionFeeUSDX = (userPayout * REDEMPTION_FEE_RATE) /
    BASIS_POINTS_DENOMINATOR;
// ... _swapAEForReward(expectedRedemptionFeeUSDX) ...

IERC20(USDX).transfer(msg.sender, userPayout);  // 第302行 — 用户拿到的是未扣赎回费的金额
```

赎回费实际上是从合约的 AE 储备中额外支出的，而不是从用户应得金额中扣除。这意味着：
1. 用户拿到了比预期多 0.6% 的金额
2. 合约的 AE 储备被额外消耗
3. 长期运行会导致合约 AE 储备枯竭

**`withdrawInterest` 存在同样的问题** (`StakingBase.sol:358-379`)。

**风险**: 严重 — 每次 unstake/withdrawInterest 都会额外消耗合约 AE 储备，累积效应可能导致合约无法正常运作。

### C-02: `sync()` 函数可被任何人调用 — 直接清空合约 USDX 余额

**位置**: `StakingBase.sol:489-494`

**描述**:

```solidity
function sync() external {
    uint256 w_bal = IERC20(USDX).balanceOf(address(this));
    address pair = AE.getUniswapV2Pair();
    IERC20(USDX).transfer(pair, w_bal);
    IUniswapV2Pair(pair).sync();
}
```

此函数没有任何访问控制，任何人都可以调用。它会将合约中**所有的 USDX 余额**转移到 LP 池中，然后调用 `sync()` 更新储备量。

**攻击场景**:
1. 用户 A 调用 `unstake`，合约通过 `_swapAEForReward` 获得 USDX
2. 在 `IERC20(USDX).transfer(msg.sender, userPayout)` 执行之前（同一交易内不可能，但如果合约中有待分配的 USDX）
3. 攻击者调用 `sync()`，将所有 USDX 送入 LP 池
4. 后续的 `unstake` 和 `withdrawInterest` 操作将因 USDX 余额不足而失败

更实际的攻击：如果合约因为任何原因持有 USDX（比如 fee 分配的时间差），攻击者可以调用 `sync()` 将这些 USDX 全部注入 LP 池，相当于给 LP 持有者送钱。

**风险**: 严重 — 无权限控制的资金转移函数。

### C-03: `withdrawInterest` 费用基数不一致 — 经济模型偏差

**位置**: `StakingBase.sol:348-358`

**描述**:

在 `unstake` 中，教育基金和团队奖励是基于 `interestEarned`（利息部分）计算的：
```solidity
// unstake:
uint256 educationFund = _distributeEducationFund(interestEarned);
uint256 teamFee = _distributeTeamReward(referralChain, interestEarned);
```

但在 `withdrawInterest` 中，费用是基于 `usdxReceived`（swap 后实际收到的 USDX）计算的：
```solidity
// withdrawInterest:
(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(availableInterest);
uint256 educationFund = _distributeEducationFund(usdxReceived);
uint256 teamFee = _distributeTeamReward(referralChain, usdxReceived);
```

由于 swap 滑点和价格波动，`usdxReceived` 可能与 `availableInterest` 有显著差异。如果 AE 价格上涨，`usdxReceived > availableInterest`，费用会被多收；反之则少收。

**风险**: 中危 — 费用计算不一致，可能导致用户被多收或少收费用。

---

## 二、高危 (High) 漏洞

### H-01: `addLiquidity` 零滑点保护 — 三明治攻击

**位置**: `StakingBase.sol:1375-1384`

**描述**:

```solidity
ROUTER.addLiquidity(
    address(USDX),
    address(AE),
    remainingUsdx,
    aeTokensReceived,
    0,    // minAmountA = 0 !!!
    0,    // minAmountB = 0 !!!
    address(0),
    block.timestamp
);
```

`addLiquidity` 的最小输出参数设为 0，完全没有滑点保护。攻击者可以：
1. 在用户 `stake` 交易之前操纵 LP 池价格
2. 用户的 `addLiquidity` 以极差的价格执行
3. 攻击者在之后恢复价格获利

虽然 `swapExactTokensForTokensSupportingFeeOnTransferTokens` 有滑点保护，但 `addLiquidity` 没有，攻击者仍可在 swap 之后、addLiquidity 之前操纵价格。

**风险**: 高 — 每次 stake 操作都暴露在三明治攻击风险中。

### H-02: LP 代币发送到 `address(0)` — 永久锁定

**位置**: `StakingBase.sol:1382`

```solidity
ROUTER.addLiquidity(
    ...
    address(0),   // LP 代币接收地址
    block.timestamp
);
```

LP 代币被发送到 `address(0)`，这意味着流动性被永久锁定，无法取回。这是一个设计决策而非 bug，但需要明确：
- 合约无法移除流动性
- 如果需要迁移协议，这些流动性将永远丢失
- 没有紧急恢复机制

**风险**: 高 — 不可逆的流动性锁定，无迁移路径。

### H-03: `emergencyWithdraw` 函数可提取用户资金

**位置**: `StakingBase.sol:1577-1589`

**描述**:

```solidity
function emergencyWithdrawAE(address to, uint256 _amount) external onlyOwner {
    AE.transfer(to, _amount);
}

function emergencyWithdrawUSDX(address to, uint256 _amount) external onlyOwner {
    IERC20(USDX).transfer(to, _amount);
}
```

Owner 可以随时提取合约中的所有 AE 和 USDX 代币。这些代币包括：
- 用户质押产生的 AE（用于 unstake 时 swap 回 USDX）
- 待分配的 USDX 费用

如果 owner 私钥泄露或 owner 恶意操作，所有用户资金都会丢失。

**风险**: 高 — 中心化风险，owner 拥有对所有资金的完全控制权。

### H-04: `setRootAddress` 可破坏推荐链

**位置**: `StakingBase.sol:483-487`

```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;
}
```

更改 rootAddress 时：
1. 旧 rootAddress 的 `_hasLocked` 被设为 false
2. 但旧 rootAddress 可能已经是其他用户的推荐人
3. 如果有用户的推荐链中包含旧 rootAddress，`_hasLocked` 变为 false 不会影响已绑定的关系
4. 但新用户将无法以旧 rootAddress 作为推荐人绑定

更严重的是，团队奖励中未分配的部分会发送到 `rootAddress`。更改后，奖励流向新地址，旧地址的利益相关者受损。

**风险**: 高 — 可破坏推荐系统和奖励分配。

### H-05: `_swapAEForReward` 可能因储备不足而 revert — 用户无法 unstake

**位置**: `StakingBase.sol:1077-1105`

**描述**:

`_swapAEForReward` 使用 `swapTokensForExactTokens`，要求精确获得 `calculatedReward` 数量的 USDX。如果：
1. LP 池中 USDX 储备不足以满足请求
2. 合约持有的 AE 不足以换取所需 USDX
3. `_calculateMaxAEInput` 计算的 `maxInput` 不够

交易将 revert，用户无法 unstake。这在以下情况下可能发生：
- 大量用户同时 unstake（银行挤兑）
- AE 价格大幅下跌
- LP 池流动性被大量移除

**风险**: 高 — 可能导致用户资金被锁定，无法提取。

---

## 三、中危 (Medium) 漏洞

### M-01: `tx.origin` 检查可被绕过

**位置**: `StakingBase.sol:194-198`

```solidity
modifier onlyEOA() {
    if (shouldCheckEOA() && tx.origin != msg.sender)
        revert OnlyEOAAllowed();
    _;
}
```

`tx.origin == msg.sender` 检查的目的是阻止合约调用，但：
1. 这不能阻止通过 `DELEGATECALL` 的调用
2. 未来 EIP（如账户抽象 ERC-4337）可能使 EOA 检查失效
3. 这个检查不是安全边界，不应依赖它来防止攻击

**风险**: 中 — 安全假设可能在未来被打破。

### M-02: `unchecked` 块中的潜在下溢

**位置**: `StakingBase.sol:288-303`

```solidity
unchecked {
    _recordWithdrawal(...);
    IERC20(USDX).transfer(msg.sender, userPayout);
}
```

`unstake` 中的 `unchecked` 块包含了 `_recordWithdrawal` 和 USDX 转账。虽然 `_recordWithdrawal` 本身不涉及算术运算，但将外部调用放在 `unchecked` 块中是不好的实践。如果未来修改代码在此块中添加算术运算，可能引入下溢漏洞。

**风险**: 中 — 当前无直接风险，但增加了未来修改的风险。

### M-03: `_updateTeamInvestmentValues` 减少时可能下溢

**位置**: `StakingBase.sol:956-972`

```solidity
unchecked {
    if (isIncrease) {
        teamTotalInvestValue[referralChain[i]] += amount;
    } else {
        teamTotalInvestValue[referralChain[i]] -= amount;  // 可能下溢！
    }
}
```

在 `unchecked` 块中执行减法。如果由于任何原因（如推荐链变更、数据不一致）`teamTotalInvestValue` 小于 `amount`，将发生静默下溢，导致 `teamTotalInvestValue` 变成一个极大的数。

**触发条件**:
- 用户在绑定推荐人之前质押，然后绑定推荐人（`_syncExistingInvestmentToReferralChain` 增加了值），之后 unstake 时 `_updateTeamInvestmentValues` 减少的是原始金额，但推荐链可能已经变化。

**风险**: 中 — 特定条件下可能导致团队 KPI 数据异常。

### M-04: `_calculateStakeReward` 中 `uint40` 时间戳截断

**位置**: `StakingBase.sol:1313-1314`

```solidity
unchecked {
    stakingDuration = uint40(block.timestamp) - stakeStartTime;
}
```

`block.timestamp` 被截断为 `uint40`。`uint40` 最大值为 `1099511627775`（约 34,865 年），在可预见的未来不会溢出。但 `unchecked` 中的减法如果 `block.timestamp` 的低 40 位小于 `stakeStartTime`（理论上不可能但值得注意），会产生错误结果。

**风险**: 低 — 实际风险极小，但代码不够防御性。

### M-05: `_distributeHybridRewards` 只处理 7 个 tier 但系统有 9 个 tier

**位置**: `StakingBase.sol:1230-1304`

```solidity
address[7] memory tierRecipients;   // 只有 7 个槽位
uint256[7] memory tierAmounts;      // 只有 7 个槽位
bool[8] memory tierAllocated;       // 8 个槽位

// ...
tierRecipients[currentTier - 1] = referralChain[i];  // currentTier 可以是 1-9
tierAmounts[currentTier - 1] = memberReward;          // 如果 currentTier > 7，数组越界！
```

系统定义了 9 个 tier（V1-V9），但 `tierRecipients` 和 `tierAmounts` 数组只有 7 个元素。当 `currentTier` 为 8 或 9 时，`tierRecipients[currentTier - 1]` 会访问索引 7 或 8，导致数组越界 revert。

这意味着如果推荐链中有 V8 或 V9 级别的用户，整个 `unstake` 和 `withdrawInterest` 交易都会失败。

**风险**: 中危 — 高等级用户的存在会阻止下线用户提款。但由于 V8 需要 1500万 ether 团队 KPI，V9 需要 3000万 ether，在早期阶段不太可能触发。一旦协议规模增长到这个级别，将成为严重问题。

### M-06: `withdrawInterest` 中 `AE.recycle` 的 `aeTokensUsed` 不包含赎回费的 AE

**位置**: `StakingBase.sol:385`

```solidity
// withdrawInterest:
(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(availableInterest);
// ... 赎回费又调用了一次 _swapAEForReward ...
(, uint256 redemptionFeeAEUsed) = _swapAEForReward(expectedRedemptionFeeUSDX);
// ...
AE.recycle(aeTokensUsed);  // 只 recycle 了第一次 swap 的 AE，没有包含赎回费的 AE
```

`unstake` 中也有同样的问题（第305行）。赎回费 swap 消耗的 AE 没有被 recycle，导致这部分 AE 的处理不一致。

**风险**: 中 — AE 代币的 recycle 逻辑不完整。

### M-07: 赎回费实际未转给 `feeRecipient`

**位置**: `StakingBase.sol:271-286` 和 `StakingBase.sol:364-379`

```solidity
if (expectedRedemptionFeeUSDX > 0 && feeRecipient != address(0)) {
    (, uint256 redemptionFeeAEUsed) = _swapAEForReward(expectedRedemptionFeeUSDX);
    emit RedemptionFeeCollected(...);
}
```

`_swapAEForReward` 将 AE 换成 USDX，但换出的 USDX 留在了合约中，**没有实际转给 `feeRecipient`**。只是发出了 `RedemptionFeeCollected` 事件，但资金并未移动。

这些 USDX 留在合约中，可能被 `sync()` 函数送入 LP 池，或被 `emergencyWithdrawUSDX` 提取。

**风险**: 中 — 赎回费收集机制实际上不工作，费用留在合约中而非转给指定接收者。

---

## 四、低危 (Low) 漏洞

### L-01: `IERC20.transfer` 返回值未检查

**位置**: 多处，包括：
- `StakingBase.sol:302` — `IERC20(USDX).transfer(msg.sender, userPayout)`
- `StakingBase.sol:382` — `IERC20(USDX).transfer(user, userPayout)`
- `StakingBase.sol:1161` — `IERC20(USDX).transfer(educationFundAddress, fee)`
- `StakingBase.sol:1173` — `IERC20(USDX).transfer(rootAddress, fee)`
- `StakingBase.sol:1214` — `IERC20(USDX).transfer(rootAddress, marketingAmount)`
- `StakingBase.sol:1275` — `IERC20(USDX).transfer(referralChain[i], memberReward)`
- `StakingBase.sol:492` — `IERC20(USDX).transfer(pair, w_bal)`

所有 `IERC20.transfer` 调用都没有检查返回值。虽然大多数主流代币（如 USDT 在 BSC 上的包装版本）在失败时会 revert，但某些代币会返回 `false` 而不 revert。

建议使用 OpenZeppelin 的 `SafeERC20.safeTransfer`。

**风险**: 低 — 取决于 USDX 代币的具体实现。

### L-02: `t_supply` 数组无限增长

**位置**: `StakingBase.sol:1025-1028`

```solidity
IStaking.RecordTT memory tsy;
tsy.stakeTime = uint40(block.timestamp);
tsy.tamount = uint160(totalSupply);
t_supply.push(tsy);
```

每次 `stake` 都会向 `t_supply` 数组追加记录，永远不会清理。随着时间推移：
1. `getRecentNetworkInflow()` 的 gas 消耗会增加（虽然它从后向前遍历，通常很快退出）
2. 存储成本持续增加

**风险**: 低 — 长期运行可能增加 gas 成本。

### L-03: `userStakeRecord` 数组无限增长

**位置**: `StakingBase.sol:1038`

用户的质押记录只会增加不会删除。即使 unstake 后，记录仍保留（`status` 设为 true）。`currentStakeValue` 需要遍历所有记录，gas 消耗随质押次数线性增长。

如果用户频繁质押，最终可能导致 `currentStakeValue`、`balanceOf` 等函数 gas 超限。

**风险**: 低 — 需要大量质押操作才会触发。

### L-04: 构造函数中对 USDX 的无限授权

**位置**: `StakingBase.sol:222`

```solidity
IERC20(_usdx).approve(_router, type(uint256).max);
```

对 Router 的无限授权。如果 Router 合约存在漏洞，攻击者可能通过 Router 提取合约中的所有 USDX。

**风险**: 低 — Router 通常是经过审计的 Uniswap V2 合约，但无限授权仍是风险点。

### L-05: `_children` 数组可被无限扩展

**位置**: `StakingBase.sol:419`, `StakingBase.sol:444`, `StakingBase.sol:471`

```solidity
_children[_referrer].push(user);
```

每次绑定推荐关系都会向推荐人的 `_children` 数组追加。虽然当前代码中 `_children` 只在 `getReferralCount` 中使用（返回长度），但如果未来有遍历 `_children` 的逻辑，可能导致 gas 问题。

**风险**: 低 — 当前无直接影响。

---

## 五、信息级 (Info) 发现

### I-01: `onlyEOA` 修饰符使用 `tx.origin`

使用 `tx.origin` 是 Solidity 社区普遍不推荐的做法。虽然在此场景下用于阻止合约调用有一定合理性，但会阻止通过多签钱包、智能合约钱包（如 Safe）等方式操作。

### I-02: 事件中的 `tierRecipients` 和 `tierAmounts` 固定为 7 个元素

`TeamRewardDistributionCompleted` 事件中使用 `address[7]` 和 `uint256[7]`，但系统有 9 个 tier。高 tier 的奖励分配信息无法通过事件追踪。

### I-03: `_interset` 拼写错误

多处使用 `_interset` 作为变量名，应为 `_interest`。不影响功能但影响代码可读性。

### I-04: `REWARD_WITHHOLD_RATE` 常量未使用

`StakingBase.sol:102` 定义了 `REWARD_WITHHOLD_RATE = 40`，但在整个合约中未被使用。

### I-05: `userIndex` mapping 用途不明

`StakingBase.sol:135` 定义了 `mapping(address => uint256) public userIndex`，在 `_burn` 中递增但从未被读取用于任何逻辑判断。

---

## 六、经济模型风险分析

### E-01: 复利率极高 — 庞氏结构风险

主网配置的日复利率：
| 期限 | 日利率 | 年化（复利） |
|------|--------|-------------|
| 7天  | 0.6%   | ~875%       |
| 30天 | 0.9%   | ~2,571%     |
| 90天 | 1.1%   | ~5,274%     |
| 180天| 1.5%   | ~22,310%    |
| 365天| 2.0%   | ~137,641%   |

这些利率远超任何可持续的 DeFi 收益来源。合约本身不产生收益，所有收益来自：
1. 新用户质押注入的流动性
2. AE 代币价格的维持

这是典型的庞氏结构：早期用户的收益依赖后续用户的资金注入。一旦新资金流入减缓，系统将无法兑付承诺的收益。

### E-02: 银行挤兑风险

当大量用户同时 unstake 时：
1. `_swapAEForReward` 需要将 AE 换成 USDX
2. 大量卖出 AE 会导致价格暴跌
3. 后续用户需要更多 AE 才能换到相同数量的 USDX
4. 合约 AE 储备可能不足
5. 最终用户无法 unstake

### E-03: 费用结构分析

每次 unstake 的费用：
- 5% 教育基金（从利息中扣除）
- 35% 团队奖励（从利息中扣除）
- 0.6% 赎回费（从用户应得中扣除，但实际实现有 bug）

总计约 40.6% 的利息被扣除。加上 swap 滑点，用户实际收到的远少于计算值。

---

## 七、重入攻击分析

### 重入风险评估

合约在多处进行外部调用：
1. `IERC20(USDX).transfer` — ERC20 转账
2. `ROUTER.swapTokensForExactTokens` — DEX swap
3. `ROUTER.addLiquidity` — 添加流动性
4. `AE.recycle` — AE 代币回收
5. `IERC20(USDX).transferFrom` — 从用户转入

**`unstake` 函数的调用顺序**:
1. `_burn` — 更新状态（status = true, 减少 balance）✓ 先更新状态
2. `_swapAEForReward` — 外部调用
3. `_distributeEducationFund` — 外部调用
4. `_distributeTeamReward` — 外部调用
5. `_updateTeamInvestmentValues` — 更新状态
6. `_swapAEForReward`（赎回费）— 外部调用
7. `IERC20(USDX).transfer` — 外部调用
8. `AE.recycle` — 外部调用

由于 `_burn` 在第一步就将 `status` 设为 `true`，重入攻击无法重复 unstake 同一笔质押。但 `_updateTeamInvestmentValues` 在步骤 5 才执行，如果在步骤 2-4 之间发生重入，`teamTotalInvestValue` 可能处于不一致状态。

**`withdrawInterest` 函数**:
1. 更新 `withdrawnInterest` ✓ 先更新状态
2. `_swapAEForReward` — 外部调用
3. 费用分配 — 外部调用
4. `IERC20(USDX).transfer` — 外部调用

`withdrawInterest` 遵循了 Checks-Effects-Interactions 模式，重入风险较低。

**结论**: 由于 `onlyEOA` 修饰符和状态先更新的模式，直接重入攻击风险较低。但跨函数重入（如在 `unstake` 的外部调用中触发 `withdrawInterest`）理论上可能存在，建议添加 `ReentrancyGuard`。

---

## 八、漏洞汇总表

| 编号 | 等级 | 标题 | 状态 |
|------|------|------|------|
| C-01 | 严重 | 赎回费未从 userPayout 扣除 | 待修复 |
| C-02 | 严重 | sync() 无权限控制可清空 USDX | 待修复 |
| C-03 | 中危 | withdrawInterest 费用基数不一致 | 待修复 |
| H-01 | 高危 | addLiquidity 零滑点保护 | 待修复 |
| H-02 | 高危 | LP 代币永久锁定无迁移路径 | 需评估 |
| H-03 | 高危 | emergencyWithdraw 中心化风险 | 需评估 |
| H-04 | 高危 | setRootAddress 可破坏推荐链 | 待修复 |
| H-05 | 高危 | unstake 可能因储备不足 revert | 需评估 |
| M-01 | 中危 | tx.origin 检查可被绕过 | 需评估 |
| M-02 | 中危 | unchecked 块包含外部调用 | 待修复 |
| M-03 | 中危 | teamTotalInvestValue 可能下溢 | 待修复 |
| M-04 | 中危 | uint40 时间戳截断 | 低优先级 |
| M-05 | 中危 | tierRecipients 数组越界（V8/V9） | 待修复 |
| M-06 | 中危 | recycle 未包含赎回费 AE | 待修复 |
| M-07 | 中危 | 赎回费未实际转给 feeRecipient | 待修复 |
| L-01 | 低危 | transfer 返回值未检查 | 建议修复 |
| L-02 | 低危 | t_supply 数组无限增长 | 建议优化 |
| L-03 | 低危 | userStakeRecord 无限增长 | 建议优化 |
| L-04 | 低危 | Router 无限授权 | 可接受 |
| L-05 | 低危 | _children 数组无限增长 | 建议优化 |

---

## 九、修复建议优先级

### 立即修复（部署前必须）

1. **C-01**: 赎回费应从 `userPayout` 中扣除，而非额外从 AE 储备支出
2. **C-02**: 给 `sync()` 添加 `onlyOwner` 修饰符
3. **M-05**: 将 `tierRecipients` 和 `tierAmounts` 扩展为 `[9]`
4. **M-07**: 赎回费 swap 后的 USDX 应实际转给 `feeRecipient`
5. **M-06**: `AE.recycle` 应包含赎回费消耗的 AE

### 强烈建议修复

6. **H-01**: `addLiquidity` 添加合理的最小输出参数
7. **M-03**: 移除 `_updateTeamInvestmentValues` 中的 `unchecked`，或添加下溢检查
8. **L-01**: 使用 `SafeERC20.safeTransfer` 替代 `IERC20.transfer`
9. **C-03**: 统一 `withdrawInterest` 和 `unstake` 的费用计算基数

### 架构层面建议

10. 添加 `ReentrancyGuard` 到所有状态修改函数
11. 考虑添加 Timelock 到 owner 权限函数
12. 考虑添加暂停机制（Pausable）
13. 为 `emergencyWithdraw` 添加多签或时间锁
