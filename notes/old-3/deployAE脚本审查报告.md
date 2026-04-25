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
| 10 | 添加流动性 | ✅ 正确 |
| 11 | 部署 LiquidityStaking 合约 | ✅ 正确 |
| 12 | AE.setLiquidityStaking() | ✅ 正确 |
| 13 | 部署 FundRelay 合约 | ✅ 正确 |
| 14 | AE.setFundRelay() | ✅ 正确 |
| 15 | 转移节点奖励 | ✅ 正确 |
| 16 | 转移跨链储备 | ✅ 正确 |
| 17 | 验证部署 | ⚠️ 信息不完整 |

---

## 问题详情

### ~~问题 1: LP 代币发送到 address(0) — 已撤回~~

> **更正说明:** 经核实，此问题判断有误，已撤回。
>
> UniswapV2Pair 继承的是自己实现的 `UniswapV2ERC20`，其 `_mint` 函数**没有**零地址校验：
>
> ```solidity
> // UniswapV2ERC20._mint — 无 address(0) 检查
> function _mint(address to, uint value) internal {
>     totalSupply = totalSupply.add(value);
>     balanceOf[to] = balanceOf[to].add(value);
>     emit Transfer(address(0), to, value);
> }
> ```
>
> 事实上，Pair 合约在首次添加流动性时自己就会调用 `_mint(address(0), MINIMUM_LIQUIDITY)` 来永久锁定最小流动性。
> 所以 LP 代币发送到 `address(0)` **不会 revert**，脚本中的写法是可行的。
>
> 注意：这与 OpenZeppelin 的 ERC20 不同，OpenZeppelin 的 `_mint` 有 `require(account != address(0))` 校验。
> UniswapV2/PancakeSwap V2 用的是自己的简化版 ERC20 实现，没有这个限制。

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

#### 背景

AE 合约（`AEBase.sol`）内置了一个 presale（预售）机制，用于在代币刚部署后的一段时间内**禁止用户从交易对买入 AE**。

相关状态变量（`AEBase.sol:237-239`）：

```solidity
uint256 public presaleStartTime;   // presale 开始时间
uint256 public presaleDuration;    // presale 持续时长
bool public presaleActive;         // presale 是否激活
```

#### presale 的具体限制

在 `_handleBuy` 函数（`AEBase.sol:737-742`）中，有如下判断：

```solidity
if (
    presaleActive &&
    block.timestamp < presaleStartTime + presaleDuration
) {
    revert NotAllowedBuy();
}
```

也就是说，当同时满足以下两个条件时，**所有买入交易都会被 revert**：

1. `presaleActive == true`（presale 开关处于开启状态）
2. 当前时间还在 presale 窗口期内（`block.timestamp < presaleStartTime + presaleDuration`）

注意：presale 期间**只限制买入，不限制卖出**。

#### 当前的问题

AE 合约构造函数中（`AEBase.sol:321-324`）：

```solidity
contractDeployTime = block.timestamp;
presaleStartTime = block.timestamp;          // 从部署那一刻开始计时
presaleDuration = getPresaleDuration();      // 从 Staking 合约获取时长
presaleActive = true;                        // 默认开启
```

合约部署后 `presaleActive` 默认为 `true`，`presaleStartTime` 为部署时间。这意味着：

- 部署完成后，在 `presaleDuration` 时间窗口内，**用户无法通过 PancakeSwap 买入 AE**
- 如果 `presaleDuration` 较长，交易对虽然已创建且有流动性，但用户买入会一直失败（revert `NotAllowedBuy`）
- 部署脚本中**没有任何步骤**处理这个状态

#### 如何解除 presale 限制

owner 可以调用 `setPresaleActive(false)`（`AEBase.sol:433-441`）来关闭 presale：

```javascript
await ae.setPresaleActive(false);
```

也可以不手动关闭，等 `presaleDuration` 自然到期后，即使 `presaleActive` 仍为 `true`，由于 `block.timestamp >= presaleStartTime + presaleDuration`，买入也不会被阻止。

#### 建议

在部署脚本中增加明确的处理，二选一：

1. 如果不需要 presale 窗口期，在部署完成后直接关闭：
   ```javascript
   console.log("=== 步骤 14: 关闭 presale 限制 ===");
   await ae.setPresaleActive(false);
   ```

2. 如果需要保留 presale 窗口期，至少在脚本末尾打印提醒信息：
   ```javascript
   const presaleStatus = await ae.getPresaleStatus();
   console.log("⚠️ presale 当前处于激活状态，买入交易将被阻止");
   console.log("  剩余时间:", presaleStatus.remainingTime.toString(), "秒");
   console.log("  如需立即开放交易，请执行: ae.setPresaleActive(false)");
   ```

---

### ⚠️ 问题 6: 缺少可选配置步骤

AE 合约中有三个 setter 函数在部署脚本中未被调用。这些函数设置的地址会被合约内部的手续费分配逻辑所依赖。下面逐一说明：

#### 6.1 `setLiquidityStaking(address)` — 流动性质押合约地址

**函数位置:** `AEBase.sol:360-364`

```solidity
function setLiquidityStaking(address _liquidityStaking) external onlyOwner {
    if (_liquidityStaking == address(0)) revert ZeroAddress();
    liquidityStaking = ILiquidityStaking(_liquidityStaking);
    feeWhitelisted[_liquidityStaking] = true;
}
```

**这个地址在哪里被使用：**

- `_processFeeDistribution()`（`AEBase.sol:1350`）中调用 `liquidityStaking.depositBLARewards(totalLPFee)` — 将累积的 BLA 代币奖励存入流动性质押合约
- `_processFundRelayFees()`（`AEBase.sol:1531`）中调用 `liquidityStaking.depositRewards(lpShare)` — 将 USDX 奖励存入流动性质押合约

**如果不设置会怎样：**

`liquidityStaking` 默认为 `address(0)`。当交易触发手续费分配逻辑时，代码会尝试在零地址上调用 `depositBLARewards()` 或 `depositRewards()`，这会导致交易 revert。也就是说，**一旦手续费累积触发分配，相关交易会失败**。

**严重程度：🟡 中** — 不影响初始部署，但在正式运营（有用户交易产生手续费）之前必须设置，否则手续费分配会导致交易失败。

---

#### ~~6.2 `setFundRelay(address)` — 资金中继合约地址 — 已解决~~

> **已在部署脚本中配置。** `deployAE.js` 步骤 13 部署 FundRelay 合约，步骤 14 调用 `ae.setFundRelay()`。
>
> - FundRelay 构造参数：AE 合约地址、USDX 地址、deployer 地址（紧急提取人）
> - `setFundRelay()` 会同时将 FundRelay 加入手续费白名单

---

#### 6.3 `setNodeDividendAddress(address)` — 节点分红地址

**函数位置:** `AEBase.sol:380-383`

```solidity
function setNodeDividendAddress(address _node) external onlyOwner {
    if (_node == address(0)) revert ZeroAddress();
    nodeDividendAddress = _node;
}
```

**这个地址在哪里被使用：**

经过全代码搜索，`nodeDividendAddress` 变量在声明和 setter 之外**没有被任何逻辑引用**。它是一个只写不读的状态变量。

**如果不设置会怎样：**

**没有任何影响。** 这个变量目前是死代码，可能是预留给未来功能的，也可能是重构后遗留的。

**严重程度：🟢 低** — 纯粹的预留字段，不影响任何功能。

---

#### 总结

| 函数 | 不设置的后果 | 何时必须设置 |
|------|-------------|-------------|
| `setLiquidityStaking` | ~~手续费分配时交易 revert~~ | ✅ 已在脚本中配置 |
| `setFundRelay` | ~~手续费 swap/分配流程不完整~~ | ✅ 已在脚本中配置 |
| `setNodeDividendAddress` | 无影响（未被使用） | 不需要 |

**建议：** ~~`setLiquidityStaking` 和 `setFundRelay` 应在部署脚本中增加步骤~~ — 两者均已在部署脚本中配置完成。

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
| 🟡 中 | deployer 余额为 0 | 后续无法分配 |
| 🟡 中 | 主网部署缺少环境判断 | 主网部署失败 |
| 🟡 中 | 流动性滑点保护为 0 | 主网安全风险 |
| 🟢 低 | 缺少 presale 状态管理 | 需手动处理 |
| ~~🟢 低~~ | ~~缺少可选配置步骤~~ | ✅ setLiquidityStaking/setFundRelay 已在脚本中配置 |
| 🟢 低 | 部署信息不完整 | 记录缺失 |
