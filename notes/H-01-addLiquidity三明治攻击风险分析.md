# H-01: addLiquidity amountMin=0 三明治攻击风险详细分析

## 1. 问题定位

**合约:** `StakingBase.sol`
**函数:** `_swapAndAddLiquidity()` (第 1344-1378 行)
**触发入口:** `stake()` (第 230 行)

```solidity
ROUTER.addLiquidity(
    address(USDX),
    address(AE),
    remainingUsdx,
    aeTokensReceived,
    0,              // amountAMin = 0  ← 问题根源
    0,              // amountBMin = 0  ← 问题根源
    address(0),
    block.timestamp
);
```

---

## 2. 背景知识: Uniswap V2 addLiquidity 的工作原理

### 2.1 addLiquidity 参数说明

```solidity
function addLiquidity(
    address tokenA,        // 代币 A 地址
    address tokenB,        // 代币 B 地址
    uint amountADesired,   // 期望存入的 A 数量
    uint amountBDesired,   // 期望存入的 B 数量
    uint amountAMin,       // 最少接受存入的 A 数量
    uint amountBMin,       // 最少接受存入的 B 数量
    address to,            // LP Token 接收地址
    uint deadline          // 交易截止时间
) external returns (uint amountA, uint amountB, uint liquidity);
```

### 2.2 amountMin 的作用

`addLiquidity` 并不是按照你给的 `amountADesired` / `amountBDesired` 原样存入的。Router 会根据**当前池子的价格比例**来决定实际存入的数量:

- 如果 `amountADesired / amountBDesired` 的比例与池子的 `reserveA / reserveB` 不一致，Router 会自动调低其中一个代币的存入量，以匹配池子当前价格比例
- `amountAMin` 和 `amountBMin` 是**滑点保护参数**：如果调整后实际要存入的 A < amountAMin 或 B < amountBMin，交易会 revert

**当 amountMin = 0 时**，意味着：无论实际存入多少代币，交易都不会 revert。即使池子价格被恶意操纵导致存入比例极度失衡，交易也会成功。

---

## 3. 当前代码的完整执行流程

当用户调用 `stake(1000 USDX, stakeIndex)` 时：

```
用户 stake(1000 USDX)
    │
    ├─ Step 1: transferFrom(用户, 合约, 1000 USDX)
    │
    ├─ Step 2: 计算 usdxToSwap = 1000 / 2 = 500 USDX
    │
    ├─ Step 3: swap 500 USDX → AE (有滑点保护 ✅)
    │   └── minAeTokensOut = _calculateMinimumOutput(500)  // 有保护
    │
    ├─ Step 4: 计算 remainingUsdx = 1000 - 500 = 500 USDX
    │
    └─ Step 5: addLiquidity(500 USDX, aeTokensReceived, 0, 0)  // 无保护 ❌
        └── amountAMin = 0, amountBMin = 0
```

**矛盾之处：** swap 操作有 `_calculateMinimumOutput()` 做滑点保护（15%-20% 容忍度），但紧接着的 addLiquidity 却完全没有保护。

---

## 4. 三明治攻击 (Sandwich Attack) 详解

### 4.1 什么是三明治攻击

三明治攻击是一种 MEV（最大可提取价值）攻击方式。攻击者利用在**公开的内存池 (mempool)** 中看到的待执行交易，通过在目标交易前后分别插入自己的交易来提取利润。

```
正常交易顺序:  ... → [用户 stake 交易] → ...

攻击后顺序:    ... → [攻击者 前置交易] → [用户 stake 交易] → [攻击者 后置交易] → ...
                         ↑                                         ↑
                    "面包上片"                                  "面包下片"
```

### 4.2 针对本合约的攻击流程

#### 场景设置

假设当前 USDX-AE 池子状态：
- reserveUSDX = 100,000 USDX
- reserveAE = 1,000,000 AE
- 当前价格: 1 USDX = 10 AE
- 受害者准备 stake 1000 USDX

#### 攻击详细步骤

**Phase 1: 攻击者监控 mempool**

```
攻击者运行 MEV bot，监听 BSC mempool
    │
    └─ 发现: 用户提交 stake(1000 USDX) 交易
        ├── 该交易会先 swap 500 USDX → AE
        └── 然后 addLiquidity(500 USDX, AE, 0, 0)  ← amountMin=0!
```

**Phase 2: 前置交易 (Front-run) — 操纵价格**

```
攻击者提交高 gas 交易（确保先于用户执行）:
    swap 大量 USDX → AE (例如 50,000 USDX → AE)

池子状态变化:
    之前: reserveUSDX=100,000  reserveAE=1,000,000  价格=10AE/USDX
    之后: reserveUSDX=150,000  reserveAE=~666,667   价格=~4.44AE/USDX

    → AE 价格被大幅拉高 (用 USDX 计价)
    → 1 AE 从 0.1 USDX 涨到 ~0.225 USDX
```

**Phase 3: 用户 stake 交易执行 (被夹在中间)**

```
Step 3a: 用户的 swap 500 USDX → AE
    ├── 正常情况应得到 ~5000 AE
    ├── 被操纵后只得到 ~2000 AE (价格被拉高了)
    ├── _calculateMinimumOutput 可能会让这个 swap 也遭受损失
    │   (但有 15-20% 的滑点容忍度，攻击者可以精确控制在容忍度内)
    └── 假设通过滑点检查，得到 aeTokensReceived = 2000 AE

Step 3b: addLiquidity(500 USDX, 2000 AE, 0, 0)
    ├── 池子当前比例: USDX:AE ≈ 150,500:664,667
    ├── Router 会按池子比例调整实际存入量
    ├── 可能实际存入: 500 USDX + 2000 AE
    │   或: 调整后的某个更小值
    ├── amountMin = 0 → 无论实际存入多少都接受 ✅ (对攻击者有利)
    └── 多余的代币留在合约中或被浪费
```

**Phase 4: 后置交易 (Back-run) — 攻击者获利**

```
攻击者提交低 gas 交易（确保在用户之后执行）:
    swap AE → USDX (把之前买的 AE 卖回去)

    攻击者的利润:
    ├── 花费: 50,000 USDX (买入 AE)
    ├── 收回: 50,000+ USDX (卖出 AE，因为用户的交易进一步推高了价格)
    └── 净利润: 来自用户在不利价格下添加流动性的价值损失
```

### 4.3 攻击利润来源

攻击者的利润来源于**用户在被操纵的价格下添加流动性时的价值损失**：

```
正常情况下用户添加的流动性价值:
    500 USDX + 5000 AE(价值 500 USDX) = 1000 USDX 总价值

被攻击后用户添加的流动性价值:
    500 USDX + 2000 AE(实际价值可能只有 200 USDX) = 700 USDX 总价值

用户损失: ~300 USDX
```

更关键的是，因为 LP Token 被发送到 `address(0)` 永久销毁，用户无法通过移除流动性来挽回任何损失。

### 4.4 为什么 addLiquidity 的 amountMin=0 比 swap 的 amountMin=0 更危险

| 对比维度 | swap 的 amountMin=0 | addLiquidity 的 amountMin=0 |
|---------|---------------------|---------------------------|
| 损失形式 | 换到更少的代币 | 存入更多代币但获得更少的 LP |
| 可恢复性 | 代币还在用户手中 | LP 被销毁,永远无法取回 |
| 攻击精度 | 攻击者需要精确控制 | 攻击者有更大操作空间 |
| 本合约情况 | 有 `_calculateMinimumOutput` 保护 | **完全无保护** |

---

## 5. BSC 链上的实际攻击可行性

### 5.1 BSC 的 MEV 生态

- BSC 出块时间约 3 秒，mempool 是公开的
- BSC 上存在大量活跃的 MEV bot（如 BNB48 validator 联盟提供的 MEV 服务）
- 相比以太坊，BSC 上的 MEV 竞争相对较少，但攻击者仍然活跃
- BSC 的 gas 费用低，使得三明治攻击的成本更低

### 5.2 攻击触发条件

1. 攻击者的 MEV bot 监控到 `stake()` 交易
2. 被质押金额足够大（使攻击有利可图）
3. USDX-AE 池子流动性相对较低（价格更容易被操纵）

### 5.3 攻击成本 vs 收益

```
攻击成本:
    ├── 两笔交易的 gas 费: ~0.01-0.05 BNB (~$3-$15)
    ├── 前置 swap 的价格影响损失: 极小 (被后置交易回收)
    └── 资金成本: 需要大量 USDX (可通过闪电贷获得, 成本接近 0)

攻击收益:
    └── 取决于受害者 stake 金额和池子深度
        ├── 小额 stake (100 USDX): 收益约 $1-5 (可能不值得)
        ├── 中额 stake (1000 USDX): 收益约 $10-50
        └── 大额 stake (10000 USDX): 收益约 $100-500+
```

---

## 6. 复合攻击向量

### 6.1 swap + addLiquidity 双重打击

当前代码中，虽然 swap 有 `_calculateMinimumOutput` 保护（15%-20% 滑点容忍度），但攻击者可以：

1. 将前置交易的价格操纵**精确控制在 swap 的滑点容忍度之内**
2. 让 swap 刚好通过检查，但用户已经在不利价格下换到了更少的 AE
3. 然后在 addLiquidity 步骤中，因为 amountMin=0，进一步提取价值

```
攻击者精确计算:
    ├── swap 的滑点容忍度 = 15% (BASE_SLIPPAGE_TOLERANCE = 1500 bps)
    ├── 前置交易操纵价格使 swap 输出刚好 = minAeTokensOut (差 15%)
    ├── 用户 swap 损失 15% 的 AE
    └── addLiquidity 时用更少的 AE + 同样的 USDX 添加流动性
        └── 额外损失取决于池子比例变化
```

### 6.2 结合闪电贷的零成本攻击

```
攻击流程:
    1. 闪电贷借入大量 USDX (例如 100,000 USDX)
    2. 前置交易: swap USDX → AE (操纵价格)
    3. [用户 stake 交易执行, 遭受损失]
    4. 后置交易: swap AE → USDX (恢复价格, 获利)
    5. 归还闪电贷 + 手续费
    6. 剩余即为纯利润

    攻击者自有资金需求: ≈ 0 (只需 gas 费)
```

---

## 7. 解决方案

### 方案 A: 基于实际 swap 结果计算 amountMin（推荐）

核心思路：swap 之后我们已经知道了实际获得的 AE 数量和剩余的 USDX 数量，可以基于这些已知值设置合理的 amountMin。

```solidity
function _swapAndAddLiquidity(uint160 usdxAmount) private {
    IERC20(USDX).transferFrom(msg.sender, address(this), usdxAmount);

    address[] memory swapPath = new address[](2);
    swapPath[0] = address(USDX);
    swapPath[1] = address(AE);

    uint256 aeBalanceBefore = AE.balanceOf(address(this));
    uint256 usdxToSwap = usdxAmount / LIQUIDITY_SPLIT_DIVISOR;

    uint256 minAeTokensOut = _calculateMinimumOutput(usdxToSwap);

    ROUTER.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        usdxToSwap,
        minAeTokensOut,
        swapPath,
        address(this),
        block.timestamp
    );

    uint256 aeBalanceAfter = AE.balanceOf(address(this));
    uint256 aeTokensReceived = aeBalanceAfter - aeBalanceBefore;

    uint256 remainingUsdx = usdxAmount - usdxToSwap;

    // ========== 修复: 计算合理的 amountMin ==========
    // 允许 5% 的滑点容忍度 (可根据需要调整)
    uint256 amountUsdxMin = (remainingUsdx * 95) / 100;
    uint256 amountAeMin = (aeTokensReceived * 95) / 100;

    ROUTER.addLiquidity(
        address(USDX),
        address(AE),
        remainingUsdx,
        aeTokensReceived,
        amountUsdxMin,   // ✅ 至少存入 95% 的 USDX
        amountAeMin,     // ✅ 至少存入 95% 的 AE
        address(0),
        block.timestamp
    );
}
```

**优点：**
- 实现简单，改动最小
- 基于实际 swap 结果计算，不需要额外的 oracle 依赖
- 5% 容忍度足以应对 addLiquidity 内部的比例调整

**缺点：**
- 如果在 swap 和 addLiquidity 之间价格发生变化（同一笔交易内可能性很小），可能导致交易失败
- 不能防御 swap 步骤本身的价格操纵（但 swap 已有 `_calculateMinimumOutput` 保护）

### 方案 B: 使用已有的 `_calculateMinimumOutput` 统一保护

```solidity
function _swapAndAddLiquidity(uint160 usdxAmount) private {
    // ... (前面的 swap 代码不变) ...

    uint256 remainingUsdx = usdxAmount - usdxToSwap;

    // 基于当前 swap 后的池子状态计算期望的添加比例
    address pair = AE.getUniswapV2Pair();
    (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair).getReserves();

    address token0 = IUniswapV2Pair(pair).token0();
    uint112 reserveUSDX;
    uint112 reserveAE;
    if (token0 == address(USDX)) {
        reserveUSDX = reserve0;
        reserveAE = reserve1;
    } else {
        reserveUSDX = reserve1;
        reserveAE = reserve0;
    }

    // 根据池子比例计算期望的 AE 存入量
    uint256 optimalAE = (remainingUsdx * reserveAE) / reserveUSDX;
    // 取实际持有和期望值的较小者
    uint256 aeToAdd = aeTokensReceived < optimalAE ? aeTokensReceived : optimalAE;
    uint256 usdxToAdd = aeTokensReceived < optimalAE
        ? (aeTokensReceived * reserveUSDX) / reserveAE
        : remainingUsdx;

    // 设置 95% 的最低接受量
    uint256 amountUsdxMin = (usdxToAdd * 95) / 100;
    uint256 amountAeMin = (aeToAdd * 95) / 100;

    ROUTER.addLiquidity(
        address(USDX),
        address(AE),
        remainingUsdx,
        aeTokensReceived,
        amountUsdxMin,
        amountAeMin,
        address(0),
        block.timestamp
    );
}
```

**优点：**
- 更精确，基于 swap 后的实际池子比例
- 避免因为 swap 改变了池子比例后 amountMin 过高导致 revert

**缺点：**
- 多一次 `getReserves()` 调用，增加 gas 消耗
- 代码稍复杂

### 方案 C: 使用可配置的滑点参数（最灵活）

将滑点容忍度设为可配置常量，与 swap 的保护逻辑统一管理：

```solidity
// 新增常量
uint256 internal constant ADD_LIQUIDITY_SLIPPAGE_TOLERANCE = 500; // 5% = 500 bps

function _swapAndAddLiquidity(uint160 usdxAmount) private {
    // ... (swap 代码不变) ...

    uint256 remainingUsdx = usdxAmount - usdxToSwap;

    uint256 amountUsdxMin = (remainingUsdx *
        (BASIS_POINTS_DENOMINATOR - ADD_LIQUIDITY_SLIPPAGE_TOLERANCE)) /
        BASIS_POINTS_DENOMINATOR;
    uint256 amountAeMin = (aeTokensReceived *
        (BASIS_POINTS_DENOMINATOR - ADD_LIQUIDITY_SLIPPAGE_TOLERANCE)) /
        BASIS_POINTS_DENOMINATOR;

    ROUTER.addLiquidity(
        address(USDX),
        address(AE),
        remainingUsdx,
        aeTokensReceived,
        amountUsdxMin,
        amountAeMin,
        address(0),
        block.timestamp
    );
}
```

**优点：**
- 代码风格与已有的 `BASE_SLIPPAGE_TOLERANCE` 一致
- 容忍度可以方便调整
- 改动最小

---

## 8. 推荐方案

**推荐采用方案 A 或方案 C**，理由：

1. **改动量小**: 只需修改 `_swapAndAddLiquidity` 函数中的 2 行代码
2. **风险低**: swap 和 addLiquidity 在同一笔交易中执行，中间不会有外部交易插入，5% 的容忍度足够处理 Router 内部的比例调整
3. **一致性**: 方案 C 使用 basis points 常量，与合约中已有的滑点管理风格一致

### 关于滑点容忍度取值

- **3%-5% (300-500 bps)**: 推荐范围。足以处理 addLiquidity 的内部比例调整，同时能有效防止三明治攻击
- **< 1%**: 过于严格，可能在正常情况下导致交易频繁失败
- **> 10%**: 过于宽松，攻击者仍有足够空间获利

### 额外建议

1. **AE Token 合约也需要同步修复**: `AEBase.sol` 中的 `_addLiquidityAndBurnLP()` 存在同样的问题
2. **考虑使用 deadline 而非 `block.timestamp`**: 当前使用 `block.timestamp` 作为 deadline 等于没有 deadline 保护（矿工/验证者可以延迟执行交易）。但在 BSC 上因为出块时间短且使用 PoSA 共识，这个风险相对较低
3. **监控**: 部署后应设置链上事件监控，关注 addLiquidity 事件中实际存入量与期望量的偏差

---

## 9. 影响范围

| 受影响的合约 | 文件位置 | 函数 |
|------------|---------|------|
| AE-Staking | `contracts/AE-Staking/src/abstract/StakingBase.sol:1368` | `_swapAndAddLiquidity()` |
| AE Token | `contracts/AE/src/abstract/AEBase.sol:1409` | `_addLiquidityAndBurnLP()` |

两处均需要修复。
