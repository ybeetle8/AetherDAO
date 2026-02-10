# OLA 合约系统关系分析

## 概述

OLA 系统由两个独立的合约项目组成，通过接口相互调用，形成完整的 DeFi 质押生态系统。

```
othercode/
├── OLA/              # OLA 代币合约（ERC20 + 交易税）
└── OLA-Staking/      # OLA 质押合约（质押 + 推荐系统）
```

## 一、合约架构对比

### 1.1 OLA 代币合约 (othercode/OLA)

**核心文件**:
- `src/mainnet/OLA.sol` - 主网实现
- `src/abstract/OLABase.sol` - 核心业务逻辑（1473 行）
- `src/interfaces/IStaking.sol` - 质押合约接口

**主要功能**:
- ERC20 代币（总量 10,000,000 OLA）
- 买入税：1% 销毁 + 2% 流动性
- 卖出税：1.5% 营销 + 1.5% LP 累积
- 利润税：25%（有利润时）
- 预售期保护（30 天）
- 延迟购买期（30 天）
- 黑白名单机制

### 1.2 OLA 质押合约 (othercode/OLA-Staking)

**核心文件**:
- `src/mainnet/Staking.sol` - 主网实现
- `src/abstract/StakingBase.sol` - 核心业务逻辑
- `src/interfaces/IOLA.sol` - OLA 代币接口

**主要功能**:
- USDT 质押（50% 兑换 OLA + 50% USDT 添加流动性）
- 复利计算（按天复利）
- 推荐系统（Friend 5% + Team 最高 35%）
- 团队层级系统（V1-V7）
- 质押凭证代币（sOLA）

## 二、合约间的相互依赖

### 2.1 OLA 合约依赖 Staking 合约

**依赖接口**: `IStaking`

**调用场景**:

1. **获取推荐人信息**（卖出时分配利润税）
   ```solidity
   // OLABase.sol:1277-1279, 1315-1319
   function _getUserReferrer(address user) private view returns (address) {
       return staking.getReferral(user);
   }
   ```

2. **检查传教士资格**（利润税分配）
   ```solidity
   // OLABase.sol:1322-1328
   function _isReferrerEligible(address referrer) private view returns (bool) {
       return staking.isPreacher(referrer);
   }
   ```

3. **触发费用处理**（质押合约可调用）
   ```solidity
   // OLABase.sol:1134-1142
   function triggerFundRelayDistribution() external {
       require(msg.sender == address(staking) ||
               msg.sender == address(liquidityStaking), "...");
   }
   ```

### 2.2 Staking 合约依赖 OLA 合约

**依赖接口**: `IOLA`

**调用场景**:

1. **Recycle 机制**（从流动性池回收 OLA 代币）
   ```solidity
   // StakingBase.sol 中调用
   OLA.recycle(amount);
   ```
   - 从 Pair 池回收最多 1/3 的 OLA 代币
   - 用于质押奖励分发

2. **触发费用分配**
   ```solidity
   OLA.triggerFundRelayDistribution();
   OLA.triggerFeeProcessing();
   ```

3. **查询预售状态**
   ```solidity
   OLA.getPresaleStatus();
   ```

## 三、用户参与流程

### 3.1 质押流程（Stake）

```
用户 USDT
    ↓
[Staking.stake()]
    ↓
1. 验证推荐人绑定
2. 转入 USDT 到质押合约
    ↓
[_swapAndAddLiquidity()]
    ↓
3. 50% USDT → 兑换 OLA（通过 PancakeSwap）
4. 50% USDT + OLA → 添加流动性
5. LP 代币 → 销毁到 address(0)
    ↓
6. 铸造 sOLA 凭证代币
7. 更新团队投资值（向上传播）
```

**关键点**:
- LP 代币永久销毁，流动性不可取回
- 池子深度只增不减
- 必须先绑定推荐人（`lockReferral()`）

### 3.2 解除质押流程（Unstake）

```
用户发起解除质押
    ↓
[Staking.unstake()]
    ↓
1. 检查到期时间（必须 >= originalEndTime）
2. 计算复利收益
    ↓
[_distributeRewards()]
    ↓
3. 从 OLA 合约 recycle 代币
    ↓
[OLA.recycle()]
    ↓
4. 从 Pair 池回收 OLA（最多 1/3）
5. 调用 pair.sync() 同步储备
    ↓
6. 兑换 OLA → USDT
7. 分配奖励：
   - Friend: 5%
   - Team: 最高 35%（差额分配）
   - 赎回费: 1%
   - 用户: 剩余部分
    ↓
8. 销毁 sOLA 凭证
9. 更新团队投资值（向下传播）
```

### 3.3 OLA 代币交易流程

#### 买入 OLA

```
用户 USDT → PancakeSwap
    ↓
[OLA._handleBuy()]
    ↓
1. 检查预售期（30 天内禁止买入）
2. 检查延迟购买期（30 天）
3. 检查黑名单
    ↓
4. 扣除买入税：
   - 1% 销毁 → DEAD_ADDRESS
   - 2% 流动性 → LiquidityStaking
    ↓
5. 用户收到 97% OLA
6. 更新用户投资成本（用于利润税计算）
```

#### 卖出 OLA

```
用户 OLA → PancakeSwap
    ↓
[OLA._handleSell()]
    ↓
1. 检查冷却时间（10 秒）
2. 检查黑名单
    ↓
3. 扣除卖出税：
   - 1.5% 营销费
   - 1.5% LP 累积费
    ↓
4. 计算利润税（如果有利润）：
   - 利润 = 卖出价值 - 历史投资成本
   - 利润税 = 利润 × 25%
   - 分配：40% LP质押 + 60% 节点分红
    ↓
5. 用户收到 USDT（扣除所有费用）
6. 更新用户投资成本
```

## 四、关键机制详解

### 4.1 Recycle 机制

**目的**: 从流动性池回收 OLA 代币到质押合约用于奖励分发

**实现** (OLABase.sol:435-448):
```solidity
function recycle(uint256 amount) external {
    require(msg.sender == address(staking), "Only staking contract");

    uint256 pairBalance = balanceOf(address(uniswapV2Pair));
    uint256 maxRecyclable = pairBalance / 3;  // 最多 1/3
    uint256 recycleAmount = amount >= maxRecyclable ? maxRecyclable : amount;

    if (recycleAmount > 0) {
        _update(address(uniswapV2Pair), address(staking), recycleAmount);
        uniswapV2Pair.sync();  // 同步储备量
    }
}
```

**安全限制**:
- 只能由质押合约调用
- 每次最多回收池子代币的 1/3
- 必须调用 `sync()` 防止价格异常

### 4.2 利润税机制

**触发条件**: 卖出 OLA 时，如果 `卖出价值 > 历史投资成本`

**计算逻辑** (OLABase.sol:791-801):
```solidity
if (userCurrentInvestment > 0 && estimatedUSDTFromSale > userCurrentInvestment) {
    profitAmount = estimatedUSDTFromSale - userCurrentInvestment;
    profitTaxUSDT = (profitAmount * PROFIT_TAX_RATE) / BASIS_POINTS;  // 25%

    profitTaxInOLA = (profitTaxUSDT * netAmountAfterTradingFees) / estimatedUSDTFromSale;
}
```

**分配方式** (OLABase.sol:824-851):
```solidity
// 兑换 OLA → USDT
uint256 usdtAmountFromProfitTax = _swapTokensForUSDT(profitTaxInOLA);

// 分配比例：40% LP质押 + 60% 节点分红
uint256 lsShare = (usdtAmountFromProfitTax * 10) / 25;  // 40%
uint256 nodeShare = usdtAmountFromProfitTax - lsShare;  // 60%

// 存入 LiquidityStaking
liquidityStaking.depositRewards(lsShare);

// 发送到节点分红地址
IERC20(USDT).transfer(nodeDividendAddress, nodeShare);
```

### 4.3 团队奖励差额分配

**层级系统** (Staking 主网):

| 层级 | 团队 KPI 门槛 | 奖励比例 | 差额 |
|------|--------------|---------|------|
| V1 | 10,000 OLA | 5% | 5% |
| V2 | 50,000 OLA | 10% | 5% |
| V3 | 200,000 OLA | 15% | 5% |
| V4 | 500,000 OLA | 20% | 5% |
| V5 | 1,000,000 OLA | 25% | 5% |
| V6 | 2,500,000 OLA | 30% | 5% |
| V7 | 5,000,000 OLA | 35% | 5% |

**差额分配逻辑**:
```
实际奖励 = 当前层级奖励% - 已累计分配%
```

**示例**:
```
用户解除质押，利息 100 USDT
推荐链: 用户 → A(V3) → B(V1) → C(V5) → rootAddress

分配过程（从下往上）:
1. A (V3, 15%): 分配 15% = 15 USDT
2. B (V1, 5%):  已分配 15%，B 只有 5%，跳过
3. C (V5, 25%): 分配 25% - 15% = 10% = 10 USDT
4. rootAddress: 分配 35% - 25% = 10% = 10 USDT

总计: 15 + 10 + 10 = 35 USDT (35%)
```

### 4.4 投资成本追踪

**买入时** (OLABase.sol:995-1042):
```solidity
uint256 estimatedUSDTCost = _estimateBuyUSDTCost(netAmount);
userInvestment[to] = previousInvestment + estimatedUSDTCost;
```

**卖出时** (OLABase.sol:1044-1061):
```solidity
userInvestment[user] = previousInvestment <= actualUSDTReceived
    ? 0
    : previousInvestment - actualUSDTReceived;
```

**作用**: 用于计算是否有利润，决定是否收取利润税

## 五、费用结构对比

### 5.1 OLA 代币交易费用

| 操作 | 费用类型 | 费率 | 接收方 |
|------|---------|------|--------|
| 买入 | 销毁费 | 1% | DEAD_ADDRESS |
| 买入 | 流动性费 | 2% | LiquidityStaking（OLA 代币） |
| 卖出 | 营销费 | 1.5% | 营销地址（USDT） |
| 卖出 | LP 累积费 | 1.5% | LiquidityStaking（OLA 代币） |
| 卖出（有利润） | 利润税 | 25% | 40% LP质押 + 60% 节点分红（USDT） |

### 5.2 质押提现费用

| 费用类型 | 费率 | 接收方 |
|---------|------|--------|
| Friend 奖励 | 5% | 绑定的 Friend 地址 |
| 团队奖励 | 最高 35% | V1-V7 层级（差额分配） |
| 赎回费 | 1% | feeRecipient |
| 用户实际收到 | 剩余部分 | 用户 |

**示例**:
```
利息: 100 USDT
├─ Friend: 5 USDT (5%)
├─ 团队: 35 USDT (35%，差额分配给 V1-V7)
├─ 用户部分: 60 USDT (60%)
│   └─ 赎回费: 0.6 USDT (1%)
└─ 实际收到: 59.4 USDT
```

## 六、质押档位对比

### 6.1 OLA-Staking 主网档位

| stakeIndex | 日利率 | 周期 | 总回报率（复利） |
|------------|--------|------|-----------------|
| 0 | 0.3% | 1 天 | ~0.3% |
| 1 | 0.6% | 7 天 | ~4.28% |
| 2 | 1.0% | 15 天 | ~16.1% |
| 3 | 1.5% | 30 天 | ~56.31% |

**复利公式**:
```
最终价值 = 本金 × (1 + 日利率)^天数
```

## 七、关键差异点

### 7.1 与 SYI 系统的主要区别

| 特性 | OLA 系统 | SYI 系统 |
|------|---------|---------|
| 代币税收 | 有（买入 3%，卖出 3%） | 无（零税） |
| 利润税 | 25%（卖出时） | 无 |
| LP 代币 | 销毁 | 销毁 |
| 质押档位 | 4 档（1/7/15/30 天） | 4 档（1/30/90/180 天） |
| 日利率 | 0.3%-1.5% | 0.3%-1.5% |
| 推荐系统 | Friend + Team | Friend + Team |
| Recycle 机制 | 有 | 有 |
| 投资成本追踪 | 有（用于利润税） | 无 |

### 7.2 OLA 独有特性

1. **利润税机制**: 卖出时如果有利润，收取 25% 利润税
2. **投资成本追踪**: 记录每个用户的历史投资成本
3. **LiquidityStaking**: 独立的 LP 质押合约（接收 OLA 代币奖励）
4. **FundRelay**: 资金中继合约（用于费用分配）
5. **节点分红地址**: 利润税的 60% 分配给节点

### 7.3 代币经济学对比

**OLA**:
- 总量: 10,000,000 OLA
- 买入通缩: 1% 销毁
- 卖出不销毁，但有利润税
- 流动性只增不减（LP 销毁）

**SYI**:
- 总量: 100,000,000 SYI
- 零税设计
- 流动性只增不减（LP 销毁）

## 八、安全机制

### 8.1 OLA 代币安全

1. **黑白名单**: 可禁止恶意地址交易
2. **冷却时间**: 买入后 10 秒内不能卖出
3. **预售期保护**: 30 天内禁止买入
4. **延迟购买期**: 30 天延迟购买保护
5. **Recycle 限制**: 每次最多回收池子的 1/3

### 8.2 质押合约安全

1. **EOA 检查**: 只允许外部账户调用（主网）
2. **质押上限**: 单次 1000 USDT，总计 10000 USDT
3. **推荐链深度**: 最多 30 层
4. **传教士门槛**: 必须质押 ≥ 200 OLA 才能获得团队奖励
5. **滑点保护**: 自动计算最小输出量

## 九、总结

### 9.1 合约关系

```
┌─────────────────────────────────────────────────┐
│                   用户操作                        │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│  OLA 代币合约  │◄─────────►│  质押合约      │
│  (ERC20+税)   │  相互调用  │  (Staking)    │
└───────────────┘           └───────────────┘
        │                           │
        ├─ 买入税: 3%               ├─ 质押: USDT → sOLA
        ├─ 卖出税: 3%               ├─ 解除质押: sOLA → USDT
        ├─ 利润税: 25%              ├─ 推荐系统: Friend + Team
        └─ Recycle 机制             └─ 复利计算
```

### 9.2 核心特点

1. **双合约架构**: 代币合约 + 质押合约分离，通过接口相互调用
2. **税收机制**: OLA 代币有交易税和利润税，SYI 是零税
3. **Recycle 机制**: 从流动性池回收代币用于奖励分发
4. **投资成本追踪**: 用于计算利润税
5. **LP 永久销毁**: 流动性只增不减

### 9.3 适用场景

- **OLA 系统**: 适合需要交易税和利润税的项目，有更复杂的代币经济学
- **SYI 系统**: 适合零税设计，更简洁的代币模型

---

**文档版本**: v1.0
**创建日期**: 2026-02-08
**适用合约**: othercode/OLA + othercode/OLA-Staking
