# AetherDAO 合约代码说明 - 第1部分：项目概览与AE代币

## 一、项目概览

AetherDAO 是一个部署在 BSC（币安智能链）上的 DeFi 质押系统，包含零税代币、复合利息质押、推荐人团队奖励等机制。

### 目录结构

```
contracts/
├── AE/                          # AE 代币系统
│   └── src/
│       ├── mainnet/
│       │   └── AE.sol           # 主网合约（继承 AEBase）
│       ├── abstract/
│       │   └── AEBase.sol       # 核心代币逻辑（~1200行）
│       ├── interfaces/
│       │   ├── IStaking.sol     # 质押接口
│       │   └── ILiquidityStaking.sol  # LP 质押接口
│       └── utils/
│           ├── Helper.sol       # Uniswap 数学计算库
│           └── FundRelay.sol    # USDT 中转合约
│
├── AE-Staking/                  # 质押系统
│   └── src/
│       ├── mainnet/
│       │   └── Staking.sol      # 主网质押合约
│       ├── abstract/
│       │   └── StakingBase.sol  # 核心质押逻辑（~1600行）
│       └── interfaces/
│           ├── IStaking.sol     # 质押接口定义
│           └── IAE.sol          # AE 代币接口
│
└── Aether-Referral/             # 推荐人系统
    └── AetherReferral.sol       # 独立推荐关系管理（~520行）
```

### 合约交互关系

```
AE 代币
├── 调用 Staking：查推荐人、判断布道者身份
├── 调用 FundRelay：USDT 中转（解决 Uniswap INVALID_TO 问题）
├── 使用 Helper：Uniswap AMM 数学计算
└── 与 Uniswap V2 交互：AE ↔ USDT 交换

Staking 质押
├── 调用 AE 合约：recycle() 回收代币、查储备量
├── 通过 Uniswap V2 Router：USDT → AE 兑换
└── 通过推荐链：分发团队奖励

AetherReferral 推荐人
├── 独立合约：纯关系管理
├── 被 Staking 查询：推荐链获取
└── 管理：循环引用检测
```

---

## 二、AE 代币合约

### 2.1 AE.sol（主网入口）

**文件**: `contracts/AE/src/mainnet/AE.sol`

继承自 `AEBase`，仅定义主网参数：

| 参数 | 值 | 说明 |
|------|----|------|
| `getDelayedBuyPeriod()` | 30 天 | 延迟购买期 |
| `getPresaleDuration()` | 30 天 | 预售持续时间 |

### 2.2 AEBase.sol（核心逻辑）

**文件**: `contracts/AE/src/abstract/AEBase.sol`

这是 AE 代币的核心实现，继承 ERC20 + Ownable，包含买卖税收、利润税、手续费分配等全部逻辑。

#### 关键状态变量

```solidity
// 不可变地址
IERC20 public immutable USDT;
IUniswapV2Router02 public immutable uniswapV2Router;
IStaking public immutable staking;

// 用户追踪
mapping(address => uint256) public userInvestment;   // 用户累计 USDT 投入
mapping(address => uint256) public lastBuyTime;      // 最后购买时间

// 权限管理
mapping(address => bool) public feeWhitelisted;      // 免税白名单
mapping(address => bool) public blacklisted;          // 黑名单

// 手续费接收地址
address public marketingAddress;           // 营销基金
address public weeklyTop15RewardAddress;   // 周排名 Top15 奖励
address public marketingFundAddress;       // 营销基金（代币）

// 交易控制
uint256 public coldTime = 10;              // 买卖冷却期（秒）
bool public presaleActive;                 // 预售是否激活
bool public delayedBuyEnabled;             // 延迟购买是否启用
```

#### 手续费常量

```solidity
// 买入手续费（合计 3%）
uint256 constant BUY_NODE_REWARD_FEE = 200;       // 2% → 节点分红池
uint256 constant BUY_COMMUNITY_REWARD_FEE = 100;   // 1% → 社区分红池

// 卖出手续费（合计 3%）
uint256 constant SELL_MARKETING_FEE = 150;          // 1.5% → 营销基金
uint256 constant SELL_LIQUIDITY_ACCUM_FEE = 150;    // 1.5% → 销毁

// 利润税（盈利部分的 25%）
uint256 constant PROFIT_TAX_RATE = 2500;

// LP 处理手续费
uint256 constant LP_HANDLE_FEE = 250;               // 2.5%
```

#### 核心函数详解

##### `_update()` — 转账钩子（覆盖 ERC20）

所有 transfer/transferFrom 都会经过此函数，是买卖税收的入口：

```
_update(from, to, amount)
├── 黑名单检查
├── 白名单地址 → 直接转账，不收税
├── 判断是买入（from == pair）→ _handleBuy()
├── 判断是卖出（to == pair）→ _handleSell()
└── 普通转账 → 直接执行
```

##### `_handleBuy()` — 买入处理

```
_handleBuy(buyer, amount)
├── 检查预售状态
├── 检查延迟购买要求
├── 计算买入税（3%）
│   ├── 2% → 节点分红池地址
│   └── 1% → 社区分红池地址
├── 更新用户投资记录 userInvestment[buyer] += 估算USDT值
├── 记录 lastBuyTime
└── 转入实际到手数量（amount - 税）
```

##### `_handleSell()` — 卖出处理

```
_handleSell(seller, amount)
├── 冷却期检查（距上次买入 >= 10秒）
├── 计算固定税（3%）
│   ├── 1.5% → 营销手续费（累积）
│   └── 1.5% → LP累积费（累积）
├── 利润税计算（25%）
│   ├── 估算卖出可得 USDT
│   ├── 与用户历史投入比较
│   ├── 有利润时收取 25% 的盈利税
│   └── 盈利税分配：
│       ├── 15% → 流动性（买入AE + 添加LP，烧毁LP）
│       ├── 15% → 周排名 Top15 奖励
│       ├── 10% → 营销基金（买入AE）
│       └── 60% → 销毁（买入AE后烧毁）
├── 更新用户投资记录（按比例减少）
└── 尝试处理累积手续费 _tryProcessAccumulatedFees()
```

##### `_processFeeDistribution()` — 手续费批量处理

累积到一定数量后，统一将代币换成 USDT 并分配：

```
_processFeeDistribution()
├── 将累积的营销手续费 AE → USDT → 营销地址
├── 将累积的 LP 手续费 → 添加流动性
│   ├── 一半 AE 换成 USDT
│   ├── AE + USDT 添加 LP
│   └── 烧毁 LP Token
└── 重置累积计数器
```

### 2.3 Helper.sol（工具库）

**文件**: `contracts/AE/src/utils/Helper.sol`

纯库合约，提供 Uniswap V2 AMM 计算：

```solidity
// 判断是否为合约地址
function isContract(address account) → bool

// 计算兑换输出量（含 0.25% 手续费）
function getAmountOut(amountIn, reserveIn, reserveOut) → amountOut

// 计算需要的输入量
function getAmountIn(amountOut, reserveIn, reserveOut) → amountIn
```

### 2.4 FundRelay.sol（资金中转）

**文件**: `contracts/AE/src/utils/FundRelay.sol`

解决 Uniswap 交换时 `INVALID_TO` 问题的中转合约。当 AE 合约自身作为 swap 的接收方时会触发 Uniswap 限制，所以通过 FundRelay 作为中间人：

```
Uniswap Swap
  └── USDT → FundRelay（作为接收地址）
       └── FundRelay.receiveAndForward() → AE 合约

关键函数：
├── receiveAndForward()      # 接收 USDT 并转发给 AE 合约
├── withdrawToAE()           # AE 合约主动提取 USDT
├── withdrawAEToContract()   # AE 合约提取 AE 代币
├── emergencyWithdraw()      # 紧急提取（授权地址）
└── emergencyWithdrawToken() # 紧急提取任意代币
```

### 2.5 接口文件

- **IStaking.sol**: 质押合约接口，AE 代币调用时使用
- **ILiquidityStaking.sol**: LP 质押接口
