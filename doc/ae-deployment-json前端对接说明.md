# ae-deployment.json 前端对接说明

> 每次部署后由 `scripts/deployAE.js` 自动生成，合约地址和余额会随部署环境变化。前端应从该文件动态读取，不要硬编码。

---

## 文件结构总览

```json
{
  "network": "...",
  "timestamp": "...",
  "contracts": { ... },
  "addresses": { ... },
  "tokenomics": { ... },
  "balances": { ... }
}
```

---

## 一、`network` — 部署网络

| 类型 | 示例值 |
|---|---|
| string | `"localhost"` / `"bsc"` / `"bscTestnet"` |

标识本次部署的目标网络。前端可据此判断当前环境，切换 RPC 节点和 Chain ID。

---

## 二、`timestamp` — 部署时间

| 类型 | 示例值 |
|---|---|
| string (ISO 8601) | `"2026-04-24T02:41:12.634Z"` |

本次部署的 UTC 时间戳，可用于前端展示部署版本或做缓存失效判断。

---

## 三、`contracts` — 合约地址

前端需要交互的 5 个核心合约。**每次重新部署地址都会变化**，必须从该文件读取。

```json
{
  "AE": "0x...",
  "Staking": "0x...",
  "LiquidityStaking": "0x...",
  "FundRelay": "0x...",
  "Pair": "0x..."
}
```

### 字段说明

| 字段 | 合约类型 | 前端用途 |
|---|---|---|
| `AE` | AE 代币合约 (ERC20, 18 位精度) | 查余额、approve、转账、查价格/投资信息、监听交易事件 |
| `Staking` | USDX 质押合约 | 绑定推荐人、质押/解质押 USDX、提取利息、查团队等级与质押状态 |
| `LiquidityStaking` | LP 流动性质押合约 | 质押/解质押 LP Token、领取 USDX 奖励、查质押信息 |
| `FundRelay` | 资金中继合约 | 辅助合约，前端一般**无需直接交互** |
| `Pair` | AE/USDX PancakeSwap V2 交易对 | 查 `getReserves()` 计算 AE 实时价格、获取 LP Token 地址 |

### 前端关键交互

#### AE 合约 — 常用调用

| 函数 | 类型 | 说明 |
|---|---|---|
| `balanceOf(address)` | view | 查询用户 AE 余额 |
| `approve(spender, amount)` | 写入 | 授权其他合约使用 AE |
| `getUserInvestment(address)` | view | 返回用户平均成本和最后买入时间 |
| `getUSDXReserve()` | view | 交易对中的 USDX 储备量 |
| `getPresaleStatus()` | view | 预售状态（active, remainingTime, isInPresale） |
| `getAccumulatedFees()` | view | 累积的待处理手续费 |
| `getAmountOut(amountIn, reserveIn, reserveOut)` | view | 预估兑换输出量 |

#### Staking 合约 — 常用调用

| 函数 | 类型 | 说明 |
|---|---|---|
| `isBindReferral(address)` | view | 是否已绑定推荐人 |
| `lockReferral(referrer)` | 写入 | 绑定推荐人（一次性，不可修改） |
| `stake(amount, stakeIndex)` | 写入 | 质押 USDX，stakeIndex 0-4 对应 5 档期限 |
| `unstake(stakeIndex)` | 写入 | 解质押，取回本金+利息 |
| `withdrawInterest(stakeIndex)` | 写入 | 仅提取利息，不取回本金 |
| `getUserInfo(address)` | view | 用户总质押/团队KPI/推荐人/传道者状态 |
| `getUserStakeWithdrawalStatus(address)` | view | 所有质押的到期状态和剩余时间 |
| `getAvailableInterest(address, stakeIndex)` | view | 指定质押可提取的利息 |
| `getRemainingStakeCapacity(address)` | view | 用户剩余质押额度 |
| `maxStakeAmount()` | view | 当前动态质押上限 |
| `getTeamPerformanceDetails(address)` | view | 团队业绩/等级/升级进度 |
| `stakeCount(address)` | view | 用户质押笔数 |
| `has7DayStakeBeenUsed(address)` | view | 7天期是否已使用（每人限一次） |
| `getStakePeriods()` | view | 5 档质押期限（秒） |
| `getTeamRewardThresholds()` | view | V1-V9 团队等级门槛 |
| `getTeamRewardRates()` | view | V1-V9 团队奖励率 |
| `balanceOf(address)` | view | 当前总价值（本金+利息） |
| `principalBalance(address)` | view | 仅本金 |
| `earnedInterest(address)` | view | 累计利息 |

#### LiquidityStaking 合约 — 常用调用

| 函数 | 类型 | 说明 |
|---|---|---|
| `stake(amount)` | 写入 | 质押 LP Token（需先 approve） |
| `unstake(amount)` | 写入 | 解质押（需满 24 小时） |
| `claimReward()` | 写入 | 领取 USDX 奖励 |
| `getUserStakeInfo(address)` | view | 质押量/时间/待领奖励/权重 |
| `getRewardPoolInfo()` | view | 奖励池总量/分配速率/总质押量/总权重 |
| `canUnstake(address)` | view | 是否满足最短 24 小时 |
| `canWithdrawStake(address)` | view | 是否可提现及剩余时间 |

#### Pair 合约 — 价格计算

```javascript
const [reserve0, reserve1] = await pairContract.getReserves();
const token0 = await pairContract.token0();
// 根据 token0 判断哪个是 AE、哪个是 USDX
// AE 价格 = usdxReserve / aeReserve
```

---

## 四、`addresses` — 业务地址

这些地址是系统中的资金接收方，部署时从配置文件写入。前端可用于展示资金流向或透明度页面。

```json
{
  "deployer": "0x...",
  "marketingAddress": "0x...",
  "rootAddress": "0x...",
  "feeRecipient": "0x...",
  "buyTaxNodeRewardAddress": "0x...",
  "buyTaxCommunityRewardAddress": "0x...",
  "marketingFundAddress": "0x...",
  "weeklyTop15RewardAddress": "0x...",
  "crossChainReserveAddress": "0x...",
  "educationFundAddress": "0x...",
  "nodeRewardAddress": "0x..."
}
```

### 字段说明

| 字段 | 角色 | 资金来源 |
|---|---|---|
| `deployer` | 部署者/owner | 部署完成后 AE 余额为 0（已全部分配） |
| `marketingAddress` | 营销地址 | LiquidityStaking 合约配置使用 |
| `rootAddress` | 推荐系统根节点 | 推荐链顶层，不接收资金，仅作为链路终点 |
| `feeRecipient` | 赎回手续费接收 | 解质押时从本金扣除 0.6% |
| `buyTaxNodeRewardAddress` | 买入税 — 节点奖励 | 买入 AE 时扣 2%，直接转入 |
| `buyTaxCommunityRewardAddress` | 买入税 — 社区奖励 | 买入 AE 时扣 1%，直接转入 |
| `marketingFundAddress` | 卖出税 — 营销基金 | 卖出 AE 时扣 1.5%，直接转入 |
| `weeklyTop15RewardAddress` | 利润税 — 周 Top15 奖励 | 利润税的 40% 转入 |
| `crossChainReserveAddress` | 跨链储备 | 部署时一次性分配 1,260,000 AE |
| `educationFundAddress` | 教育基金 | 解质押利息的 5% 转入 |
| `nodeRewardAddress` | 节点奖励储备 | 部署时一次性分配 18,740,000 AE |

### 税费结构速览

**买入税 3%**：`buyTaxNodeRewardAddress` 2% + `buyTaxCommunityRewardAddress` 1%

**卖出税 3%**：`marketingFundAddress` 1.5% + 销毁(0x...dEaD) 1.5%

**利润税 25%**（卖出有利润时额外收取）：60% 注入 LP + 40% 到 `weeklyTop15RewardAddress`

**解质押费用**：教育基金 5%(`educationFundAddress`) + 团队奖励 35%(按等级分配给上级) + 赎回费 0.6%(`feeRecipient`)

---

## 五、`tokenomics` — 代币经济学参数

```json
{
  "totalSupply": "100000000.0",
  "stakingReserve": "20000000.0",
  "initialLiquidityAE": "60000000.0",
  "initialLiquidityUSDX": "60000.0",
  "nodeRewardAllocation": "18740000.0",
  "crossChainReserveAllocation": "1260000.0"
}
```

### 字段说明

| 字段 | 单位 | 说明 |
|---|---|---|
| `totalSupply` | AE | 代币总供应量 |
| `stakingReserve` | AE | 转入 Staking 合约的储备金，用于发放质押奖励 |
| `initialLiquidityAE` | AE | 注入 PancakeSwap 流动性池的 AE 数量 |
| `initialLiquidityUSDX` | USDX | 注入流动性池的 USDX 数量，与 AE 配对 |
| `nodeRewardAllocation` | AE | 分配到 `nodeRewardAddress` 的代币量 |
| `crossChainReserveAllocation` | AE | 分配到 `crossChainReserveAddress` 的代币量 |

### 分配比例

```
totalSupply = stakingReserve + initialLiquidityAE + nodeRewardAllocation + crossChainReserveAllocation

100,000,000 = 20,000,000 (20%) + 60,000,000 (60%) + 18,740,000 (18.74%) + 1,260,000 (1.26%)
```

### 初始价格

```
initialLiquidityUSDX / initialLiquidityAE = 60,000 / 60,000,000 = 0.001 USDX/AE
```

> LP 代币已永久销毁（发送至 address(0)），流动性不可撤出。

---

## 六、`balances` — 部署后各方 AE 余额快照

```json
{
  "deployer": "0.0",
  "staking": "20000000.0",
  "liquidityPool": "60000000.0",
  "nodeReward": "18740000.0",
  "crossChainReserve": "1260000.0"
}
```

### 字段说明

| 字段 | 对应地址/合约 | 说明 |
|---|---|---|
| `deployer` | `addresses.deployer` | 部署者剩余 AE（正常为 0，代币已全部分配） |
| `staking` | `contracts.Staking` | Staking 合约持有的 AE，作为质押奖励池 |
| `liquidityPool` | `contracts.Pair` | 流动性池中的 AE 数量 |
| `nodeReward` | `addresses.nodeRewardAddress` | 节点奖励地址持有的 AE |
| `crossChainReserve` | `addresses.crossChainReserveAddress` | 跨链储备地址持有的 AE |

> 此为部署时的快照。实际余额会随交易和质押操作变化，需链上实时查询。

---

## 七、质押系统关键参数

以下参数硬编码在合约中，不在 `ae-deployment.json` 里，但前端集成需要了解：

### 质押期限与日利率

| stakeIndex | 锁定天数 | 日利率 |
|---|---|---|
| 0 | 7 天 | 0.6% |
| 1 | 30 天 | 0.9% |
| 2 | 90 天 | 1.1% |
| 3 | 180 天 | 1.5% |
| 4 | 365 天 | 2.0% |

### 质押限额

| 参数 | 值 | 获取方式 |
|---|---|---|
| 最小单次质押 | 100 USDX | `getMinStakeAmount()` |
| 最大单次质押 | 1,000 USDX | 合约常量 |
| 用户最大总质押 | 10,000 USDX | `getMaxUserTotalStake()` |
| 动态上限 | 池子 1% - 近期流入 | `maxStakeAmount()` |
| 7 天期限制 | 每个用户仅可使用一次 | `has7DayStakeBeenUsed()` |
| 传道者门槛 | 200 USDX | 质押总额达到即为传道者 |

### 团队等级 (V1-V9)

| 等级 | 团队投资门槛 (USDX) | 奖励率 |
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

> 团队奖励采用严格差额制，每一层推荐人只获得与下一层的差额奖励率。

### LP 质押参数

| 参数 | 值 |
|---|---|
| 最短质押时间 | 24 小时 |
| 奖励分配周期 | 7 天 |
| 权重计算 | `amount × (1 + duration / 365天)` |

---

## 八、前端集成流程

### 新用户质押流程

```
1. 连接钱包
2. isBindReferral(user) → 检查是否已绑定推荐人
3. 未绑定 → lockReferral(referrer)
4. 选择质押期限 (stakeIndex 0-4) 和金额
5. USDX.approve(Staking合约地址, 金额)
6. Staking.stake(金额, stakeIndex)
```

### 质押管理

```
1. getUserStakeWithdrawalStatus(user) → 获取所有质押的到期状态
2. 未到期 → 显示剩余时间、当前利息 rewardOfSlot(user, index)
3. 可提取利息 → withdrawInterest(index)
4. 已到期 → unstake(index) 取回本金+利息
```

### LP 质押流程

```
1. 用户在 PancakeSwap 添加 AE/USDX 流动性，获取 LP Token
2. LP.approve(LiquidityStaking合约地址, 金额)
3. LiquidityStaking.stake(金额)
4. 满 24 小时后可 unstake() 或 claimReward()
```

---

## 九、常量速查

| 参数 | 值 |
|---|---|
| AE 精度 | 18 |
| USDX 精度 | 18 (BSC USDC) |
| 买入税 | 3% (2% 节点 + 1% 社区) |
| 卖出税 | 3% (1.5% 营销 + 1.5% 销毁) |
| 利润税 | 25% (60% LP + 40% Top15) |
| LP 手续费 | 2.5% |
| 赎回手续费 | 0.6% |
| 教育基金 | 利息的 5% |
| 团队奖励 | 利息的 35% |
| 推荐深度 | 30 层 |

---

## 十、注意事项

1. **地址不要硬编码**：每次部署 `contracts` 中的地址都会变，前端应从 `ae-deployment.json` 动态加载
2. **金额精度**：`tokenomics` 和 `balances` 中的值已经是 ether 单位（非 wei），可直接显示；链上查询返回的是 wei，需 `ethers.formatEther()` 转换
3. **balances 是快照**：仅反映部署时刻的余额，实际余额需链上实时查询
4. **授权流程**：任何质押操作前必须先调用对应代币的 `approve()`
5. **推荐绑定不可逆**：`lockReferral()` 一旦调用不可更改
6. **动态上限**：`maxStakeAmount()` 受池子状态和近期流入影响，每次质押前需实时查询
