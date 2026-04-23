# deployAE.js 部署脚本审查报告 (第二版)

> 基于更新后的 `scripts/deployAE.js` 与合约源码的交叉审查。
> 对比第一版审查报告，标注已修复项和新发现。

---

## 一、部署流程总览 (17 步)

| 步骤 | 操作 | 合约调用 | 状态 |
|------|------|----------|------|
| 1 | 部署 Staking 合约 | `Staking.deploy(usdx, router, root, feeRecipient, educationFund)` | ✅ |
| 2 | 部署 AE 代币合约 | `AE.deploy(usdx, router, staking, marketing, nodeReward, communityReward, marketingFund, weeklyTop15)` | ✅ |
| 3 | 初始化白名单 | `ae.initializeWhitelist()` | ✅ |
| 4 | 配置质押合约 | `staking.setAE(aeAddress)` | ✅ |
| 5 | 创建交易对 | `factory.createPair(ae, usdx)` | ✅ |
| 6 | 设置交易对 | `ae.setPair(pairAddress)` | ✅ |
| 7 | 转移质押储备金 | `ae.transfer(staking, 20,000,000)` | ✅ |
| 8 | 设置 USDX 余额 | 本地: `hardhat_setStorageAt` / 主网: 余额检查 | ✅ 已修复 |
| 9 | 授权 Router | `ae.approve` + `usdx.approve` | ✅ |
| 10 | 添加初始流动性 | `router.addLiquidity(...)` | ✅ 已修复 |
| 11 | 部署 LiquidityStaking | `LiquidityStaking.deploy(...)` | ✅ |
| 12 | 配置 LiquidityStaking | `ae.setLiquidityStaking(...)` | ✅ |
| 13 | 部署 FundRelay | `FundRelay.deploy(ae, usdx, deployer)` | ✅ |
| 14 | 配置 FundRelay | `ae.setFundRelay(...)` | ✅ |
| 15 | 转移节点奖励 | `ae.transfer(nodeReward, 18,740,000)` | ✅ 新增 |
| 16 | 转移跨链储备 | `ae.transfer(crossChain, 1,260,000)` | ✅ 新增 |
| 17 | 验证部署 + presale 提醒 | 余额校验 + `getPresaleStatus()` | ✅ 已修复 |

---

## 二、第一版问题修复情况

### ✅ 已修复: 主网环境判断 (原问题 3)

脚本步骤 8 已增加网络判断逻辑 (`deployAE.js:107-151`):

```javascript
if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
  // hardhat_setStorageAt 设置余额
} else {
  // 主网: 检查余额是否足够
}
```

### ✅ 已修复: 流动性滑点保护 (原问题 4)

主网部署时已设置 1% 滑点保护 (`deployAE.js:166-169`):

```javascript
const isLocalNetwork = hre.network.name === "localhost" || hre.network.name === "hardhat";
const slippage = 99n;
const amountAMin = isLocalNetwork ? 0n : INITIAL_LIQUIDITY_AE * slippage / 100n;
const amountBMin = isLocalNetwork ? 0n : INITIAL_LIQUIDITY_USDX * slippage / 100n;
```

### ⚠️ 待改进: presale 状态管理 (原问题 5)

脚本末尾已增加 presale 状态提醒，但仅打印信息，未自动关闭。建议在部署流程中直接关闭 presale:

```javascript
console.log("=== 步骤 18: 关闭 presale 限制 ===");
await ae.setPresaleActive(false);
console.log("✓ presale 已关闭，交易已开放");
```

当前脚本仅做提醒 (`deployAE.js:355-360`)，部署后买入仍被阻止，需手动执行 `ae.setPresaleActive(false)` 才能开放交易。

### ✅ 已修复: 缺少可选配置步骤 (原问题 6)

- `setLiquidityStaking` — 步骤 12 已配置
- `setFundRelay` — 步骤 14 已配置
- `setNodeDividendAddress` — 确认为死代码，无需配置

### ✅ 已修复: 部署信息保存不完整 (原问题 7)

`ae-deployment.json` 现已包含 `educationFundAddress` 和 `nodeRewardAddress`。

---

## 三、代币分配变更

### 新版分配方案 (100,000,000 AE)

| 用途 | 数量 | 占比 | 变更 |
|------|------|------|------|
| 质押储备 | 20,000,000 AE | 20% | 不变 |
| 流动性池 | 60,000,000 AE | 60% | 不变 |
| 节点奖励 | 18,740,000 AE | 18.74% | 🆕 新增 |
| 跨链储备 | 1,260,000 AE | 1.26% | 🆕 新增 |
| 部署者剩余 | 0 AE | 0% | — |
| **合计** | **100,000,000 AE** | **100%** | — |

deployer 最终余额为 0，所有代币已明确分配。验证表格 (步骤 17) 已更新为正确描述"全部已分配完毕，无剩余"。

**原问题 2 (deployer 余额为 0) 已通过明确的分配方案解决。**

---

## 四、配置文件外部化

脚本已从硬编码改为读取 `ae-deployment-config.json` 配置文件:

```json
{
  "addresses": { "usdx", "pancakeRouter", "pancakeFactory", "marketingAddress", ... },
  "tokenomics": { "totalSupply", "stakingReserve", "initialLiquidity", ... },
  "deployment": { "burnLP": true, "testWalletIndex": 9 }
}
```

优点:
- 地址和参数集中管理，避免脚本内硬编码
- `deployment.burnLP` 控制 LP 代币是否销毁
- 主网/测试网可使用不同配置文件

---

## 五、仍存在的问题

### ⚠️ 问题 1: LP 销毁策略依赖配置但缺少安全确认

`deployAE.js:163`:

```javascript
const lpRecipient = config.deployment.burnLP ? hre.ethers.ZeroAddress : deployer.address;
```

当前配置 `burnLP: true`，LP 代币将发送到 `address(0)` 永久销毁。这是不可逆操作。

**建议:** 主网部署时增加二次确认提示，防止误操作。

### ⚠️ 问题 2: NODE_REWARD_ADDRESS 复用了 buyTaxNodeRewardAddress

`deployAE.js:22`:

```javascript
const NODE_REWARD_ADDRESS = config.addresses.buyTaxNodeRewardAddress;
// 使用买入税节点奖励地址作为节点奖励分配地址
```

`NODE_REWARD_ADDRESS` 直接复用了 `buyTaxNodeRewardAddress` (`0x06Ba6DA5...`)。这意味着:

- 买入税中 2% 的节点奖励 → 发送到此地址
- 步骤 15 的 18,740,000 AE 节点奖励分配 → 也发送到此地址

两笔不同用途的资金混入同一地址。如果这是有意设计（同一个节点奖励池统一管理），则无问题。如果两者需要独立核算，应在配置文件中增加独立的 `nodeRewardAllocationAddress` 字段。

### ⚠️ 问题 3: 配置文件中缺少独立的 nodeRewardAllocationAddress

`ae-deployment-config.json` 中没有专门的节点奖励分配地址字段。脚本通过注释说明复用了 `buyTaxNodeRewardAddress`，但配置文件层面不够清晰。

**建议:** 在配置文件中显式添加:

```json
{
  "addresses": {
    "nodeRewardAllocationAddress": "0x06Ba6DA5d1942DA184ad3E521bC51dfF32D721d9"
  }
}
```

即使值相同，也能让配置意图更明确。

### ⚠️ 问题 4: 初始价格设定

流动性添加参数:
- 60,000,000 AE : 60,000 USDX
- 初始价格: 1 AE = 0.001 USDX

这个价格是否符合预期需要确认。价格极低意味着:
- 用户用 1 USDX 可买约 1000 AE
- 总市值约 100,000 USDX (约 $100,000)

### ⚠️ 问题 5: Staking 合约的 setLiquidityStaking 未调用

Staking 合约中可能存在 `setLiquidityStaking` 函数用于关联流动性质押合约。当前脚本只在 AE 合约上调用了 `setLiquidityStaking`，但未检查 Staking 合约是否也需要此配置。

如果 Staking 合约需要知道 LiquidityStaking 地址（例如用于奖励分配），则需要补充调用。

### 🟢 信息: presale 仍为激活状态

部署完成后 presale 默认激活。脚本已在末尾打印提醒，但不会自动关闭。

运营者需要在准备开放交易时手动执行:

```javascript
await ae.setPresaleActive(false);
```

或等待 presaleDuration 自然到期。

---

## 六、部署顺序依赖关系

```
Staking.deploy()
    ↓
AE.deploy(staking)  ← 需要 Staking 地址
    ↓
ae.initializeWhitelist()
    ↓
staking.setAE(ae)  ← 双向关联
    ↓
factory.createPair(ae, usdx)
    ↓
ae.setPair(pair)
    ↓
ae.transfer(staking, 20M)  ← 质押储备
    ↓
[设置 USDX 余额]
    ↓
approve + addLiquidity  ← 60M AE + 60K USDX
    ↓
LiquidityStaking.deploy(usdx, ae, pair, staking, marketing, admin, router)
    ↓
ae.setLiquidityStaking(liquidityStaking)
    ↓
FundRelay.deploy(ae, usdx, deployer)
    ↓
ae.setFundRelay(fundRelay)
    ↓
ae.transfer(nodeReward, 18.74M)
    ↓
ae.transfer(crossChain, 1.26M)
```

依赖关系正确，部署顺序合理。

---

## 七、转账免税验证

所有部署期间的 AE 转账均由 deployer (owner) 发起，在步骤 3 `initializeWhitelist()` 中已被加入白名单:

| 操作 | from | to | 免税原因 |
|------|------|----|----------|
| 步骤 7: 质押储备 | deployer ✅ | staking | from 在白名单 |
| 步骤 10: 添加流动性 | deployer ✅ | Router/Pair | from 在白名单 |
| 步骤 15: 节点奖励 | deployer ✅ | nodeReward | from 在白名单 |
| 步骤 16: 跨链储备 | deployer ✅ | crossChain | from 在白名单 |

全部免税，无问题。

---

## 八、总结

### 第一版问题修复率: 5/6 (83%)

| 原问题 | 状态 |
|--------|------|
| deployer 余额为 0 (分配不明确) | ✅ 已通过新增节点奖励+跨链储备分配解决 |
| 主网环境判断 | ✅ 已增加 localhost/hardhat 判断 |
| 流动性滑点保护 | ✅ 已增加 1% 滑点保护 |
| presale 状态管理 | ⚠️ 建议脚本直接调用 `setPresaleActive(false)` 关闭 |
| 缺少配置步骤 | ✅ setLiquidityStaking + setFundRelay 已配置 |
| 部署信息不完整 | ✅ 已补全地址字段 |

### 当前遗留问题

| 优先级 | 问题 | 说明 |
|--------|------|------|
| 🟡 中 | presale 未自动关闭 | 建议脚本直接调用 `setPresaleActive(false)` |
| 🟡 中 | NODE_REWARD_ADDRESS 复用 | 两种用途资金混入同一地址，需确认是否有意 |
| 🟢 低 | LP 销毁缺少确认 | 不可逆操作，建议主网增加确认 |
| 🟢 低 | 配置文件字段不够显式 | nodeRewardAllocationAddress 缺失 |
| 🟢 低 | 初始价格需确认 | 1 AE = 0.001 USDX |

**整体评价:** 脚本已大幅改进，第一版大部分问题已修复。部署流程完整，合约间依赖关系正确，代币分配 100% 覆盖。建议在脚本中直接关闭 presale 以避免部署后手动操作。可用于本地测试部署，主网部署前建议确认上述遗留问题。
