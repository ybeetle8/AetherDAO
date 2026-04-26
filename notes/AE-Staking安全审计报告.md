# AE-Staking 合约安全审计报告

## 1. 审计概览

| 项目 | 详情 |
|------|------|
| **合约名称** | AE-Staking (StakingBase + Staking) |
| **Solidity 版本** | ^0.8.20 |
| **审计范围** | `StakingBase.sol` (1672行), `Staking.sol` (116行), `IStaking.sol`, `IAE.sol` |
| **依赖库** | OpenZeppelin (Ownable, IERC20), PRB-Math (UD60x18), Uniswap V2 |
| **部署目标** | BSC 主网 |

---

## 2. 合约架构概览

```
Staking (mainnet/Staking.sol)
    └── extends StakingBase (abstract/StakingBase.sol)
            ├── implements IStaking
            ├── extends Ownable (OpenZeppelin)
            └── depends on IAE, IUniswapV2Router02, IUniswapV2Pair
```

**核心功能模块:**
- 质押/解质押 (stake/unstake)
- 提前提取利息 (withdrawInterest)
- 推荐关系绑定 (referral system, 30层深度)
- 团队奖励分配 (9级差级奖励)
- 复利计算 (PRB-Math UD60x18)
- 流动性管理 (Uniswap V2 swap + addLiquidity)
- sAE 代币 (不可转让的质押凭证)

---

## 3. 发现问题汇总

| 严重等级 | 数量 |
|---------|------|
| **严重 (Critical)** | 2 |
| **高危 (High)** | 4 |
| **中危 (Medium)** | 5 |
| **低危 (Low)** | 6 |
| **信息/建议 (Info)** | 4 |

---

## 4. 严重 (Critical) 问题

### C-01: unstake 中 redemptionFee 从合约 AE 余额扣除但 USDX 未从 userPayout 扣除

**位置:** `StakingBase.sol:265-286`

**描述:**
在 `unstake()` 中,赎回费的逻辑存在严重缺陷。代码计算了 `userPayout` 然后基于 `userPayout` 计算了赎回费,通过 `_swapAEForReward()` 将 AE 换成 USDX 来收取费用,但赎回费对应的 USDX **从未从 `userPayout` 中扣除**,也没有实际转给 `feeRecipient`。

```solidity
uint256 userPayout = usdxReceived - educationFund - teamFee;

// 计算赎回费
uint256 expectedRedemptionFeeUSDX = (userPayout * REDEMPTION_FEE_RATE) /
    BASIS_POINTS_DENOMINATOR;

if (expectedRedemptionFeeUSDX > 0 && feeRecipient != address(0)) {
    // 只是卖了 AE 换 USDX, 但 USDX 留在合约里, 没转给 feeRecipient
    (, uint256 redemptionFeeAEUsed) = _swapAEForReward(
        expectedRedemptionFeeUSDX
    );
}

// userPayout 并未减去 redemptionFee, 用户拿到了全额
IERC20(USDX).transfer(msg.sender, userPayout);
```

**影响:**
1. 赎回费永远不会被实际转给 `feeRecipient`,USDX 滞留在合约中
2. 每次 unstake 都白白消耗合约中的 AE 余额(swap AE → USDX, USDX 留合约中)
3. 长期运行会消耗大量合约 AE 余额

**建议:**
- `userPayout` 应减去 `expectedRedemptionFeeUSDX`
- 将赎回费 USDX 实际 `transfer` 到 `feeRecipient`

---

### C-02: withdrawInterest 中相同的赎回费问题

**位置:** `StakingBase.sol:360-379`

**描述:**
`withdrawInterest()` 中存在与 C-01 完全相同的问题。赎回费被计算、AE 被 swap 为 USDX,但 USDX 既没有从 `userPayout` 中扣除,也没有转给 `feeRecipient`。

**影响:** 同 C-01。

---

## 5. 高危 (High) 问题

### H-01: addLiquidity 的 amountMin 参数为 0, 存在三明治攻击风险

**位置:** `StakingBase.sol:1368-1377`

**描述:**
```solidity
ROUTER.addLiquidity(
    address(USDX),
    address(AE),
    remainingUsdx,
    aeTokensReceived,
    0,  // amountAMin = 0 !!
    0,  // amountBMin = 0 !!
    address(0),  // LP 发送到零地址 (永久销毁)
    block.timestamp
);
```

`addLiquidity` 的最小接收量设为 0,攻击者可以通过三明治攻击 (sandwich attack) 在交易前后操纵价格,导致用户添加流动性时遭受严重滑点损失。

**影响:** 每次 `stake()` 操作都暴露在三明治攻击风险下,用户资金被 MEV 机器人提取价值。

**建议:** 基于 swap 后得到的 `aeTokensReceived` 和 `remainingUsdx` 计算合理的最小值(如 95%-98%）。

---

### H-02: _swapAEForReward 中 maxInput 限制可能导致 unstake 失败

**位置:** `StakingBase.sol:1100-1145`

**描述:**
`_calculateMaxAEInput` 将 `maxInput` 强制限制为 `availableXF / 2`（即合约 AE 余额的一半）。当合约 AE 余额不足时,`swapTokensForExactTokens` 会因输入不足而 revert,导致用户无法 unstake。

```solidity
uint256 maxAllowedInput = availableXF / 2;
if (maxInput > maxAllowedInput) {
    maxInput = maxAllowedInput;  // 强制最多使用一半 AE 余额
}
```

**影响:** 如果合约 AE 余额相对于需要 swap 出的 USDX 数量不足,所有 unstake 操作都会失败,用户资金被锁定。

**建议:** 增加紧急 unstake 路径,或放宽在特定条件下的 maxInput 限制。

---

### H-03: _swapAndAddLiquidity LP Token 发送到 address(0)

**位置:** `StakingBase.sol:1375`

**描述:**
```solidity
ROUTER.addLiquidity(
    ...
    address(0),  // LP Token 接收地址
    block.timestamp
);
```

LP Token 被发送到 `address(0)`,即永久销毁。虽然这可能是设计意图(永久锁定流动性),但如果攻击者在 AE 代币合约中有操纵价格的能力,可以通过 `stake` 操作让合约以不利价格添加流动性并永久锁定。

**影响:** 流动性永久不可恢复,如果价格被操纵,会导致资金损失。

---

### H-04: 团队奖励分配中 unchecked 可能导致下溢

**位置:** `StakingBase.sol:1150-1155, 1160-1163`

**描述:**
```solidity
// _distributeEducationFund
unchecked {
    fee = (_interset * REFERRAL_REWARD_RATE) / PERCENTAGE_BASE;
}

// _distributeTeamReward
unchecked {
    fee = (_interset * MAX_TEAM_REWARD_RATE) / PERCENTAGE_BASE;
}
```

虽然这里的 `unchecked` 本身不会溢出,但在 `unstake()` 中:
```solidity
uint256 userPayout = usdxReceived - educationFund - teamFee;
```
如果 `usdxReceived` 由于滑点小于 `educationFund + teamFee`,此处会直接 revert (Solidity 0.8+ 自动检查)。但问题在于 `interestEarned` 被计算为 `usdxReceived - principalAmount`,当实际 swap 得到的 USDX 少于本金时（市场波动或流动性不足),各种费用计算的基数 `interestEarned` 为 0,但 `educationFund` 和 `teamFee` 仍然基于 0 计算,可能导致用户无法提取。

---

## 6. 中危 (Medium) 问题

### M-01: tx.origin 检查可被 EOA 直接调用绕过

**位置:** `StakingBase.sol:194-198`

**描述:**
```solidity
modifier onlyEOA() {
    if (shouldCheckEOA() && tx.origin != msg.sender)
        revert OnlyEOAAllowed();
    _;
}
```

`tx.origin == msg.sender` 只能阻止合约直接调用。在账户抽象(AA)钱包日益普及的背景下,这个检查会阻止合法的智能合约钱包用户(如 Safe 多签钱包)使用系统。

**建议:** 考虑使用白名单机制替代 `tx.origin` 检查,或增加可信合约列表。

---

### M-02: setRootAddress 未处理已绑定用户的推荐链

**位置:** `StakingBase.sol:483-487`

**描述:**
```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;
}
```

切换 `rootAddress` 时,旧 `rootAddress` 的 `_hasLocked` 被设为 false,但已经绑定了旧 root 作为推荐人的用户的推荐关系没有更新。旧 root 地址的 `teamTotalInvestValue` 也没有迁移到新 root。

**影响:** 推荐链断裂,团队 KPI 数据不一致。

---

### M-03: t_supply 数组无界增长

**位置:** `StakingBase.sol:131, 1018-1021`

**描述:**
每次 `stake` 都会往 `t_supply` 数组追加记录:
```solidity
IStaking.RecordTT memory tsy;
tsy.stakeTime = uint40(block.timestamp);
tsy.tamount = uint160(totalSupply);
t_supply.push(tsy);
```

`getRecentNetworkInflow()` 会从数组末尾遍历来查找最近的记录。`t_supply` 永远只增不减,长期运行会消耗越来越多的存储空间。

**建议:** 考虑使用环形缓冲区或定期清理过期记录。

---

### M-04: userStakeRecord 数组无界增长

**位置:** `StakingBase.sol:134`

**描述:**
用户的质押记录数组只增不减,即使质押已提取(status=true)也保留在数组中。`currentStakeValue()` 会遍历所有记录:
```solidity
for (uint256 i = userStakes.length - 1; i >= 0; ) {
    IStaking.Record storage stakeRecord = userStakes[i];
    if (!stakeRecord.status) {
        currentValue += _calculateStakeReward(stakeRecord);
    }
    ...
}
```

对于频繁质押/解质押的用户,Gas 成本会持续增长。

---

### M-05: withdrawInterest 在 unstake 前的利息计算可能被利用

**位置:** `StakingBase.sol:318-401`

**描述:**
用户可以在质押到期前多次调用 `withdrawInterest` 提取利息,然后在质押到期后调用 `unstake` 提取全部。但 `unstake` 中的 `_calculateStakeReward` 计算的是总价值(本金+利息),而 `_burn` 返回的 `reward` 也是全部计算值。虽然 `_burn` 只销毁了 `amount`(本金),但 `_swapAEForReward(calculatedReward)` swap 出的 USDX 包含了全部利息对应的价值。

```solidity
// unstake 中
(uint256 calculatedReward, uint256 principalAmount) = _burn(stakeIndex);
(uint256 usdxReceived, uint256 aeTokensUsed) = _swapAEForReward(calculatedReward);
```

这里 `calculatedReward` 是 `_calculateStakeReward(stakeRecord)` 的返回值,包含已经通过 `withdrawInterest` 提走的利息部分。而 `withdrawnInterest` 映射在 `unstake` 中完全没有被检查或扣除。

**影响:** 用户可能通过先 `withdrawInterest` 再 `unstake` 的方式双重获取利息。

---

## 7. 低危 (Low) 问题

### L-01: 构造函数中 feeRecipient 缺少零地址检查

**位置:** `StakingBase.sol:219`

**描述:**
`_feeRecipient` 和 `_rootAddress` 没有零地址检查,但 `_usdx`、`_router`、`_educationFundAddress` 有。

---

### L-02: getStakePeriod 函数缺少 else 分支返回值

**位置:** `StakingBase.sol:559-569`

**描述:**
```solidity
function getStakePeriod(uint8 stakeIndex) public pure returns (uint256 period) {
    require(stakeIndex <= MAX_STAKE_INDEX, "Invalid stake index");
    if (stakeIndex == 0) return getStakePeriod7D();
    if (stakeIndex == 1) return getStakePeriod30D();
    // ... 虽然 require 保证不会到达,但编译器可能给出 warning
}
```

虽然 `require` 保证了不会到达函数结尾,但代码风格上建议使用 `else if` 或添加最终 `revert`。

---

### L-03: emergencyWithdraw 函数没有事件日志

**位置:** `StakingBase.sol:1570-1582`

**描述:**
`emergencyWithdrawAE` 和 `emergencyWithdrawUSDX` 是关键的管理员操作,但没有发出事件。

**建议:** 添加事件以便链上追踪。

---

### L-04: batchAdminBindReferral 无长度上限

**位置:** `StakingBase.sol:455-481`

**描述:**
批量绑定推荐关系没有数组长度限制,可能因 Gas 耗尽导致交易失败。

---

### L-05: USDX approve 在构造函数中使用 type(uint256).max

**位置:** `StakingBase.sol:222`

**描述:**
```solidity
IERC20(_usdx).approve(_router, type(uint256).max);
```

虽然常见做法,但对 Router 的无限授权意味着如果 Router 被攻破,合约所有 USDX 都会受威胁。由于 Router 地址是 immutable,风险可控。

---

### L-06: _distributeHybridRewards 中 tierAllocated 数组大小为 8 但 tier 范围是 1-9

**位置:** `StakingBase.sol:1244`

**描述:**
```solidity
bool[8] memory tierAllocated;
```

tier 范围为 1-9,但数组只有 8 个元素(索引 0-7)。当 `currentTier = 8` 时,`tierAllocated[8]` 会越界。虽然 Solidity 会自动检查数组越界,但这会导致 tier 8 和 tier 9 的用户无法获得奖励,交易直接 revert。

**修正:** 应改为 `bool[10] memory tierAllocated;`

> **注:** 此问题实际影响等级应为 **高危**,因为它会导致高等级用户的 unstake 交易失败。

---

## 8. 信息/建议 (Informational)

### I-01: 缺少 Reentrancy Guard

虽然合约使用了 Checks-Effects-Interactions 模式(如 `withdrawInterest` 中先更新 `withdrawnInterest` 再进行外部调用),但由于多处与外部合约交互(USDX transfer, Router swap, AE recycle),建议使用 OpenZeppelin 的 `ReentrancyGuard`。

### I-02: 魔数使用

代码中多处使用硬编码数字如 `150/100`(50% 滑点), `1/2`(流动性分割), `1/10`, `1/4` 等,建议定义为命名常量。

### I-03: sAE 代币不符合完整 ERC20 标准

`transfer`, `approve`, `transferFrom` 都直接 revert。虽然这是设计意图,但某些依赖 ERC20 接口的协议/工具可能会出问题。

### I-04: REWARD_WITHHOLD_RATE 常量已定义但未使用

**位置:** `StakingBase.sol:102`

```solidity
uint256 internal constant REWARD_WITHHOLD_RATE = 40;
```

此常量在整个合约中未被引用。

---

## 9. 安全审计检查清单

| 检查项 | 状态 | 备注 |
|-------|------|------|
| 重入攻击 | ⚠️ 需关注 | 遵循 CEI 但缺少 ReentrancyGuard |
| 整数溢出/下溢 | ✅ | Solidity 0.8+ 自动检查 |
| 访问控制 | ✅ | 使用 OpenZeppelin Ownable |
| 前端运行 / MEV | ❌ | addLiquidity 无滑点保护 |
| 三明治攻击 | ❌ | addLiquidity amountMin=0 |
| DoS 攻击 | ⚠️ | 数组无界增长可能导致 Gas 耗尽 |
| 闪电贷攻击 | ✅ | onlyEOA 修饰符提供部分保护 |
| 价格操纵 | ⚠️ | 依赖单一 DEX 价格,无预言机 |
| 权限过大 | ⚠️ | Owner 可紧急提取所有资金 |
| 资金锁定风险 | ❌ | AE 余额不足时 unstake 会失败 |
| 时间戳依赖 | ✅ | 可接受范围内的使用 |
| tx.origin | ⚠️ | 阻止智能钱包用户 |

---

## 10. 建议的测试方案

### 10.1 单元测试

1. **质押流程测试**
   - 正常质押(5个档位各测试一次)
   - 最小金额边界测试 (100 ether)
   - 最大金额边界测试 (1000 ether / 单用户 10000 ether 上限)
   - 7天质押只能使用一次测试
   - 未绑定推荐关系时质押应失败

2. **解质押流程测试**
   - 到期正常解质押
   - 未到期解质押应失败
   - 重复解质押同一笔应失败
   - 验证费用分配 (5% 教育基金 + 35% 团队 + 0.6% 赎回费)
   - 验证 userPayout 计算正确性

3. **提前提息测试**
   - 正常提取利息
   - 多次提取利息
   - 提息后再 unstake 的双重获取问题验证
   - 无利息可提时应失败

4. **推荐系统测试**
   - 绑定推荐关系
   - 防止自我推荐
   - 防止重复绑定
   - 30层深度遍历
   - 团队 KPI 更新正确性
   - setRootAddress 后推荐链完整性

5. **团队奖励分配测试**
   - 9级差级奖励正确性
   - 无推荐人时奖励归 root
   - tierAllocated 数组越界测试 (tier 8, 9)
   - 混合层级分配

### 10.2 集成测试

1. **Uniswap 交互测试**
   - swap 滑点保护有效性
   - addLiquidity 三明治攻击模拟
   - 池子流动性不足时的行为
   - AE 余额不足时 unstake 的失败处理

2. **复利计算准确性测试**
   - 各档位利率在不同时间段的计算结果
   - PRB-Math 精度验证
   - 时间单位(天)换算正确性

3. **边界条件 / 压力测试**
   - 大量用户同时 stake 的网络流入限制
   - 频繁操作用户的 Gas 消耗趋势
   - t_supply 数组增长对 getRecentNetworkInflow 的 Gas 影响

### 10.3 安全测试(攻击模拟)

1. **三明治攻击模拟:** 在 stake 交易前后插入大额 swap, 验证损失程度
2. **重入攻击模拟:** 构造恶意 ERC20 token callback 尝试重入
3. **利息双重获取:** withdrawInterest + unstake 组合攻击验证
4. **闪电贷攻击:** 尝试通过闪电贷操纵池子价格后 unstake

---

## 11. 优先修复建议

| 优先级 | 编号 | 描述 |
|-------|------|------|
| **P0 (立即)** | C-01, C-02 | 赎回费未实际收取且消耗合约 AE |
| **P0 (立即)** | L-06 | tierAllocated 数组越界导致高等级用户交易失败 |
| **P0 (立即)** | M-05 | withdrawInterest + unstake 双重利息获取 |
| **P1 (尽快)** | H-01 | addLiquidity 滑点保护 |
| **P1 (尽快)** | H-02 | unstake 可能因 AE 余额不足而失败 |
| **P2 (计划)** | M-01 | tx.origin 兼容性 |
| **P2 (计划)** | M-02 | setRootAddress 推荐链处理 |
| **P2 (计划)** | M-03, M-04 | 数组无界增长 |
