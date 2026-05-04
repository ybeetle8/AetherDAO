# AE 主网部署方案

## 一、概述

本文档描述 AE 系统在 BSC 主网的完整部署流程。部署共涉及 **4 个合约**，需要管理员在部署前准备好所有配置地址和资金，部署后在 PancakeSwap 手动添加流动性。

部署前你需要做的
替换 ae-mainnet-config.json 中所有 10 个占位地址为真实地址
确认 .env 中 BSC_PRIVATE_KEY 和 BSCSCAN_API_KEY 正确
确保部署者钱包有足够 BNB（建议 0.5+）
执行: npx hardhat run scripts/deployAEMain.js --network bsc

验证:npx hardhat run scripts/verifyContracts.js --network bsc


### 部署的合约

| 序号 | 合约 | 说明 |
|------|------|------|
| 1 | Staking | 质押合约，处理用户质押、推荐奖励、团队奖励 |
| 2 | AE | ERC20 代币合约，含买卖税机制 |
| 3 | LiquidityStaking | LP 流动性质押合约 |
| 4 | FundRelay | 资金中继合约，解决 swap 时的 INVALID_TO 问题 |

### 代币分配

| 用途 | 数量 | 占比 |
|------|------|------|
| 流动性池 (PancakeSwap) | 60,000,000 AE | 60% |
| 质押储备金 | 20,000,000 AE | 20% |
| 节点奖励 | 18,740,000 AE | 18.74% |
| 跨链储备 | 1,260,000 AE | 1.26% |
| **合计** | **100,000,000 AE** | **100%** |

---

## 二、部署前准备

### 2.1 需要管理员准备的地址

> **重要**: 以下地址必须在部署前确定，且各地址应根据实际用途设置为**不同的地址**。标注 `immutable` 的使用 Solidity immutable 关键字声明；标注 `无setter` 的虽非 immutable 关键字，但合约中无修改函数，部署后同样不可更改。

| 地址用途 | 是否可修改 | 配置文件字段 | 说明 |
|----------|-----------|-------------|------|
| `marketingAddress` | 可修改 | `addresses.marketingAddress` | 营销地址，AE constructor + LiquidityStaking，部署后可通过 `setMarketingAddress()` 修改 |
| `rootAddress` | **不可修改** (immutable) | `addresses.rootAddress` | 推荐系统根节点地址 |
| `feeRecipient` | **不可修改** (immutable) | `addresses.feeRecipient` | 质押手续费接收地址 |
| `buyTaxNodeRewardAddress` | **不可修改** (immutable) | `addresses.buyTaxNodeRewardAddress` | 买入税节点奖励接收地址 |
| `buyTaxCommunityRewardAddress` | **不可修改** (immutable) | `addresses.buyTaxCommunityRewardAddress` | 买入税社区奖励接收地址 |
| `marketingFundAddress` | **不可修改** (无setter) | `addresses.marketingFundAddress` | 营销基金地址 |
| `weeklyTop15RewardAddress` | **不可修改** (无setter) | `addresses.weeklyTop15RewardAddress` | 每周 Top15 奖励地址 |
| `educationFundAddress` | **不可修改** (immutable) | `addresses.educationFundAddress` | 教育基金地址 |
| `nodeRewardAllocationAddress` | - | `addresses.nodeRewardAllocationAddress` | 节点奖励分配地址（接收 18,740,000 AE） |
| `crossChainReserveAddress` | - | `addresses.crossChainReserveAddress` | 跨链储备地址（接收 1,260,000 AE） |

### 2.2 资金准备

部署者钱包需要准备：
- **BNB**: 用于支付 Gas 费，建议至少 **0.5 BNB**（部署多个合约 + 多次交易）
- **USDC**: 如果由脚本添加流动性，需要 **60,000 USDC**（本方案中流动性由管理员手动在 PancakeSwap 添加，脚本不负责此步骤）

### 2.3 环境配置

`.env` 文件需要配置：

```bash
# 部署者私钥（不含 0x 前缀）
BSC_PRIVATE_KEY=你的私钥

# BSC 主网 RPC
BSC_RPC_URL=https://bsc-dataseed.bnbchain.org

# BSCScan API Key（用于合约验证/开源）
BSCSCAN_API_KEY=你的BSCScan_API_Key
```

### 2.4 hardhat.config.js 需要添加的配置

需要在 `hardhat.config.js` 中添加 `etherscan` 配置用于合约验证：

```javascript
etherscan: {
  apiKey: {
    bsc: process.env.BSCSCAN_API_KEY
  }
}
```

---

## 三、部署流程

### 整体流程图

```
步骤 1/13: 部署 Staking 合约
         ↓
步骤 2/13: 部署 AE 代币合约 (依赖 Staking 地址)
         ↓
步骤 3/13: 初始化 AE 白名单
         ↓
步骤 4/13: Staking.setAE() 关联 AE 代币
         ↓
步骤 5/13: 创建 AE/USDC 交易对 (通过 PancakeSwap Factory)
         ↓
步骤 6/13: AE.setPair() 设置交易对
         ↓
步骤 7/13: 转移 20,000,000 AE → Staking 合约
         ↓
步骤 8/13: 部署 LiquidityStaking 合约 (依赖 AE + Pair + Staking 地址)
         ↓
步骤 9/13: AE.setLiquidityStaking() 关联
         ↓
步骤 10/13: 部署 FundRelay 合约 (依赖 AE 地址)
         ↓
步骤 11/13: AE.setFundRelay() 关联
         ↓
步骤 12/13: 转移 18,740,000 AE → 节点奖励地址
         ↓
步骤 13/13: 转移 1,260,000 AE → 跨链储备地址
         ↓
验证: 检查所有余额和配置 + BSCScan 合约开源验证
         ↓
=== 脚本执行完毕 ===
         ↓
[手动] 管理员在 PancakeSwap 添加流动性
         ↓
[手动] AE.setPresaleActive(false) 开放交易
```

### 各步骤详解

#### 步骤 1: 部署 Staking 合约

```
合约路径: contracts/AE-Staking/src/mainnet/Staking.sol
构造参数:
  _usdx              = USDC 地址 (0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d)
  _router             = PancakeSwap Router (0x10ED43C718714eb63d5aA57B78B54704E256024E)
  _rootAddress        = 【管理员设定】推荐系统根地址
  _feeRecipient       = 【管理员设定】手续费接收地址
  _educationFundAddress = 【管理员设定】教育基金地址
```

#### 步骤 2: 部署 AE 代币合约

```
合约路径: contracts/AE/src/mainnet/AE.sol
构造参数:
  _usdx                          = USDC 地址
  _router                         = PancakeSwap Router
  _staking                        = 步骤1 部署的 Staking 地址
  _marketingAddress               = 【管理员设定】营销地址
  _buyTaxNodeRewardAddress        = 【管理员设定】买入税节点奖励地址
  _buyTaxCommunityRewardAddress   = 【管理员设定】买入税社区奖励地址
  _marketingFundAddress           = 【管理员设定】营销基金地址
  _weeklyTop15RewardAddress       = 【管理员设定】每周 Top15 奖励地址

部署后自动铸造 100,000,000 AE 到部署者地址
```

#### 步骤 3: 初始化白名单

调用 `ae.initializeWhitelist()`，自动将以下地址加入手续费白名单：
- Owner（部署者）
- AE 合约自身
- Staking 合约
- 营销地址
- Router

#### 步骤 4: 关联 AE 到 Staking

调用 `staking.setAE(aeAddress)`

#### 步骤 5: 创建交易对

通过 PancakeSwap Factory 调用 `createPair(aeAddress, USDC_ADDRESS)`

#### 步骤 6: 设置交易对

调用 `ae.setPair(pairAddress)`

#### 步骤 7: 转移质押储备金

从部署者转移 **20,000,000 AE** 到 Staking 合约

#### 步骤 8: 部署 LiquidityStaking

```
合约路径: contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol
构造参数:
  _usdt              = USDC 地址
  _olaContract       = AE 代币地址
  _lpToken           = 步骤5 创建的交易对地址
  _staking           = Staking 地址
  _marketingAddress  = 【管理员设定】营销地址
  _admin             = 部署者地址
  _router            = PancakeSwap Router
```

#### 步骤 9-11: 关联配置

- `ae.setLiquidityStaking(liquidityStakingAddress)` — 加入白名单
- 部署 FundRelay（构造参数: AE地址, USDC地址, 部署者地址作为紧急提取人）
- `ae.setFundRelay(fundRelayAddress)` — 加入白名单

#### 步骤 12-13: 代币分配

- 转移 **18,740,000 AE** → 节点奖励地址
- 转移 **1,260,000 AE** → 跨链储备地址

#### 验证阶段: 余额检查 + 合约开源验证

步骤 1-13 完成后，脚本自动：
- 检查所有合约的 AE 余额是否正确
- 调用 `hardhat verify` 在 BSCScan 上开源所有 4 个合约（需要配置 `BSCSCAN_API_KEY`）

---

## 四、手动操作部分

### 4.1 添加流动性（管理员手动完成）

脚本执行完毕后，部署者地址剩余 **60,000,000 AE**，需要管理员：

1. 前往 PancakeSwap: `https://pancakeswap.finance/add/v2`
2. 选择代币对: AE / USDC
3. 输入数量: 60,000,000 AE + 60,000 USDC
4. 初始价格: 1 AE = 0.001 USDC
5. 确认添加流动性
6. **建议**: 将获得的 LP 代币发送到 `0x0000000000000000000000000000000000000000`（销毁）以锁定流动性

### 4.2 开放交易

添加流动性后，调用 `ae.setPresaleActive(false)` 关闭预售模式，开放公开交易。

> **注意**: 部署后 AE 默认处于 presale 状态，**所有买入交易会被阻止**，直到管理员手动关闭 presale。

### 4.3 需要额外白名单的地址

如果有做市商、合作方等地址需要免税交易，部署后可调用：
```
ae.setFeeWhitelisted(address, true)
ae.setBatchFeeWhitelisted(address[], true)
```

---

## 五、合约验证（开源）

### BSCScan 验证说明

脚本会自动执行合约验证（`npx hardhat verify`），编译器参数如下：

| 参数 | 值 |
|------|-----|
| Solidity 版本 | 0.8.28 |
| EVM 版本 | cancun |
| Optimizer | Enabled, runs: 200 |
| via-IR | true |

### 验证顺序

1. **Staking** — 5 个构造参数
2. **AE** — 8 个构造参数
3. **LiquidityStaking** — 7 个构造参数
4. **FundRelay** — 3 个构造参数

如果自动验证失败，可以手动执行：

```bash
# 示例: 验证 AE 合约
npx hardhat verify --network bsc \
  --contract "contracts/AE/src/mainnet/AE.sol:AE" \
  <AE合约地址> \
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" \
  "0x10ED43C718714eb63d5aA57B78B54704E256024E" \
  "<Staking合约地址>" \
  "<营销地址>" \
  "<买入税节点奖励地址>" \
  "<买入税社区奖励地址>" \
  "<营销基金地址>" \
  "<每周Top15奖励地址>"
```

---

## 六、部署配置文件

主网部署使用专用配置文件 `ae-mainnet-config.json`，管理员需要在部署前替换所有 `【替换为真实地址】` 标记的地址。

> **注意**: 各地址应根据实际用途设置为**不同的地址**，不要将所有地址设为同一个值。

```json
{
  "network": "bsc",
  "addresses": {
    "usdx": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    "pancakeRouter": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    "pancakeFactory": "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",

    "_comment_marketing": "营销地址 - 部署后可通过 setMarketingAddress() 修改",
    "marketingAddress":               "【替换为真实地址】",

    "_comment_root": "推荐系统根节点 - Staking constructor (immutable, 不可修改)",
    "rootAddress":                    "【替换为真实地址】",

    "_comment_fee": "质押手续费接收地址 - Staking constructor (immutable, 不可修改)",
    "feeRecipient":                   "【替换为真实地址】",

    "_comment_buyTaxNode": "买入税节点奖励地址 - AE constructor (immutable, 不可修改)",
    "buyTaxNodeRewardAddress":        "【替换为真实地址】",

    "_comment_buyTaxCommunity": "买入税社区奖励地址 - AE constructor (immutable, 不可修改)",
    "buyTaxCommunityRewardAddress":   "【替换为真实地址】",

    "_comment_marketingFund": "营销基金地址 - AE constructor (无 setter, 部署后不可修改)",
    "marketingFundAddress":           "【替换为真实地址】",

    "_comment_weekly": "每周Top15奖励地址 - AE constructor (无 setter, 部署后不可修改)",
    "weeklyTop15RewardAddress":       "【替换为真实地址】",

    "_comment_education": "教育基金地址 - Staking constructor (immutable, 不可修改)",
    "educationFundAddress":           "【替换为真实地址】",

    "_comment_nodeReward": "节点奖励分配地址 - 接收 18,740,000 AE",
    "nodeRewardAllocationAddress":    "【替换为真实地址】",

    "_comment_crossChain": "跨链储备地址 - 接收 1,260,000 AE",
    "crossChainReserveAddress":       "【替换为真实地址】",

    "_warning": "注意：以上 10 个地址必须替换为真实地址，且各地址应根据实际用途设置为不同的地址"
  },
  "tokenomics": {
    "totalSupply": "100000000",
    "stakingReserve": "20000000",
    "initialLiquidity": {
      "ae": "60000000",
      "usdx": "60000"
    },
    "nodeRewardAllocation": "18740000",
    "crossChainReserveAllocation": "1260000"
  },
  "deployment": {
    "burnLP": true
  }
}
```

---

## 七、部署后检查清单

- [ ] 所有 4 个合约已成功部署
- [ ] Staking 合约余额 = 20,000,000 AE
- [ ] 节点奖励地址余额 = 18,740,000 AE
- [ ] 跨链储备地址余额 = 1,260,000 AE
- [ ] 部署者剩余余额 = 60,000,000 AE（用于添加流动性）
- [ ] AE/USDC 交易对已创建
- [ ] LiquidityStaking 已加入白名单
- [ ] FundRelay 已加入白名单
- [ ] 4 个合约均已在 BSCScan 开源验证
- [ ] 管理员已在 PancakeSwap 添加流动性
- [ ] LP 代币已销毁（如需要）
- [ ] `setPresaleActive(false)` 已执行，交易已开放
- [ ] 测试买入/卖出交易正常

---

## 八、执行命令

```bash
# 主网部署
npx hardhat run scripts/deployAEMain.js --network bsc
```

---

## 九、风险提示

1. **私钥安全**: 确保 `.env` 文件不会被提交到 Git，`.gitignore` 中应包含 `.env`
2. **地址核验**: 部署前务必反复核验所有地址，构造函数中标注 immutable 或无 setter 的地址部署后均无法修改；各地址应设置为不同的值
3. **Gas 价格**: 脚本默认 3 Gwei，BSC 拥堵时可能需要调高
4. **断点续跑**: 脚本支持断点续跑，中途失败后重新运行会自动跳过已完成步骤（状态保存在 `ae-mainnet-deployment.json`，如需全新部署请先删除该文件）
5. **预售模式**: 部署后 AE 默认处于预售状态，不要在添加流动性前关闭预售
