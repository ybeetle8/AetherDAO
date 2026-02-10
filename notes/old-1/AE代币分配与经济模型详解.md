# AE 代币分配与经济模型详解

## 一、代币总量概览

根据配置文件 `ae-deployment-config.json` 和部署脚本 `scripts/deployAE.js`，AE 代币的总量和分配如下：

### 1.1 总供应量
- **总发行量**: 10,000,000 AE (1千万枚)
- **代币标准**: ERC20
- **小数位数**: 18
- **合约位置**: `contracts/AE/src/mainnet/AE.sol`

### 1.2 初始铸造
在 AE 代币合约的构造函数中（通过 `AEBase` 基类），所有代币一次性铸造给部署者地址：

```solidity
// 位置: contracts/AE/src/abstract/AEBase.sol
constructor(...) {
    _mint(msg.sender, TOTAL_SUPPLY); // 铸造 10,000,000 AE 给部署者
}
```

## 二、代币分配方案

部署完成后，10,000,000 AE 代币按以下方式分配到不同地址：

### 2.1 分配明细表

| 接收方 | 数量 (AE) | 占比 | 用途 | 部署步骤 |
|--------|-----------|------|------|----------|
| **质押合约** | 1,500,000 | 15% | 质押奖励储备金 | 步骤 7 |
| **流动性池** | 4,000,000 | 40% | DEX 初始流动性 | 步骤 10 |
| **测试钱包** | 100,000 | 1% | 测试和演示用途 | 步骤 11 |
| **部署者** | 4,400,000 | 44% | 剩余代币（待分配） | 初始铸造后剩余 |
| **合计** | 10,000,000 | 100% | - | - |

### 2.2 详细分配流程

#### 步骤 1-2: 合约部署
```javascript
// 部署质押合约
const staking = await Staking.deploy(USDC_ADDRESS, ROUTER_ADDRESS, ROOT_ADDRESS, FEE_RECIPIENT);

// 部署 AE 代币合约（同时铸造全部 10,000,000 AE 给部署者）
const ae = await AE.deploy(USDC_ADDRESS, ROUTER_ADDRESS, stakingAddress, MARKETING_ADDRESS);
```

**结果**: 部署者持有 10,000,000 AE

---

#### 步骤 7: 质押储备金转移
```javascript
// scripts/deployAE.js:89
await ae.transfer(stakingAddress, STAKING_RESERVE); // 1,500,000 AE
```

**用途**:
- 用于支付用户质押奖励
- 当用户解除质押时，合约将 AE 兑换成 USDT 支付给用户
- 储备金通过 `recycle()` 机制循环使用

**部署者剩余**: 8,500,000 AE

---

#### 步骤 10: 添加初始流动性
```javascript
// scripts/deployAE.js:147-157
await router.addLiquidity(
    aeAddress,
    USDC_ADDRESS,
    INITIAL_LIQUIDITY_AE,    // 4,000,000 AE
    INITIAL_LIQUIDITY_USDC,  // 40,000 USDC
    0, 0,
    lpRecipient,  // address(0) 表示销毁 LP 代币
    deadline
);
```

**用途**:
- 在 PancakeSwap 创建 AE/USDC 交易对
- 初始价格: 1 AE = 0.01 USDC (1 USDC = 100 AE)
- LP 代币发送至: `address(0)` (永久销毁，无法撤池)

**配置参数**:
- `config.deployment.burnLP = true` → LP 代币销毁
- `config.deployment.burnLP = false` → LP 代币发送给部署者

**部署者剩余**: 4,500,000 AE

---

#### 步骤 11: 测试钱包分配
```javascript
// scripts/deployAE.js:165
await ae.transfer(testWallet.address, TEST_WALLET_ALLOCATION); // 100,000 AE
```

**用途**:
- 用于测试交易、质押等功能
- 测试钱包索引: `accounts[9]` (第10个账户)

**部署者最终剩余**: 4,400,000 AE

---

## 三、配套资产配置

### 3.1 USDC 配置
```javascript
// scripts/deployAE.js:99-128
// 通过 hardhat_setStorageAt 为部署者设置 40,000 USDC
```

**用途**: 与 4,000,000 AE 配对添加流动性

### 3.2 关键地址配置

| 地址类型 | 配置位置 | 用途 |
|---------|---------|------|
| **marketingAddress** | `config.addresses.marketingAddress` | AE 代币的营销费用接收地址 |
| **rootAddress** | `config.addresses.rootAddress` | 推荐系统的根地址 |
| **feeRecipient** | `config.addresses.feeRecipient` | 质押合约的赎回费用接收地址 (1%) |

---

## 四、代币用途详解

### 4.1 质押储备金 (1,500,000 AE)

**工作机制**:
1. 用户质押 USDT → 获得 sAE (质押凭证)
2. 质押期满后解除质押 → 合约将 AE 兑换成 USDT 支付奖励
3. 使用的 AE 通过 `recycle()` 函数回收到储备金

**关键代码**:
```solidity
// contracts/AE-Staking/src/abstract/StakingBase.sol:261
AE.recycle(aeTokensUsed); // 回收使用的 AE
```

**储备金充足性**:
- 初始储备: 1,500,000 AE
- 占总量: 15%
- 循环使用机制确保长期可持续性

---

### 4.2 流动性池 (4,000,000 AE)

**交易对信息**:
- **DEX**: PancakeSwap V2
- **交易对**: AE/USDC
- **初始比例**: 4,000,000 AE : 40,000 USDC
- **初始价格**: 1 AE = 0.01 USDC
- **LP 代币**: 已销毁 (burnLP = true)

**重要性**:
- 提供交易流动性
- 确定 AE 市场价格
- 支持质押合约的 AE ↔ USDT 兑换

**LP 销毁的影响**:
- ✅ 优点: 流动性永久锁定，防止 rug pull
- ⚠️ 注意: 无法调整流动性，价格完全由市场决定

---

### 4.3 测试钱包 (100,000 AE)

**用途**:
- 测试买卖交易
- 测试质押功能
- 演示推荐系统
- 压力测试

**获取方式**:
```javascript
const testWallet = accounts[9]; // 第10个账户
```

---

### 4.4 部署者持有 (4,400,000 AE)

**占比**: 44% (最大持有方)

**可能用途**:
- 团队储备
- 市场营销活动
- 生态系统激励
- 未来开发资金
- CEX 上币流动性

**风险提示**:
- 部署者持有大量代币，需要透明的锁仓或释放计划
- 建议使用多签钱包或时间锁合约管理

---

## 五、参数修改指南

### 5.1 配置文件参数

**文件位置**: `ae-deployment-config.json`

```json
{
  "tokenomics": {
    "totalSupply": "10000000",           // 总供应量
    "stakingReserve": "1500000",         // 质押储备金
    "initialLiquidity": {
      "ae": "4000000",                   // 流动性池 AE 数量
      "usdt": "40000"                    // 流动性池 USDC 数量
    },
    "testWalletAllocation": "100000"     // 测试钱包分配
  },
  "deployment": {
    "burnLP": true,                      // 是否销毁 LP 代币
    "testWalletIndex": 9                 // 测试钱包账户索引
  }
}
```

**修改步骤**:
1. 编辑 `ae-deployment-config.json`
2. 确保总和不超过 `totalSupply`
3. 重新运行部署脚本

**数量约束**:
```
stakingReserve + initialLiquidity.ae + testWalletAllocation ≤ totalSupply
```

---

### 5.2 合约硬编码参数

#### AE 代币合约
**文件**: `contracts/AE/src/abstract/AEBase.sol`

```solidity
uint256 private constant TOTAL_SUPPLY = 10_000_000 ether; // 总供应量
```

**修改方法**:
- 修改常量值
- 重新编译: `npx hardhat compile`
- 重新部署

---

#### 质押合约参数
**文件**: `contracts/AE-Staking/src/abstract/StakingBase.sol`

```solidity
// 质押限制
uint256 internal constant MAX_STAKE_LIMIT = 1000 ether;        // 单次质押上限
uint256 internal constant MAX_USER_TOTAL_STAKE = 10000 ether;  // 用户总质押上限

// 推荐奖励
uint256 internal constant REFERRAL_REWARD_RATE = 5;  // 好友奖励 5%

// 赎回费用
uint256 public constant REDEMPTION_FEE_RATE = 100;   // 赎回费用 1% (100 basis points)
```

**修改方法**:
1. 修改常量值
2. 重新编译合约
3. 重新部署整个系统

---

### 5.3 地址配置

**文件**: `ae-deployment-config.json`

```json
{
  "addresses": {
    "usdt": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",      // BSC USDC 地址
    "pancakeRouter": "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    "pancakeFactory": "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    "marketingAddress": "0x1234567890123456789012345678901234567890",  // 营销地址
    "rootAddress": "0x2345678901234567890123456789012345678901",       // 根地址
    "feeRecipient": "0x3456789012345678901234567890123456789012"       // 费用接收地址
  }
}
```

**重要提示**:
- `marketingAddress`: 接收 AE 代币交易的营销费用
- `rootAddress`: 推荐系统的根节点，接收无推荐人用户的奖励
- `feeRecipient`: 接收质押赎回的 1% 手续费

---

## 六、经济模型分析

### 6.1 代币流通机制

```
┌─────────────────────────────────────────────────────────────┐
│                     AE 代币流通图                            │
└─────────────────────────────────────────────────────────────┘

部署者 (4,400,000 AE)
    │
    ├──→ 质押合约 (1,500,000 AE) ──→ 用户质押奖励 ──→ recycle() ──┐
    │                                                              │
    ├──→ 流动性池 (4,000,000 AE) ←──→ DEX 交易 ←──→ 用户买卖      │
    │                                      ↑                       │
    └──→ 测试钱包 (100,000 AE)             │                       │
                                           │                       │
                                    质押合约兑换 ←─────────────────┘
```

### 6.2 价格影响因素

1. **初始价格**: 0.01 USDC/AE (由流动性池比例决定)
2. **买入压力**:
   - 用户看好项目买入
   - 质押合约买入 AE (用户质押时)
3. **卖出压力**:
   - 部署者抛售
   - 质押合约卖出 AE (用户解除质押时)
   - 早期投资者获利了结

### 6.3 通缩机制

**交易费用** (在 AEBase 合约中):
- 买入费用: 3% (0.5% 销毁 + 2.5% 添加流动性)
- 卖出费用: 3% (0.5% 销毁 + 2.5% 添加流动性)

**效果**: 每次交易都会销毁部分代币，实现通缩

---

## 七、风险提示

### 7.1 中心化风险
- ⚠️ 部署者持有 44% 代币
- ⚠️ 部署者可以调用 `emergencyWithdrawAE()` 提取质押合约的 AE
- ⚠️ 部署者可以修改 `feeRecipient` 地址

### 7.2 流动性风险
- ✅ LP 代币已销毁，流动性永久锁定
- ⚠️ 但初始流动性可能不足以支撑大额交易

### 7.3 质押储备金风险
- 储备金: 1,500,000 AE (15%)
- 如果大量用户同时解除质押，储备金可能不足
- 依赖 `recycle()` 机制的有效性

---

## 八、部署验证

部署完成后，可以通过以下方式验证分配：

```javascript
// 查看部署信息
cat ae-deployment.json

// 预期输出
{
  "balances": {
    "deployer": "4400000.0",      // 44%
    "staking": "1500000.0",       // 15%
    "liquidityPool": "4000000.0", // 40%
    "testWallet": "100000.0"      // 1%
  }
}
```

---

## 九、总结

### 9.1 代币分配合理性

| 分配项 | 数量 | 占比 | 评价 |
|--------|------|------|------|
| 流动性池 | 4,000,000 | 40% | ✅ 充足，支持交易 |
| 部署者 | 4,400,000 | 44% | ⚠️ 过高，需要锁仓计划 |
| 质押储备 | 1,500,000 | 15% | ✅ 合理，配合循环机制 |
| 测试钱包 | 100,000 | 1% | ✅ 适量 |

### 9.2 建议优化

1. **部署者代币管理**:
   - 使用时间锁合约锁定部分代币
   - 制定透明的释放计划
   - 使用多签钱包管理

2. **质押储备金**:
   - 监控储备金使用情况
   - 设置储备金预警机制
   - 考虑动态调整质押上限

3. **流动性管理**:
   - 考虑在其他 DEX 添加流动性
   - 监控价格波动
   - 准备应对极端市场情况

---

## 十、快速参考

### 10.1 关键文件
- 配置文件: `ae-deployment-config.json`
- 部署脚本: `scripts/deployAE.js`
- AE 合约: `contracts/AE/src/mainnet/AE.sol`
- 质押合约: `contracts/AE-Staking/src/mainnet/Staking.sol`

### 10.2 关键命令
```bash
# 编译合约
npx hardhat compile

# 部署系统
npx hardhat run scripts/deployAE.js --network localhost

# 查看部署结果
cat ae-deployment.json
```

### 10.3 关键常量
- 总供应量: 10,000,000 AE
- 初始价格: 0.01 USDC/AE
- 单次质押上限: 1,000 AE
- 用户总质押上限: 10,000 AE
- 赎回费用: 1%
- 推荐奖励: 5%
