# AE 系统部署信息 - 前端对接文档

> 本文档基于 `ae-deployment.json` 部署产出文件，为前端开发提供完整的合约地址、业务地址、代币经济学参数及集成指南。

---

## 一、部署基本信息

| 字段 | 值 | 说明 |
|---|---|---|
| network | `localhost` | 部署网络（正式环境为 `bsc`） |
| timestamp | `2026-04-23T16:17:05.170Z` | 部署时间 |
| 链 | BSC (BNB Chain) | Chain ID: 56 (主网) / 97 (测试网) |

---

## 二、合约地址

前端需要连接的 5 个核心合约：

### 2.1 合约地址总览

| 合约名称 | 地址 | 用途 |
|---|---|---|
| **AE** | `0x46f4165863D82723945cCeECcfb5abB5f1d3a303` | AE 代币合约（ERC20），处理买卖交易、税费逻辑 |
| **Staking** | `0x189aA4e4241766BA9c32CD0f1b049cffd5E53B1c` | USDX 质押合约，用户质押 USDX 获取 AE 奖励 |
| **LiquidityStaking** | `0xcBc465f7188f93e55B698f7cf30720B1c8BeAa0e` | LP 流动性质押合约，用户质押 AE/USDX LP 获取 USDX 奖励 |
| **FundRelay** | `0x1514558c57ce8Ff26d7700D8A12f23162c175AD6` | 资金中继合约，辅助 AE 合约与 DEX 交互时的 USDX 中转 |
| **Pair** | `0x3199A65c9910e2a0554812d527A6e75CFF3eE575` | AE/USDX PancakeSwap V2 交易对 LP 合约 |

### 2.2 各合约详细说明

#### AE 代币合约

- **标准**: ERC20 (18 位精度)
- **总供应量**: 100,000,000 AE
- **功能**: 代币转账、买卖税费处理、利润税计算、白名单/黑名单管理、预售控制
- **特殊机制**: 买入/卖出经过 PancakeSwap 交易对时自动收税

#### Staking 质押合约

- **质押代币**: USDX（BSC 上的 USDC）
- **奖励代币**: AE
- **核心功能**: 质押、解质押、提取利息、推荐绑定、团队等级
- **代币符号**: sAE (Staked AE)，18 位精度

#### LiquidityStaking 流动性质押合约

- **质押代币**: AE/USDX LP Token (来自 Pair 合约)
- **奖励代币**: USDX
- **核心功能**: LP 质押、解质押、领取奖励

#### FundRelay 资金中继合约

- **用途**: 中转资金，解决 AE 合约在 Uniswap 交互时的 `INVALID_TO` 问题
- **前端一般无需直接交互**

#### Pair 交易对合约

- **类型**: PancakeSwap V2 Pair (UniswapV2Pair 标准)
- **交易对**: AE / USDX
- **LP 代币已永久销毁**（发送至 `address(0)`），流动性永久锁定

---

## 三、外部依赖地址

前端在某些场景下可能需要这些地址（如授权、价格查询等）：

| 名称 | 地址 | 说明 |
|---|---|---|
| USDX (USDC) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | BSC 主网 USDC，系统核心稳定币，18 位精度 |
| PancakeSwap V2 Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | 用于 swap、添加/移除流动性 |
| PancakeSwap V2 Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | 用于查询交易对 |

---

## 四、业务地址

这些地址是系统运行中的资金接收方，前端可用于展示资金流向或进行透明度展示。

### 4.1 部署者

| 字段 | 值 |
|---|---|
| deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |

> 部署者为合约 owner，部署完成后 AE 余额为 0（已全部分配）。

### 4.2 税费分配地址

#### 买入税接收地址（买入 AE 时扣除 3%）

| 地址字段 | 地址 | 用途 | 占比 |
|---|---|---|---|
| buyTaxNodeRewardAddress | `0x06Ba6DA5d1942DA184ad3E521bC51dfF32D721d9` | 节点奖励池 | 买入额的 2% |
| buyTaxCommunityRewardAddress | `0xeE1285c96E77f2E8CB9C38b66A0BB51b2fCE5537` | 社区奖励池 | 买入额的 1% |

#### 卖出税接收地址（卖出 AE 时扣除 3% + 利润税）

| 地址字段 | 地址 | 用途 | 占比 |
|---|---|---|---|
| marketingFundAddress | `0x498B497fDAEf221dFC6e4Ea6183aEFA9e9b63D17` | 营销基金 | 卖出额的 1.5% |
| DEAD_ADDRESS | `0x000000000000000000000000000000000000dEaD` | 代币销毁 | 卖出额的 1.5% |
| weeklyTop15RewardAddress | `0x82B3B6a20d88d2d8B607B64876885259544DF591` | 周 Top15 奖励池 | 利润税的 40% |

> 利润税 = 卖出时若有利润（卖出价 > 用户平均买入成本），利润部分收取 25%。其中 60% 注入 LP，40% 分配至 weeklyTop15RewardAddress。

### 4.3 质押系统地址

| 地址字段 | 地址 | 用途 |
|---|---|---|
| rootAddress | `0x2345678901234567890123456789012345678901` | 推荐系统根节点，推荐链顶层 |
| feeRecipient | `0x3456789012345678901234567890123456789012` | 赎回手续费接收地址（解质押时收取 0.6%） |
| educationFundAddress | `0x2DC1e6D6Ae7b8Be231c54f0de2Ede2973550fBBa` | 教育基金地址（解质押利息的 5%） |
| marketingAddress | `0x1234567890123456789012345678901234567890` | 营销地址（LiquidityStaking 配置） |

### 4.4 代币分配地址

| 地址字段 | 地址 | 分配数量 | 用途 |
|---|---|---|---|
| nodeRewardAddress | `0x8234567890123456789012345678901234567890` | 18,740,000 AE | 节点运营奖励储备 |
| crossChainReserveAddress | `0x6bdD1F916C1bf45D62B7f8282fB7A69302C785bB` | 1,260,000 AE | 跨链桥储备金 |

---

## 五、代币经济学（Tokenomics）

### 5.1 供应与分配

| 参数 | 值 | 说明 |
|---|---|---|
| totalSupply | 100,000,000 AE | 总供应量 |
| stakingReserve | 20,000,000 AE | 质押储备金，存入 Staking 合约 |
| initialLiquidityAE | 60,000,000 AE | 初始流动性 AE 数量 |
| initialLiquidityUSDX | 60,000 USDX | 初始流动性 USDX 数量 |
| nodeRewardAllocation | 18,740,000 AE | 节点奖励分配 |
| crossChainReserveAllocation | 1,260,000 AE | 跨链储备分配 |

### 5.2 分配比例图

```
总供应量: 100,000,000 AE (100%)
├── 流动性池 (PancakeSwap)    60,000,000 AE  (60.00%)
├── 质押储备金 (Staking)      20,000,000 AE  (20.00%)
├── 节点奖励                  18,740,000 AE  (18.74%)
└── 跨链储备                   1,260,000 AE  ( 1.26%)
```

### 5.3 初始价格

- 初始 AE 价格 = 60,000 USDX / 60,000,000 AE = **0.001 USDX/AE**
- LP 代币已**永久销毁**，流动性不可撤出

### 5.4 部署后余额快照

| 持有者 | AE 余额 | 说明 |
|---|---|---|
| deployer | 0 | 所有代币已分配完毕 |
| Staking 合约 | 20,000,000 | 用户质押奖励资金池 |
| 流动性池 (Pair) | 60,000,000 | PancakeSwap 交易对 |
| 节点奖励地址 | 18,740,000 | 节点运营奖励 |
| 跨链储备地址 | 1,260,000 | 跨链桥预留 |

---

## 六、税费结构详解

### 6.1 买入税（Buy Tax）— 3%

用户通过 PancakeSwap 买入 AE 时，从买入的 AE 中扣除 3%：

| 分配方向 | 占比 | 接收地址 |
|---|---|---|
| 节点奖励池 | 2% | `buyTaxNodeRewardAddress` |
| 社区奖励池 | 1% | `buyTaxCommunityRewardAddress` |

### 6.2 卖出税（Sell Tax）— 3% + 利润税

用户通过 PancakeSwap 卖出 AE 时：

**基础卖出税 (3%)**

| 分配方向 | 占比 | 说明 |
|---|---|---|
| 营销基金 | 1.5% | 直接发送 AE 到 `marketingFundAddress` |
| 代币销毁 | 1.5% | 发送到 `0x...dEaD` 永久销毁 |

**利润税 (Profit Tax) — 25%**

仅当卖出有利润时（卖出价 > 用户平均成本价）触发：
- 利润部分收取 **25%** 税
- 其中 **60%** 注入流动性池
- 其中 **40%** 发送至 `weeklyTop15RewardAddress`

**无利润税 (No-Profit Fee) — 25%**

当卖出无利润时，亦收取 25% 费用。

### 6.3 转账税

- 普通转账（非买卖）：**0 税**（白名单地址之间）
- LP 相关操作手续费：**2.5%**

### 6.4 冷却时间

- 用户买入后需等待一定的冷却时间 (`coldTime`) 才能卖出

---

## 七、质押系统参数

### 7.1 质押期限与日利率

| 等级 (stakeIndex) | 锁定天数 | 日利率 |
|---|---|---|
| 0 | 7 天 | 0.6% |
| 1 | 30 天 | 0.9% |
| 2 | 90 天 | 1.1% |
| 3 | 180 天 | 1.5% |
| 4 | 365 天 | 2.0% |

### 7.2 质押限额

| 参数 | 值 | 说明 |
|---|---|---|
| 最小单次质押 | 100 USDX | `getMinStakeAmount()` |
| 最大单次质押 | 1,000 USDX | - |
| 用户最大总质押 | 10,000 USDX | `getMaxUserTotalStake()` |
| 动态上限 | 质押池的 1% - 近期流入 | `maxStakeAmount()` |
| 7 天期限制 | 每个用户仅可使用一次 | `has7DayStakeBeenUsed()` |

### 7.3 推荐系统

- 用户必须先绑定推荐人才能质押：`lockReferral(referrerAddress)`
- 绑定后不可修改
- 推荐奖励层级深度：**30 层**
- 成为"传道者"（Preacher）的门槛：质押 **200 USDX** 以上

### 7.4 团队等级与奖励率

| 等级 | 团队总投资门槛 (USDX) | 奖励率 |
|---|---|---|
| V1 | 3,000 | 3% |
| V2 | 10,000 | 7% |
| V3 | 30,000 | 11% |
| V4 | 100,000 | 15% |
| V5 | 300,000 | 19% |
| V6 | 1,000,000 | 23% |
| V7 | 3,000,000 | 27% |
| V8 | 10,000,000 | 31% |
| V9 | 30,000,000 | 35% |

> 团队奖励采用**严格差额制**：每一层推荐人只获得与其下一层的差额奖励率。

### 7.5 解质押费用分配

解质押时从利息中扣除：

| 分配方向 | 占比 | 说明 |
|---|---|---|
| 教育基金 | 5% | 发送至 `educationFundAddress` |
| 团队奖励 | 35% | 按团队等级分配给上级推荐人 |
| 赎回手续费 | 0.6% | 发送至 `feeRecipient`（从本金扣除） |
| 用户实际所得 | 剩余部分 | 利息部分扣除教育基金和团队奖励后 |

---

## 八、LP 质押参数

### 8.1 基本参数

| 参数 | 值 |
|---|---|
| 最短质押时间 | 24 小时 |
| 奖励分配周期 | 7 天 |
| 权重计算 | `amount × (1 + duration / 365天)` |

### 8.2 奖励来源

LP 质押的 USDX 奖励主要来源于 AE 卖出税中的利润税（60% 注入 LP 部分经转换后分配）。

---

## 九、前端关键函数调用指南

### 9.1 AE 代币合约

#### 读取函数（View / 免 gas）

```javascript
// 查询用户 AE 余额
const balance = await aeContract.balanceOf(userAddress);

// 查询用户投资信息（平均成本、最后买入时间）
const [investment, lastBuyTime] = await aeContract.getUserInvestment(userAddress);

// 查询 USDX 储备量（用于计算价格）
const usdxReserve = await aeContract.getUSDXReserve();

// 查询预售状态
const presaleStatus = await aeContract.getPresaleStatus();
// 返回: { active, startTime, duration, remainingTime, isInPresale }

// 查询交易对地址
const pairAddress = await aeContract.getUniswapV2Pair();

// 查询累积手续费
const fees = await aeContract.getAccumulatedFees();
// 返回: { marketing, lp, threshold }

// 计算兑换输出量（用于预估交易）
const amountOut = await aeContract.getAmountOut(amountIn, reserveIn, reserveOut);

// 查询延迟买入信息
const delayedBuyInfo = await aeContract.getDelayedBuyInfo();
// 返回: { enabled, testModeActive, enabledTime, requiredDelay, remainingDelay }
```

#### 写入函数（需 gas）

```javascript
// ERC20 标准授权（质押前需要先 approve）
await aeContract.approve(spenderAddress, amount);

// ERC20 标准转账
await aeContract.transfer(toAddress, amount);
```

### 9.2 Staking 质押合约

#### 读取函数（View / 免 gas）

```javascript
// 查询用户基本信息
const userInfo = await stakingContract.getUserInfo(userAddress);
// 返回: { totalStaked, teamKPI, referrer, hasLockedReferral, isPreacherStatus }

// 查询是否已绑定推荐人
const isBound = await stakingContract.isBindReferral(userAddress);

// 查询推荐人地址
const referrer = await stakingContract.getReferral(userAddress);

// 查询是否为传道者
const isPreacher = await stakingContract.isPreacher(userAddress);

// 查询用户质押数量
const count = await stakingContract.stakeCount(userAddress);

// 查询特定质押槽位的奖励
const reward = await stakingContract.rewardOfSlot(userAddress, stakeIndex);

// 查询所有质押的提现状态
const status = await stakingContract.getUserStakeWithdrawalStatus(userAddress);
// 返回: { stakeIndices[], canWithdraw[], timeRemaining[] }

// 查询可提取利息
const interest = await stakingContract.getAvailableInterest(userAddress, stakeIndex);

// 查询已提取利息
const withdrawn = await stakingContract.getWithdrawnInterest(userAddress, stakeIndex);

// 查询用户剩余质押额度
const remaining = await stakingContract.getRemainingStakeCapacity(userAddress);

// 查询当前动态质押上限
const maxStake = await stakingContract.maxStakeAmount();

// 查询团队业绩详情
const teamDetails = await stakingContract.getTeamPerformanceDetails(userAddress);
// 返回: { totalTeamInvestment, teamMemberCount, currentTier, nextTierThreshold, progressToNextTier }

// 查询所有质押期限
const periods = await stakingContract.getStakePeriods();
// 返回: [7天, 30天, 90天, 180天, 365天] (秒为单位)

// 查询团队等级门槛和奖励率
const thresholds = await stakingContract.getTeamRewardThresholds();
const rates = await stakingContract.getTeamRewardRates();

// 查询余额相关
const balance = await stakingContract.balanceOf(userAddress);         // 当前总价值
const principal = await stakingContract.principalBalance(userAddress); // 本金
const earned = await stakingContract.earnedInterest(userAddress);      // 累计利息

// 查询 7 天期是否已使用
const used = await stakingContract.has7DayStakeBeenUsed(userAddress);

// 查询提现历史
const history = await stakingContract.getWithdrawalHistory(userAddress);
const count = await stakingContract.getWithdrawalCount(userAddress);
```

#### 写入函数（需 gas）

```javascript
// 1. 绑定推荐人（质押前必须调用，一次性操作）
await stakingContract.lockReferral(referrerAddress);

// 2. 质押 USDX
//    前置条件: 先 approve USDX 给 Staking 合约
//    _amount: USDX 数量（uint160），_stakeIndex: 0-4 对应 5 个期限
await usdxContract.approve(stakingAddress, amount);
await stakingContract.stake(amount, stakeIndex);

// 3. 解质押（到期后）— 取回本金 + 全部利息
await stakingContract.unstake(stakeIndex);

// 4. 仅提取利息（不取回本金）
await stakingContract.withdrawInterest(stakeIndex);
```

### 9.3 LiquidityStaking 流动性质押合约

#### 读取函数（View / 免 gas）

```javascript
// 查询用户 LP 质押信息
const info = await liquidityStakingContract.getUserStakeInfo(userAddress);
// 返回: { stakedAmount, stakeTime, pendingReward, accumulatedReward, weight }

// 查询奖励池信息
const poolInfo = await liquidityStakingContract.getRewardPoolInfo();
// 返回: { totalRewards, rewardPerSecond, totalStaked, totalWeight, stakersCount }

// 查询是否可以解质押（满 24 小时）
const canUnstake = await liquidityStakingContract.canUnstake(userAddress);

// 查询提现状态
const withdrawStatus = await liquidityStakingContract.canWithdrawStake(userAddress);
// 返回: { canWithdraw, stakedAmount, timeRemaining }
```

#### 写入函数（需 gas）

```javascript
// 1. 质押 LP 代币
//    前置条件: 先 approve LP Token 给 LiquidityStaking 合约
await lpTokenContract.approve(liquidityStakingAddress, amount);
await liquidityStakingContract.stake(amount);

// 2. 解质押 LP 代币（满 24 小时后）
await liquidityStakingContract.unstake(amount);

// 3. 领取 USDX 奖励
await liquidityStakingContract.claimReward();
```

### 9.4 USDX (USDC) 合约

```javascript
// 查询用户 USDX 余额
const balance = await usdxContract.balanceOf(userAddress);

// 授权 Staking 合约使用 USDX（质押前必须）
await usdxContract.approve(stakingAddress, amount);

// 授权 Router 使用 USDX（添加流动性前必须）
await usdxContract.approve(routerAddress, amount);
```

---

## 十、前端需要监听的关键事件

### 10.1 AE 合约事件

```javascript
// 交易执行事件 — 监听所有买卖交易
aeContract.on("TransactionExecuted", (user, timestamp, txType, ...) => {});

// 卖出交易详情 — 包含利润税信息
aeContract.on("SellTransaction", (seller, timestamp, ...) => {});

// 用户投资更新 — 买入时更新平均成本
aeContract.on("InvestmentUpdated", (user, timestamp, prevInvestment, newInvestment, ...) => {});

// 手续费处理事件
aeContract.on("FeesProcessed", (timestamp, processType, ...) => {});

// 流动性添加事件
aeContract.on("LiquidityAdded", (tokenAmount, usdxAmount) => {});
```

### 10.2 Staking 合约事件

```javascript
// 质押事件
stakingContract.on("Staked", (user, amount, timestamp, index, stakeTime) => {});

// 解质押完成事件 — 包含详细费用分解
stakingContract.on("WithdrawalCompleted", (user, stakeIndex, principalAmount,
  calculatedReward, usdxReceived, aeTokensUsed, referralFee, teamFee,
  userPayout, interestEarned, withdrawalTime) => {});

// 利息提取事件
stakingContract.on("InterestWithdrawn", (user, stakeIndex, interestAmount,
  usdxReceived, aeTokensUsed, referralFee, teamFee, userPayout, timestamp) => {});

// 推荐绑定事件
stakingContract.on("ReferralBound", (user, referrer, timestamp) => {});

// 团队奖励分配事件
stakingContract.on("TeamRewardDistributionCompleted", (...) => {});
```

### 10.3 LiquidityStaking 合约事件

```javascript
// LP 质押事件
liquidityStakingContract.on("Staked", (user, amount, timestamp) => {});

// LP 解质押事件
liquidityStakingContract.on("Unstaked", (user, amount, reward) => {});

// 领取奖励事件
liquidityStakingContract.on("RewardClaimed", (user, reward) => {});

// 奖励存入事件
liquidityStakingContract.on("RewardsDeposited", (amount, newRewardRate) => {});
```

---

## 十一、前端集成流程

### 11.1 新用户流程

```
1. 连接钱包
2. 调用 stakingContract.isBindReferral(user) 检查是否已绑定推荐人
3. 若未绑定 → 引导用户输入推荐人地址 → 调用 lockReferral(referrer)
4. 用户选择质押期限和金额
5. USDX approve → stake()
```

### 11.2 质押管理流程

```
1. 调用 getUserStakeWithdrawalStatus() 获取所有质押状态
2. 对于每个质押:
   - 未到期 → 显示剩余时间、当前利息 (rewardOfSlot)
   - 可提取利息 → 调用 withdrawInterest()
   - 已到期 → 调用 unstake() 取回本金+利息
3. 调用 getTeamPerformanceDetails() 显示团队等级进度
```

### 11.3 LP 质押流程

```
1. 用户先在 PancakeSwap 添加 AE/USDX 流动性，获取 LP Token
2. LP Token approve 给 LiquidityStaking 合约
3. 调用 stake(amount) 质押 LP
4. 等待 24 小时后可解质押或领取奖励
```

### 11.4 AE 价格计算

```javascript
// 从 Pair 合约获取储备量
const [reserve0, reserve1] = await pairContract.getReserves();
// 需要确认 token0/token1 顺序
const token0 = await pairContract.token0();

let aeReserve, usdxReserve;
if (token0.toLowerCase() === aeAddress.toLowerCase()) {
  aeReserve = reserve0;
  usdxReserve = reserve1;
} else {
  aeReserve = reserve1;
  usdxReserve = reserve0;
}

// AE 价格 = USDX 储备 / AE 储备
const aePrice = Number(usdxReserve) / Number(aeReserve);
```

---

## 十二、常量速查表

| 参数 | 值 | 说明 |
|---|---|---|
| AE 精度 | 18 | `decimals()` |
| USDX 精度 | 18 | BSC 上的 USDC 为 18 位 |
| sAE 精度 | 18 | Staking 合约内部代币 |
| 买入税 | 3% | 2% 节点 + 1% 社区 |
| 卖出税 | 3% | 1.5% 营销 + 1.5% 销毁 |
| 利润税 | 25% | 60% LP + 40% Top15 |
| LP 手续费 | 2.5% | 流动性操作时 |
| 最小质押 | 100 USDX | - |
| 最大单次质押 | 1,000 USDX | - |
| 最大总质押 | 10,000 USDX | 每个用户 |
| 传道者门槛 | 200 USDX | 质押总额 |
| 推荐深度 | 30 层 | - |
| 教育基金 | 5% | 利息扣除 |
| 团队奖励 | 35% | 利息扣除 |
| 赎回手续费 | 0.6% | 本金扣除 |
| LP 最短质押 | 24 小时 | - |
| LP 奖励周期 | 7 天 | - |

---

## 十三、注意事项

1. **所有金额单位**: 合约内部使用 `wei` (18 位精度)，前端显示时需要使用 `ethers.formatEther()` 或除以 `10^18`
2. **授权流程**: 质押和交易前必须先调用对应代币的 `approve()` 函数
3. **推荐绑定**: 一旦绑定不可更改，绑定前需确认推荐人地址正确
4. **7 天期限制**: 每个用户只能使用一次 7 天质押期，使用前需检查 `has7DayStakeBeenUsed()`
5. **冷却时间**: 买入 AE 后有冷却期，期间不能卖出
6. **动态上限**: `maxStakeAmount()` 会根据质押池状态动态变化，下单前需实时查询
7. **LP 代币已销毁**: 初始流动性的 LP 代币已永久锁定，无法撤出
