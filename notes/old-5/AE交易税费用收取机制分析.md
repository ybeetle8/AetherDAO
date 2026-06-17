# AE 交易税费用收取机制分析

## 核心问题

质押合约在白名单中，会不会导致所有地址都无法收费？

**结论：不会。** 白名单只免除质押合约自身参与的 swap，普通用户通过 DEX 直接买卖 AE 能正常收费。但当前测试环境中费用地址为 0 是因为 **两个原因叠加**：测试只做了质押操作（白名单免费）+ presale 没有正确关闭（普通买入被阻止）。

## 白名单机制详解

### 白名单成员

```solidity
// AEBase.sol:335-346
feeWhitelisted[owner()] = true;           // 部署者
feeWhitelisted[address(this)] = true;      // AE 合约自身
feeWhitelisted[address(staking)] = true;   // 质押合约
feeWhitelisted[marketingAddress] = true;   // 营销地址
feeWhitelisted[address(uniswapV2Router)] = true;  // Router
```

### 白名单判断逻辑

```solidity
// AEBase.sol:656-663
bool isWhitelisted = feeWhitelisted[from] || feeWhitelisted[to];
if (isWhitelisted) {
    super._update(from, to, value);  // 直接转账，跳过费用
    return;
}
```

只检查 `from` 和 `to`，**不检查 `msg.sender`**。

### 各场景分析

| 场景 | from | to | 白名单命中？ | 收费？ |
|------|------|-----|-------------|--------|
| 普通用户买入 AE | Pair | 用户 | ❌ 都不在 | ✅ 正常收费 |
| 普通用户卖出 AE | 用户 | Pair | ❌ 都不在 | ✅ 正常收费 |
| 质押合约买入 AE | Pair | Staking | ✅ Staking 在 | ❌ 免费 |
| 质押合约卖出 AE | Staking | Pair | ✅ Staking 在 | ❌ 免费 |
| 部署者买入 AE | Pair | Owner | ✅ Owner 在 | ❌ 免费 |
| 部署者卖出 AE | Owner | Pair | ✅ Owner 在 | ❌ 免费 |

**注意**：虽然 Router 在白名单中，但普通用户通过 Router 买卖时，`_update` 的 `from`/`to` 是 Pair 和用户，Router 只是 `msg.sender`，不会触发白名单跳过。

### 为什么质押合约必须在白名单中 — 设计意图分析

质押合约免交易税**不仅是经济考量，更是技术上的强制要求**。从代码中可以找到三层证据：

#### 证据一：解质押使用了不支持税的 swap 函数

```solidity
// StakingBase.sol:1327 — 解质押卖出 AE
ROUTER.swapTokensForExactTokens(...)    // ← 不支持 fee-on-transfer

// StakingBase.sol:1612 — 质押买入 AE
ROUTER.swapExactTokensForTokensSupportingFeeOnTransferTokens(...)  // ← 支持 fee-on-transfer
```

解质押用的 `swapTokensForExactTokens` 要求输出精确匹配。如果 AE 对 Staking 收了 3% 卖出税，Router 发送的 AE 到达 Pair 时会被扣税，实际到账不足，swap 会直接 **revert**。所以 **Staking 如果不在白名单中，解质押就无法完成**。

质押买入用的是支持税的版本，技术上可以承受扣税。但 `addLiquidity`（1633行）也不支持税，如果买入被收税导致 AE 数量减少，添加流动性时配比就会出错。

#### 证据二：质押合约已感知交易税，在滑点中补偿

```solidity
// StakingBase.sol:97-100
uint256 internal constant AE_BUY_BURN_FEE_BPS = 50;           // 0.5%
uint256 internal constant AE_BUY_LIQUIDITY_FEE_BPS = 250;     // 2.5%
uint256 internal constant AE_TOTAL_BUY_FEE_BPS = 300;         // 3%

// StakingBase.sol:1763-1765 — 计算最小输出时扣除 3% 买入税
uint256 expectedOutputAfterFees = (expectedOutput *
    (BASIS_POINTS_DENOMINATOR - AE_TOTAL_BUY_FEE_BPS)) /
    BASIS_POINTS_DENOMINATOR;
```

质押合约定义了 `AE_TOTAL_BUY_FEE_BPS = 300`（3%），在计算 `_calculateMinimumOutput` 时主动减去了这 3%。这说明开发者**清楚**白名单免税这个机制——因为 Staking 在白名单中实际不扣税，所以这里减去 3% 只是让 `minAmountOut` 更宽松（防止极端情况），实际收到的 AE 会比这个最小值多 3%。

> 注：这些常量（0.5% burn + 2.5% liquidity）和当前 AE 合约的买入税组成（2% node + 1% community）不一致，是历史遗留，但总额都是 3%。

#### 证据三：质押合约有独立的完整费用体系

质押合约自身已经对用户收取了充分的费用（`StakingBase.sol:292-370`）：

| 费用类型 | 费率 | 来源 | 接收者 |
|----------|------|------|--------|
| 教育基金 | 利息的 5% | `_distributeEducationFund` | educationFundAddress |
| 团队奖励 | 利息的 35% | `_distributeTeamReward` | 推荐链上级 |
| 赎回手续费 | 扣除教育+团队后剩余利息的 5% | `unstake` 第318行 | feeRecipient |

如果再叠加 AE 交易税（买入 3% + 卖出 3%），用户实际收益会被大幅压缩。设计上不应双重收费。

#### 总结

| 层面 | 原因 |
|------|------|
| **技术层** | 解质押的 `swapTokensForExactTokens` 和 `addLiquidity` 不支持税，收税会导致 revert |
| **经济层** | 质押合约已有独立费用体系（教育基金5% + 团队35% + 赎回5%），不应双重收费 |
| **设计层** | 质押是协议核心功能，应该无摩擦运行，交易税只针对二级市场交易 |

## 当前测试环境为什么收不到费

### 原因一：测试中没有普通用户的 DEX 交易

当前测试流程只包含质押/解质押操作。质押合约在白名单中，所有 swap 都免费。需要普通用户（非白名单地址）通过 PancakeSwap Router 直接买卖 AE 才能触发费用。

### 原因二：presale 模式可能没有关闭

```javascript
// deployAE.js:366
ae.setPresaleActive(false);  // ← 没有 await！
```

合约构造函数中默认 `presaleActive = true`，duration = 30 天（`AE.sol:36-37`）。部署脚本第 366 行尝试关闭 presale，但没有 `await`，交易可能没有被确认。

如果 presale 仍然是 active，普通用户的买入操作会被 revert：

```solidity
// AEBase.sol:736-741
if (presaleActive && block.timestamp < presaleStartTime + presaleDuration) {
    revert NotAllowedBuy();
}
```

这意味着即使有普通用户尝试买入，也会失败。

## 如何正确使用费用收取功能

### 第一步：修复 presale 关闭

将 `deployAE.js:366` 加上 `await`：

```javascript
// 修复前
ae.setPresaleActive(false);

// 修复后
await ae.setPresaleActive(false);
console.log("✓ 已关闭 presale 模式");
```

### 第二步：用普通用户执行 DEX 交易

费用只在普通用户通过 DEX 买卖 AE 时收取。可以参考 `testTokenTrading.js` 的测试方式：

```javascript
// 创建一个非白名单的测试钱包
const testWallet = ethers.Wallet.createRandom().connect(ethers.provider);

// 通过 Router 买入 AE（会触发 _handleBuy → 收取 3% 买入税）
await router.connect(testWallet).swapExactTokensForTokensSupportingFeeOnTransferTokens(
    buyAmount, 0, [USDX, AE], testWallet.address, deadline
);

// 通过 Router 卖出 AE（会触发 _handleSell → 收取 3% 卖出税）
await router.connect(testWallet).swapExactTokensForTokensSupportingFeeOnTransferTokens(
    sellAmount, 0, [AE, USDX], testWallet.address, deadline
);
```

### 费用分配汇总

**买入税（3%）：**
- 2% → `buyTaxNodeRewardAddress`（AE 代币）
- 1% → `buyTaxCommunityRewardAddress`（AE 代币）

**卖出税（3%）：**
- 1.5% → `marketingFundAddress`（AE 代币）
- 1.5% → 销毁到 DEAD_ADDRESS

**盈利税（25% 利润）：** 仅在卖出价值 > 用户历史总投资时触发
- 60% → 添加流动性并销毁 LP
- 40% → `weeklyTop15RewardAddress`（USDC）

### 验证费用收取

修复 presale 并执行普通用户交易后，运行 `checkAddressUsdc.js` 即可看到：
- `buyTaxNodeRewardAddress` 有 AE 余额
- `buyTaxCommunityRewardAddress` 有 AE 余额
- `marketingFundAddress` 有 AE 余额（需要有卖出操作）
