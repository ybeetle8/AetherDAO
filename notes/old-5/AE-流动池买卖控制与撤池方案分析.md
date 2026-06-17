# AE 流动池买卖控制与撤池方案分析

## 背景

主网部署参数（ae-mainnet-deployment_主网发布.json）：

| 合约 | 地址 |
|------|------|
| AE 代币 | `0x01edd7445DF0e9c2064c77Df150BE9FC793C828b` |
| Pair (AE/USDC) | `0x526bb930F25C8976290c01CEF775249373343132` |
| Staking | `0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3` |
| LiquidityStaking | `0xAc846586b990dADD1d15Fe62E17256DDc3d1F955` |
| FundRelay | `0x51c3b399B13441f855A3C93493fEF9fc07189Ed3` |
| PancakeSwap Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| 部署者 | `0xB138e42B76ad0E6F21E715578F34F2Cf2285eE76` |

---

## 需求一：允许卖出 AE，禁止买入 AE

### 目标

在 PancakeSwap 流动池上，允许二级市场地址（普通用户）卖出 AE 换取 USDC，但禁止任何人从池子买入 AE。

### 现有机制分析

AE 合约（AEBase.sol）中已有一个 **预售开关（presaleActive）** 完全满足此需求：

```
位置：contracts/AE/src/abstract/AEBase.sol
控制函数：setPresaleActive(bool _active)  — 第 427 行
买入拦截：_handleBuy() 内部检查 — 第 736-741 行
```

**工作原理：**

1. `_update()` 函数（第 644 行）拦截所有 transfer，判断是买入还是卖出
2. 如果是买入（`_isBuyOperation` 返回 true），调用 `_handleBuy()`
3. `_handleBuy()` 第一步检查 `presaleActive`，若为 true 直接 revert `NotAllowedBuy()`
4. 如果是卖出（`_isSellOperation` 返回 true），调用 `_handleSell()`，**不检查 presaleActive**

**状态对照表：**

| 操作 | presaleActive = true | presaleActive = false |
|------|---------------------|----------------------|
| DEX 买入 AE | 拦截 (revert) | 正常（收 3% 买入税）|
| DEX 卖出 AE | 正常（收 3% 卖出税 + 盈利税）| 正常 |
| 钱包间转账 | 正常 | 正常 |
| 质押/解押 | 正常 | 正常 |

### 操作方案

**开启禁买（允许卖、禁止买）：**

```bash
# 调用 AE 合约的 setPresaleActive(true)
# 使用已有脚本：
npx hardhat run scripts/startPresale.js --network bsc
```

**关闭禁买（恢复正常买卖）：**

```bash
# 调用 AE 合约的 setPresaleActive(false)
npx hardhat run scripts/stopPresale.js --network bsc
# 或者：
npx hardhat run scripts/openTrading.js --network bsc
```

### 注意事项

1. **只有 Owner 可操作** — `setPresaleActive` 有 `onlyOwner` 限制，需用部署者钱包调用
2. **presaleStartTime 会重置** — 每次开启 presale 会重新设置 `presaleStartTime = block.timestamp` 和 `presaleDuration`（30 天）
3. **presaleDuration 的作用** — 买入拦截条件是 `presaleActive && block.timestamp < presaleStartTime + presaleDuration`。这意味着即使 presaleActive 为 true，超过 30 天后买入限制会自动失效。如需长期禁买，需在到期前重新调用 `setPresaleActive(true)`
4. **对质押收益提取的影响** — 预售期间没有买盘，合约内部需要把 AE 兑换成 USDX 的操作（如 FundRelay 分发）可能受到影响
5. **delayedBuy 机制** — 另一个备选方案，开启后非白名单用户在指定延迟期（30天）内无法买入。但白名单用户仍可买入，不如 presale 开关彻底

### 推荐方案

**直接使用 presaleActive 开关**，这是最简单、最安全的方案：
- 不需要修改合约代码
- 不需要重新部署
- 已有现成脚本
- 经过生产环境验证

---

## 需求二：撤池子功能分析

### LP 代币归属现状

根据部署配置 `deployment.burnLP = true`：

| LP 来源 | LP 代币去向 | 能否撤回 |
|---------|-----------|---------|
| 初始流动性（6000 万 AE + 6 万 USDC）| `address(0)` 零地址（永久销毁）| 不能 |
| 合约自动注入（盈利税 60% 部分）| `0x...dEaD` 死亡地址（永久销毁）| 不能 |
| 用户手动添加的流动性 | 用户自己的钱包 | 可以 |
| 用户质押到 LiquidityStaking 的 LP | LiquidityStaking 合约代持 | 可以（解押后撤）|

### 关键结论：项目方无法撤池子

初始流动性的 LP 代币在部署时直接发送到了零地址（`address(0)`），已经永久销毁。没有任何人、任何合约可以使用这些 LP 代币来撤回流动性。

### 用户撤回自己流动性的流程

如果用户自行在 PancakeSwap 添加了流动性，撤回流程如下：

#### 情况 A：LP 代币在用户钱包中

1. 打开 PancakeSwap → Liquidity → 找到 AE/USDC 对
2. 点击 Remove → 选择要撤回的比例
3. 确认交易，按比例取回 AE 和 USDC

#### 情况 B：LP 代币质押在 LiquidityStaking 合约中

1. **先解押** — 调用 `LiquidityStaking.unstake(amount)`
   - 要求已过最短锁定期（24 小时）
   - 自动领取待发放的 USDT 奖励
   - LP 代币返回到用户钱包
2. **再去 PancakeSwap 撤回流动性**（同情况 A）

#### LiquidityStaking 合约的解押检查

```
位置：contracts/LiquidityStaking/src/abstract/LiquidityStakingBase.sol
函数：unstake(uint256 amount) — 第 180 行
```

解押条件：
- `userStake.amount > 0` — 有质押记录
- `amount > 0 && amount <= userStake.amount` — 金额合法
- `block.timestamp >= userStake.stakeTime + getMinStakeDuration()` — 已过最短锁定期（24h）

满足条件后，合约将 LP 代币直接 transfer 给用户，同时自动发放 USDT 奖励。

### AE 合约中的流动性操作费用

AE 合约的 `_update()` 函数不会对「添加/移除流动性」操作收取交易税。因为：

- `_isBuyOperation` 要求 `from == pair && msg.sender == pair`
- `_isSellOperation` 要求 `to == pair && msg.sender != pair`
- 添加流动性时 `msg.sender == router`，不满足买入条件
- 移除流动性时 `msg.sender == pair`（pair 直接 transfer），不满足卖出条件

但 AEBase.sol 中有一个 `_handleLiquidityOperation`（第 678 行），对流动性操作收取 **2.5%（LP_HANDLE_FEE = 250 基点）** 的手续费，发送给 `marketingAddress`。

**注意：** 需要确认当前 `_update()` 流程中是否实际调用了 `_handleLiquidityOperation`。从当前代码逻辑看，如果交易既不是买也不是卖，且不在白名单中，走的是普通 transfer 路径（第 673 行 `super._update`），`_handleLiquidityOperation` 可能是预留函数但未在主流程中启用。

### 撤池子总结

| 问题 | 结论 |
|------|------|
| 项目方能否撤回初始流动性？| 不能。LP 已销毁到零地址 |
| 用户能否撤回自己添加的流动性？| 能。LP 在自己钱包中，随时可操作 |
| 质押中的 LP 能否撤回？| 能。过 24h 锁定期后解押，然后去 PancakeSwap 撤回 |
| 撤回时是否需要开放交易？| 不需要。移除流动性不受 presaleActive 限制 |
| 撤回是否收取额外费用？| PancakeSwap 本身不收费。AE 合约对非白名单地址的流动性操作可能收取 2.5% 手续费（需验证） |

---

## 操作建议

### 执行顺序

1. **先开启禁买** — `npx hardhat run scripts/startPresale.js --network bsc`
2. **确认效果** — 在 PancakeSwap 上尝试买入 AE，应该会失败
3. **验证卖出正常** — 用测试地址尝试卖出少量 AE，应该成功
4. **如需恢复** — `npx hardhat run scripts/stopPresale.js --network bsc`

### 风险点

1. **30 天自动失效** — presale 开启后 30 天自动解除买入限制，需要手动续期
2. **FundRelay/合约内部交换** — 预售期间合约内部的 AE↔USDX 交换可能受影响，需监控
3. **LP_HANDLE_FEE** — 用户撤回流动性时可能被收取 2.5% 手续费，需确认 `_handleLiquidityOperation` 是否在主流程中被调用
