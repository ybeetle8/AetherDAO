# LiquidityStaking（流动性质押）详解

## 一句话概括

LiquidityStaking 是一个独立合约，让用户把 AE/USDX 的 LP 代币质押进去，赚取 USDX 奖励。奖励来源是 AE 代币每笔卖出交易产生的手续费。

---

## 先搞清楚几个概念

### 什么是 LP 代币？

用户在 PancakeSwap 上为 AE/USDX 交易对添加流动性时，需要同时存入 AE 和 USDX 两种代币。作为回报，PancakeSwap 会给用户发一个 LP（Liquidity Provider）代币，代表你在这个池子里的份额。

简单说：**LP 代币 = 你在 AE/USDX 池子里的"存款凭证"**。

### 什么是流动性质押？

拿到 LP 代币后，用户可以选择把它质押到 LiquidityStaking 合约里。质押后，用户会按比例获得 USDX 奖励。

**为什么要这么设计？** 因为项目方希望鼓励用户持续提供流动性。如果没有足够的流动性，AE 代币在 PancakeSwap 上的交易滑点会很大，影响用户体验。通过给 LP 质押者发奖励，激励更多人提供流动性。

---

## 奖励从哪来？

奖励不是凭空产生的，来源是 AE 代币交易产生的手续费。具体有两条路径：

### 路径 1：卖出手续费中的 LP Fee 部分

每笔 AE 卖出交易会收取手续费，其中有一部分是 LP Fee（1.5%）。这些 AE 代币会累积在 AE 合约里，当累积量达到阈值（`swapAtAmount`，默认 10,000 AE）时触发分配：

```
用户卖出 AE
  ↓
收取 1.5% LP Fee（AE 代币）
  ↓
累积到阈值后触发 _processFeeDistribution()
  ↓
调用 liquidityStaking.depositBLARewards(totalLPFee)
把这些 AE 代币发送给 LiquidityStaking 合约
```

LiquidityStaking 收到 AE 后不会立刻分配，而是先累积起来（`accumulatedBLA`），等到有用户执行 stake/unstake/claimReward 操作时，再把累积的 AE 通过 PancakeSwap 换成 USDX，然后分配给质押者。

### 路径 2：FundRelay 手续费分配

FundRelay 合约中累积的手续费在处理时，会把 USDX 按比例分配，其中 40% 直接调用 `liquidityStaking.depositRewards(lpShare)` 存入 USDX 奖励。

```
FundRelay 中累积的手续费
  ↓
_processFundRelayFees() 处理
  ↓
AE → USDX（通过 FundRelay 中转 swap）
  ↓
USDX 分配：60% → 营销地址，40% → liquidityStaking.depositRewards()
```

---

## LiquidityStaking 合约内部机制

### 核心数据结构

```solidity
// 每个用户的质押信息
struct StakeInfo {
    uint256 amount;              // 质押的 LP 代币数量
    uint256 stakeTime;           // 首次质押时间
    uint256 lastRewardTime;      // 上次领取奖励时间
    uint256 accumulatedReward;   // 已累积的奖励总额
}

// 全局奖励池
struct RewardPool {
    uint256 totalRewards;        // 奖励池中的 USDX 总量
    uint256 rewardPerSecond;     // 每秒分配的 USDX 数量
    uint256 totalStaked;         // 所有用户质押的 LP 总量
    uint256 totalWeight;         // 所有用户的加权质押总量
    uint256 pendingRewards;      // 待分配的奖励
}
```

### 奖励分配方式

奖励按 **7 天周期** 线性释放：

```
depositRewards(1000 USDX) 被调用
  ↓
rewardPerSecond = 1000 / (7 * 24 * 3600) ≈ 0.00165 USDX/秒
  ↓
每秒按用户的加权质押比例分配
```

如果在 7 天内又有新的奖励存入，会把剩余未分配的奖励和新奖励合并，重新计算 `rewardPerSecond`。

### 加权质押机制

质押时间越长，权重越高：

```
权重 = 质押数量 × (1 + 质押天数 / 365)
```

举例：
- 用户 A 质押 100 LP，刚质押 → 权重 = 100 × 1.0 = 100
- 用户 B 质押 100 LP，已质押 182 天 → 权重 = 100 × 1.5 = 150

用户 B 虽然质押数量相同，但因为质押时间更长，获得的奖励比例更高。这鼓励用户长期质押。

### 用户可执行的操作

| 操作 | 说明 | 限制 |
|------|------|------|
| `stake(amount)` | 质押 LP 代币 | 需先 approve |
| `unstake(amount)` | 取回 LP 代币 | 最少质押 24 小时后才能取 |
| `claimReward()` | 领取 USDX 奖励 | 最低领取额 0.001 USDX |

### BLA 累积与转换

`depositBLARewards()` 收到的 AE 代币不会立刻换成 USDX，而是先累积：

```
AE 代币存入 → accumulatedBLA 增加
  ↓
用户执行 stake/unstake/claimReward 时
  ↓
检查 accumulatedBLA 是否 > 0
  ↓
如果是，通过 PancakeSwap 把 AE 换成 USDX
  ↓
换到的 USDX 加入奖励池，重新计算 rewardPerSecond
```

为什么不立刻换？因为 `depositBLARewards()` 是在 AE 合约的 `_transfer` 流程中被调用的，如果在这里面再做 swap 操作，会导致重入问题或 gas 消耗过高。所以采用"先累积，后处理"的策略。

---

## 完整流程图

```
                    用户在 PancakeSwap 卖出 AE
                              ↓
                    收取手续费（AE 代币）
                    ├── 1.5% Marketing Fee
                    └── 1.5% LP Fee
                              ↓
                    累积到 swapAtAmount 阈值
                              ↓
              ┌─────────────────────────────────┐
              │    _processFeeDistribution()    │
              ├─────────────────────────────────┤
              │ Marketing Fee:                  │
              │   AE → swap → USDX → 营销地址   │
              │                                 │
              │ LP Fee:                         │
              │   AE → liquidityStaking         │
              │        .depositBLARewards()     │
              └─────────────────────────────────┘
                              ↓
              ┌─────────────────────────────────┐
              │     LiquidityStaking 合约       │
              ├─────────────────────────────────┤
              │ 1. 累积 AE (accumulatedBLA)     │
              │ 2. 用户操作时触发 swap AE→USDX  │
              │ 3. USDX 进入奖励池              │
              │ 4. 按 7 天周期线性释放           │
              │ 5. 按加权比例分配给 LP 质押者    │
              └─────────────────────────────────┘
                              ↓
                    LP 质押者领取 USDX 奖励
```

---

## 回到原始问题：为什么部署脚本需要 setLiquidityStaking？

AE 合约中的 `liquidityStaking` 变量默认是 `address(0)`。如果不调用 `setLiquidityStaking()` 设置地址：

1. 当手续费累积触发 `_processFeeDistribution()` 时，代码会尝试调用 `address(0).depositBLARewards()`
2. 对零地址调用函数会直接 revert
3. **结果：包含手续费分配的卖出交易会失败**

所以 `setLiquidityStaking` 不是"可选"的——只要有用户交易产生手续费并触发分配，就必须已经设置好这个地址。

### 设置时机

```javascript
// 部署 LiquidityStaking 合约后
const liquidityStaking = await LiquidityStaking.deploy(ae.address, usdx.address, lpToken.address);
await liquidityStaking.waitForDeployment();

// 在 AE 合约中设置地址
await ae.setLiquidityStaking(liquidityStaking.target);
// 这同时会把 liquidityStaking 加入手续费白名单
```

必须在 **正式开放交易之前** 完成设置，否则一旦有卖出交易触发手续费分配就会 revert。

---

## 合约代码位置

LiquidityStaking 合约已经写好了，放在 `othercode/LiquidityStaking/` 目录下（不在 `contracts/` 目录，是独立项目）。

### 文件结构

```
othercode/LiquidityStaking/
├── src/
│   ├── mainnet/
│   │   └── LiquidityStaking.sol          ← 主网部署合约（继承 Base，设置 minStakeDuration = 24h）
│   ├── abstract/
│   │   └── LiquidityStakingBase.sol      ← 核心逻辑实现（589 行）
│   └── interfaces/
│       ├── IOLA.sol                       ← AE 合约接口
│       └── IStaking.sol                   ← Staking 合约接口
├── lib/
│   ├── openzeppelin-contracts/            ← Ownable, IERC20, ReentrancyGuard
│   └── v2-periphery/                      ← IUniswapV2Router02
└── settings.json
```

另外还有一个 SYI 版本的 LiquidityStaking（用于 SYI 代币系统）：

```
othercode/LiquidityStaking-SYI/
├── mainnet/
│   └── LiquidityStaking.sol
├── abstract/
│   └── LiquidityStakingBase.sol
└── interfaces/
    ├── ISYI.sol
    └── IStaking.sol
```

### AE 合约中的相关代码

| 内容 | 文件位置 |
|------|----------|
| `liquidityStaking` 变量声明 | `contracts/AE/src/abstract/AEBase.sol:225` |
| `setLiquidityStaking()` 函数 | `contracts/AE/src/abstract/AEBase.sol:360-364` |
| LP Fee 分配逻辑 | `contracts/AE/src/abstract/AEBase.sol:1346-1350` |
| FundRelay USDX 分配逻辑 | `contracts/AE/src/abstract/AEBase.sol:1530-1531` |
| ILiquidityStaking 接口定义 | `contracts/AE/src/interfaces/ILiquidityStaking.sol` |

### 构造函数参数

部署 LiquidityStaking 合约需要 7 个参数：

```solidity
constructor(
    address _usdt,              // USDX 代币地址
    address _olaContract,       // AE 代币合约地址
    address _lpToken,           // AE/USDX LP 代币地址
    address _staking,           // Staking 合约地址
    address _marketingAddress,  // 营销地址（会被排除在质押之外）
    address _admin,             // 管理员地址（设为 owner）
    address _router             // PancakeSwap Router 地址
)
```
