# ae-deployment-config.json 配置说明

## 配置字段详解

### 1. `network`

```json
"network": "localhost"
```

部署目标网络标识。用于写入 `ae-deployment.json` 部署记录，方便区分不同环境的部署结果。

- 可选值：`"localhost"` / `"bsc"` / `"bscTestnet"` 等

---

### 2. `addresses` — 外部地址配置

#### 2.1 基础设施地址

| 字段 | 当前值 | 用途 | 使用位置 |
|---|---|---|---|
| `usdx` | `0x8AC7...580d` | BSC 主网 USDC 合约地址，作为系统核心稳定币 | AE 构造函数、Staking 构造函数、LiquidityStaking 构造函数、FundRelay 构造函数、添加流动性 |
| `pancakeRouter` | `0x10ED...024E` | PancakeSwap V2 Router 地址 | AE 构造函数、Staking 构造函数、LiquidityStaking 构造函数、授权及添加流动性 |
| `pancakeFactory` | `0xcA14...0c73` | PancakeSwap V2 Factory 地址 | 创建 AE/USDX 交易对 |

#### 2.2 业务功能地址

| 字段 | 用途 | 传入合约 |
|---|---|---|
| `marketingAddress` | 营销地址，接收卖出税的一部分 | AE 构造函数参数 `_marketingAddress`；LiquidityStaking 构造函数参数 `_marketingAddress` |
| `rootAddress` | 推荐系统根节点地址，作为推荐链的顶层 | Staking 构造函数参数 `_rootAddress` |
| `feeRecipient` | 赎回手续费接收地址（Staking 中 0.6% 赎回费） | Staking 构造函数参数 `_feeRecipient` |
| `educationFundAddress` | 教育基金地址，接收解质押利息的 5% | Staking 构造函数参数 `_educationFundAddress` |

#### 2.3 买入税分配地址

| 字段 | 用途 | 传入合约 |
|---|---|---|
| `buyTaxNodeRewardAddress` | 买入税中 2% 的节点奖励接收地址 | AE 构造函数参数 `_buyTaxNodeRewardAddress` |
| `buyTaxCommunityRewardAddress` | 买入税中 1% 的社区奖励接收地址 | AE 构造函数参数 `_buyTaxCommunityRewardAddress` |

#### 2.4 卖出税 / 其他分配地址

| 字段 | 用途 | 传入合约 |
|---|---|---|
| `marketingFundAddress` | 卖出税中 1.5% 的营销基金接收地址 | AE 构造函数参数 `_marketingFundAddress` |
| `weeklyTop15RewardAddress` | 利润税中 40% 的周 Top15 奖励接收地址 | AE 构造函数参数 `_weeklyTop15RewardAddress` |

#### 2.5 代币分配专用地址

| 字段 | 用途 | 使用位置 |
|---|---|---|
| `nodeRewardAllocationAddress` | 节点奖励分配地址，接收 18,740,000 AE | 部署步骤 15：`ae.transfer(地址, 数量)` |
| `crossChainReserveAddress` | 跨链储备地址，接收 1,260,000 AE | 部署步骤 16：`ae.transfer(地址, 数量)` |

---

### 3. `tokenomics` — 代币经济学参数

| 字段 | 当前值 | 单位 | 用途 |
|---|---|---|---|
| `totalSupply` | `"100000000"` | AE | 总供应量。AE 合约内部硬编码铸造，此值仅用于部署后验证显示和记录。 |
| `stakingReserve` | `"20000000"` | AE | 质押储备金。部署步骤 7 转入 Staking 合约，作为用户质押奖励的资金池。 |
| `initialLiquidity.ae` | `"60000000"` | AE | 初始流动性中的 AE 数量。部署步骤 10 与 USDX 配对添加到 PancakeSwap。 |
| `initialLiquidity.usdx` | `"60000"` | USDX | 初始流动性中的 USDX 数量。决定初始价格：1 AE = 0.001 USDX。 |
| `nodeRewardAllocation` | `"18740000"` | AE | 节点奖励分配量。部署步骤 15 转入 `nodeRewardAllocationAddress`。 |
| `crossChainReserveAllocation` | `"1260000"` | AE | 跨链储备分配量。部署步骤 16 转入 `crossChainReserveAddress`。 |

**代币分配汇总：**

| 用途 | 数量 (AE) | 占比 |
|---|---|---|
| 初始流动性 | 60,000,000 | 60% |
| 质押储备金 | 20,000,000 | 20% |
| 节点奖励 | 18,740,000 | 18.74% |
| 跨链储备 | 1,260,000 | 1.26% |
| **合计** | **100,000,000** | **100%** |

---

### 4. `deployment` — 部署行为配置

| 字段 | 当前值 | 用途 |
|---|---|---|
| `burnLP` | `true` | 是否销毁 LP 代币。`true` 时 LP 发送至 `address(0)` 永久锁定流动性；`false` 时 LP 发送至部署者地址。 |
