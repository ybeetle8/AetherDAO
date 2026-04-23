# deployAE.js 部署脚本审查报告

## 概述

对 `scripts/deployAE.js` 部署脚本与合约代码进行交叉审查，验证部署流程的正确性和完整性。

## 部署流程总览

| 步骤 | 操作 | 状态 |
|------|------|------|
| 1 | 部署 Staking 合约 | ✅ 正确 |
| 2 | 部署 AE 代币合约 | ✅ 正确 |
| 3 | 初始化白名单 | ✅ 正确 |
| 4 | Staking.setAE() | ✅ 正确 |
| 5 | 创建交易对 | ✅ 正确 |
| 6 | AE.setPair() | ✅ 正确 |
| 7 | 转移质押储备金 | ✅ 正确 |
| 8 | 设置 USDX 余额 | ⚠️ 仅限本地 |
| 9 | 授权 Router | ✅ 正确 |
| 10 | 添加流动性 | ❌ LP 销毁会 revert |
| 11 | 转移节点奖励 | ✅ 正确 |
| 12 | 转移跨链储备 | ✅ 正确 |
| 13 | 验证部署 | ⚠️ 信息不完整 |

---

## 问题详情

### ❌ 问题 1: LP 代币发送到 address(0) 会 revert

**位置:** `deployAE.js:156-167`

```javascript
const lpRecipient = config.deployment.burnLP ? hre.ethers.ZeroAddress : deployer.address;
```

当 `burnLP: true` 时，LP 代币接收者为 `address(0)`。但 PancakeSwap V2 的 Pair 合约在 `mint()` 函数中会校验 `to != address(0)`，导致整个 `addLiquidity` 交易 revert。

**修复方案:** 将 LP 销毁地址改为 dead 地址：

```javascript
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const lpRecipient = config.deployment.burnLP ? DEAD_ADDRESS : deployer.address;
```

---

### ⚠️ 问题 2: 代币分配后 deployer 余额为 0

**配置文件中的分配:**

| 用途 | 数量 | 占比 |
|------|------|------|
| 质押储备 | 20,000,000 AE | 20% |
| 流动性池 | 60,000,000 AE | 60% |
| 节点奖励 | 18,740,000 AE | 18.74% |
| 跨链储备 | 1,260,000 AE | 1.26% |
| **合计** | **100,000,000 AE** | **100%** |

总供应量 1 亿 AE 全部分配完毕，deployer 最终余额为 0。但步骤 13 的验证表格中写着"部署者 (剩余) - 待分配 (团队、营销、生态等)"，与实际情况矛盾。

**需确认:** 这是否是预期行为？如果后续需要团队/营销/生态分配，需要调整各项分配比例预留额度。

---

### ⚠️ 问题 3: hardhat_setStorageAt 仅适用于本地测试网络

**位置:** `deployAE.js:106-144`

步骤 8 使用 `hardhat_setStorageAt` 为 deployer 设置 USDX 余额，这是 Hardhat 专有的 RPC 方法，仅在本地 fork 网络上有效。

- 部署到 BSC 主网时此段代码会直接失败
- 脚本没有区分本地/主网环境
- 主网部署前需确保 deployer 已持有足够的 USDX（60,000 USDX）

**建议:** 增加网络判断逻辑：

```javascript
if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
  // hardhat_setStorageAt 设置余额...
} else {
  // 主网: 检查 deployer 已有余额是否足够
  const balance = await usdx.balanceOf(deployer.address);
  if (balance < INITIAL_LIQUIDITY_USDX) {
    throw new Error(`USDX 余额不足: ${hre.ethers.formatEther(balance)}`);
  }
}
```

---

### ⚠️ 问题 4: 添加流动性滑点保护为 0

**位置:** `deployAE.js:163-164`

```javascript
0, // amountAMin
0, // amountBMin
```

`amountAMin` 和 `amountBMin` 均为 0，意味着没有滑点保护。本地测试环境无影响，但主网部署时存在被三明治攻击的风险。

**建议:** 主网部署时设置合理的最小值（如 99%）：

```javascript
const slippage = 99n; // 1% 滑点容忍
const amountAMin = INITIAL_LIQUIDITY_AE * slippage / 100n;
const amountBMin = INITIAL_LIQUIDITY_USDX * slippage / 100n;
```

---

### ⚠️ 问题 5: 缺少 presale 状态管理

AE 合约中 `presaleActive` 默认为 `true`，presale 模式下可能存在交易限制。部署脚本没有处理 presale 状态的切换。

部署完成后需要在合适的时机手动调用：

```javascript
await ae.setPresaleActive(false);
```

**建议:** 在脚本中增加此步骤，或至少加注释提醒。

---

### ⚠️ 问题 6: 缺少可选配置步骤

以下合约函数在部署脚本中未调用，如果后续需要可单独配置：

| 函数 | 用途 | 合约 |
|------|------|------|
| `setLiquidityStaking(address)` | 设置流动性质押合约 | AE |
| `setFundRelay(address)` | 设置资金中继合约 | AE |
| `setNodeDividendAddress(address)` | 设置节点分红地址 | AE |

这些不影响基础部署，但建议在脚本中加注释说明后续配置计划。

---

### ⚠️ 问题 7: 部署信息保存不完整

**位置:** `deployAE.js:246-280`

保存的 `deploymentInfo.addresses` 中缺少以下字段：

- `educationFundAddress` — 教育基金地址
- `nodeRewardAddress` — 节点奖励分配地址（Staking 使用）

---

## 转账免税验证

已验证所有 AE 转账操作的免税逻辑（`AEBase.sol:658-664`）：

| 操作 | from | to | 免税原因 |
|------|------|----|----------|
| 步骤 7: 转质押储备 | deployer ✅ | stakingAddress | from 在白名单 |
| 步骤 10: 添加流动性 | deployer ✅ | Router/Pair | from 在白名单 |
| 步骤 11: 转节点奖励 | deployer ✅ | NODE_REWARD | from 在白名单 |
| 步骤 12: 转跨链储备 | deployer ✅ | CROSS_CHAIN | from 在白名单 |

deployer 作为 owner 在步骤 3 `initializeWhitelist()` 中已被加入白名单，所有转账均免税，无问题。

---

## 优先级总结

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 🔴 高 | LP 销毁到 address(0) 会 revert | 部署流程中断 |
| 🟡 中 | deployer 余额为 0 | 后续无法分配 |
| 🟡 中 | 主网部署缺少环境判断 | 主网部署失败 |
| 🟡 中 | 流动性滑点保护为 0 | 主网安全风险 |
| 🟢 低 | 缺少 presale 状态管理 | 需手动处理 |
| 🟢 低 | 缺少可选配置步骤 | 后续补充即可 |
| 🟢 低 | 部署信息不完整 | 记录缺失 |
