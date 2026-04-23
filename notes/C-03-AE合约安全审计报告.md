# AE 合约安全审计报告

## 审计范围

| 文件 | 路径 |
|------|------|
| AEBase.sol | contracts/AE/src/abstract/AEBase.sol |
| AE.sol | contracts/AE/src/mainnet/AE.sol |
| FundRelay.sol | contracts/AE/src/utils/FundRelay.sol |
| Helper.sol | contracts/AE/src/utils/Helper.sol |

Solidity 版本: ^0.8.20
依赖: OpenZeppelin ERC20, Ownable; Uniswap V2 Router/Pair/Factory

---

## 严重程度定义

| 等级 | 说明 |
|------|------|
| 🔴 严重 (Critical) | 可直接导致资金损失或合约被攻破 |
| 🟠 高危 (High) | 可能导致资金损失或严重功能异常 |
| 🟡 中危 (Medium) | 可能导致非预期行为或经济损失 |
| 🔵 低危 (Low) | 代码质量、最佳实践或小问题 |
| ⚪ 信息 (Info) | 建议性改进 |

---

## 🔴 严重问题

### C-01: `_swapTokensForUSDX` 滑点保护为零 — 三明治攻击

**文件**: AEBase.sol:908-916
**严重程度**: 🔴 严重

```solidity
uniswapV2Router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    tokenAmount,
    0,           // ← amountOutMin = 0, 无滑点保护
    path,
    recipient,
    block.timestamp + 300
);
```

**问题描述**:
`_swapTokensForUSDX` 函数在调用 Router 时 `amountOutMin` 设为 0, 意味着接受任意数量的输出代币。MEV 机器人可以在交易前拉高价格(front-run), 在交易后砸盘(back-run), 从中获利。

合约内部虽然有 `_getMinimumSwapOutput` 函数(第1040行)计算了 95% 的最小输出, 但从未在 `_swapTokensForUSDX` 中使用。

**影响**:
每次卖出触发的盈利税 swap、费用处理 swap 都可被三明治攻击, 导致协议和用户资金损失。

**建议**:
将 `_getMinimumSwapOutput` 的返回值作为 `amountOutMin` 参数传入。

---

### C-02: `recycle` 函数 — 直接从 Pair 转出代币, 可操纵价格

**文件**: AEBase.sol:445-458
**严重程度**: 🔴 严重

```solidity
function recycle(uint256 amount) external {
    require(msg.sender == address(staking), "Only staking contract");
    uint256 pairBalance = balanceOf(address(uniswapV2Pair));
    uint256 maxRecyclable = pairBalance / 3;
    uint256 recycleAmount = amount >= maxRecyclable ? maxRecyclable : amount;
    if (recycleAmount > 0) {
        _update(address(uniswapV2Pair), address(staking), recycleAmount);
        uniswapV2Pair.sync();
    }
}
```

**问题描述**:
此函数直接从 Uniswap Pair 合约中转出 AE 代币到 staking 合约, 然后调用 `sync()` 更新储备量。这会导致:

1. Pair 中 AE 储备减少, USDX 储备不变 → AE 价格瞬间上涨
2. 最多可转出 Pair 中 1/3 的 AE, 价格影响巨大
3. 攻击者可在 `recycle` 前买入 AE, 之后卖出获利

**影响**:
Staking 合约可以通过此函数人为拉高 AE 价格, 配合卖出操作获利。

---

### C-03: 卖出时盈利税计算基于预估值, 实际 swap 结果可能偏差巨大

**文件**: AEBase.sol:805-827
**严重程度**: 🔴 严重

```solidity
// 预估 USDX 输出
uint256 estimatedUSDXFromSale = _estimateSwapOutput(netAmountAfterTradingFees);

// 基于预估值计算盈利税
if (userCurrentInvestment > 0 && estimatedUSDXFromSale > userCurrentInvestment) {
    profitAmount = estimatedUSDXFromSale - userCurrentInvestment;
    profitTaxUSDX = (profitAmount * PROFIT_TAX_RATE) / BASIS_POINTS;
    profitTaxInAE = (profitTaxUSDX * netAmountAfterTradingFees) / estimatedUSDXFromSale;
}

uint256 netAmount = netAmountAfterTradingFees - profitTaxInAE;
uint256 actualUSDXReceived = estimatedUSDXFromSale - profitTaxUSDX;
```

**问题描述**:
盈利税的计算完全基于 `_estimateSwapOutput` 的预估值, 但实际卖出时:

1. 盈利税部分的 AE 先被 swap 成 USDX (第839行), 改变了池子储备
2. 然后剩余 AE 才被转入 Pair (第863行), 此时价格已变
3. `actualUSDXReceived` 是预估值减去预估税, 并非实际收到的 USDX

用户实际收到的 USDX 可能远少于 `actualUSDXReceived`, 但 `_updateInvestmentAfterSell` 却用这个不准确的值更新投资记录。

**影响**:
投资记录不准确, 可能导致后续卖出时盈利税计算错误, 用户可能多付或少付税。

---

## 🟠 高危问题

### H-01: `_handleSell` 中盈利税 swap 可能失败, 但卖出仍继续

**文件**: AEBase.sol:835-858
**严重程度**: 🟠 高危

```solidity
if (profitTaxInAE > 0) {
    super._update(from, address(this), profitTaxInAE);
    uint256 usdxAmountFromProfitTax = _swapTokensForUSDX(profitTaxInAE);
    if (usdxAmountFromProfitTax > 0) {
        // 分配盈利税...
    }
    // 如果 swap 失败 (返回0), 盈利税 AE 留在合约中, 但卖出继续
}
```

**问题描述**:
当盈利税的 AE→USDX swap 失败时:
1. 盈利税 AE 已从用户转到合约 (第836行)
2. 但 swap 返回 0, 没有 USDX 可分配
3. 卖出仍然继续, 用户的 AE 被扣除但盈利税未正确处理
4. 这些 AE 滞留在合约中, 没有机制回收给用户

**影响**:
用户损失盈利税对应的 AE, 但协议也未收到对应的 USDX 税收。

---

### H-02: `_addLiquidityAndBurnLP` 中 `addLiquidity` 的 `amountMin` 为 0

**文件**: AEBase.sol:1408-1418
**严重程度**: 🟠 高危

```solidity
uniswapV2Router.addLiquidity(
    address(this),
    USDX,
    aeAmount,
    remainingUSDX,
    0,  // Accept any amount of AE  ← 无最小值保护
    0,  // Accept any amount of USDX ← 无最小值保护
    DEAD_ADDRESS,
    block.timestamp + 300
);
```

**问题描述**:
添加流动性时两个 `amountMin` 参数都为 0, 意味着接受任意比例的流动性添加。MEV 机器人可以在添加流动性前操纵价格, 导致协议以极差的比例添加流动性。

**影响**:
协议在添加流动性时可能损失大量价值。

---

### H-03: `recoverStuckTokens` 不检查 USDX 和 LP 代币

**文件**: AEBase.sol:437-443
**严重程度**: 🟠 高危

```solidity
function recoverStuckTokens(address token, uint256 amount) external onlyOwner {
    if (token == address(this)) return;  // 只阻止提取 AE
    IERC20(token).transfer(owner(), amount);
}
```

**问题描述**:
此函数只阻止提取 AE 代币, 但 owner 可以提取:
- 合约中的 USDX (用于盈利税分配、流动性添加等)
- 合约中的 LP 代币
- 任何其他用户存入的代币

**影响**:
Owner 可以提取合约中待处理的 USDX 费用, 导致费用分配失败。

---

### H-04: `_processFeeDistribution` 中费用清零后 swap 可能失败

**文件**: AEBase.sol:1317-1360
**严重程度**: 🟠 高危

```solidity
function _processFeeDistribution() private lockSwap {
    uint256 totalMarketingFee = amountMarketingFee;
    uint256 totalLPFee = amountLPFee;

    // 先清零
    amountMarketingFee = 0;
    amountLPFee = 0;

    // 然后 swap, 可能失败
    if (totalMarketingFee > 0) {
        marketingUSDX = _swapTokensForUSDX(totalMarketingFee);
        // 如果 swap 失败, marketingUSDX = 0, 费用丢失
    }
```

**问题描述**:
费用累积变量在 swap 之前就被清零。如果后续的 swap 失败:
1. `amountMarketingFee` 和 `amountLPFee` 已经是 0
2. swap 返回 0, 没有 USDX 可分配
3. 对应的 AE 代币仍在合约中, 但费用计数器已归零
4. 这些 AE 永远不会被重新处理

**影响**:
协议累积的营销费和 LP 费可能因 swap 失败而永久丢失。

---

### H-05: `FundRelay.receiveAndForward` 任何人都可调用

**文件**: FundRelay.sol:111-126
**严重程度**: 🟠 高危

```solidity
function receiveAndForward() external returns (uint256 usdxAmount) {
    // 没有访问控制!
    uint256 balance = IERC20(USDX).balanceOf(address(this));
    if (balance > 0) {
        bool success = IERC20(USDX).transfer(AE_CONTRACT, balance);
        // ...
    }
    return 0;
}
```

**问题描述**:
`receiveAndForward` 没有访问控制, 任何人都可以调用。虽然它只是将 USDX 转给 AE 合约, 但在某些时序下可能被利用:
- 如果有其他逻辑依赖 FundRelay 中的 USDX 余额, 攻击者可以提前触发转移

---

## 🟡 中危问题

### M-01: `_swapUSDXForTokens` 失败时将 USDX 发送到 `marketingFundAddress` — 资金去向不透明

**文件**: AEBase.sol:1002-1016
**严重程度**: 🟡 中危

```solidity
} catch Error(string memory reason) {
    emit SwapFailed(reason, usdxAmount, block.timestamp);
    if (marketingFundAddress != address(0)) {
        IERC20(USDX).transfer(marketingFundAddress, usdxAmount);
    }
    return 0;
}
```

**问题描述**:
当 USDX→AE 的 swap 失败时, USDX 被发送到 `marketingFundAddress` 作为 fallback。这些 USDX 原本应该用于添加流动性并销毁 LP, 但失败后变成了营销资金。用户的盈利税被变相转移。

---

### M-02: `Helper.isContract` 使用 `extcodesize` — 可被绕过

**文件**: Helper.sol:5-11
**严重程度**: 🟡 中危

```solidity
function isContract(address account) internal view returns (bool) {
    uint256 size;
    assembly { size := extcodesize(account) }
    return size > 0;
}
```

**问题描述**:
`extcodesize` 在合约构造函数执行期间返回 0, 因此合约在部署过程中可以绕过此检查。虽然当前代码中 `isContract` 仅作为外部 view 函数暴露, 未用于关键访问控制, 但如果未来依赖此函数做安全检查则存在风险。

---

### M-03: `userInvestment` 跟踪不准确 — 部分卖出场景

**文件**: AEBase.sol:1156-1173
**严重程度**: 🟡 中危

```solidity
function _updateInvestmentAfterSell(address user, uint256 actualUSDXReceived) private {
    uint256 previousInvestment = userInvestment[user];
    userInvestment[user] = previousInvestment <= actualUSDXReceived
        ? 0
        : previousInvestment - actualUSDXReceived;
}
```

**问题描述**:
投资记录按 USDX 金额线性扣减, 但这不能准确反映部分卖出的情况:

1. 用户投入 1000 USDX 买入 AE
2. AE 涨价后, 用户卖出一半 AE, 收到 800 USDX
3. `userInvestment` 变为 1000 - 800 = 200
4. 用户剩余的 AE 价值远超 200 USDX, 但投资记录只有 200
5. 下次卖出时, 几乎全部被视为"盈利", 需缴纳 25% 盈利税

这对分批卖出的用户不公平, 鼓励一次性全部卖出。

---

### M-04: `coldTime` 可被 owner 设为 0 或极大值

**文件**: AEBase.sol:415-417
**严重程度**: 🟡 中危

```solidity
function setColdTime(uint256 _coldTime) external onlyOwner {
    coldTime = _coldTime;
}
```

**问题描述**:
没有上下限检查。Owner 可以:
- 设为 0: 完全禁用冷却期, 允许闪电贷攻击
- 设为极大值: 永久阻止所有用户卖出

---

### M-05: `swapAtAmount` 无上下限检查

**文件**: AEBase.sol:411-413
**严重程度**: 🟡 中危

```solidity
function setSwapAtAmount(uint256 _swapAtAmount) external onlyOwner {
    swapAtAmount = _swapAtAmount;
}
```

**问题描述**:
- 设为 `type(uint256).max`: 费用永远不会被处理, 累积在合约中
- 设为 0: 每笔交易都触发 swap, 增加 gas 成本和价格影响

---

### M-06: `_handleSell` 中盈利税 swap 改变池子状态后, 剩余代币以不同价格卖出

**文件**: AEBase.sol:835-863
**严重程度**: 🟡 中危

**问题描述**:
卖出流程中:
1. 先将盈利税 AE swap 成 USDX (第839行) — 这会压低 AE 价格
2. 然后将剩余 AE 转入 Pair (第863行) — 此时价格已经更低

用户实际收到的 USDX 比预估的少, 因为盈利税 swap 已经影响了价格。这是一个系统性的价值泄漏。

---

## 🔵 低危问题

### L-01: `transfer` 和 `transferFrom` 重写未调用 `emit Transfer` 事件

**文件**: AEBase.sol:615-633
**严重程度**: 🔵 低危

**问题描述**:
`transfer` 和 `transferFrom` 直接调用 `_update` 而非 `super.transfer/transferFrom`。虽然 `_update` 内部的 `super._update` 会触发 Transfer 事件, 但自定义的 `_update` 在某些路径下(如买卖操作)会拆分成多笔转账, 可能导致链上分析工具追踪困难。

---

### L-02: `setBatchFeeWhitelisted` 和 `setBatchBlacklisted` 无数组长度限制

**文件**: AEBase.sol:386-402
**严重程度**: 🔵 低危

```solidity
function setBatchFeeWhitelisted(address[] memory accounts, bool _whitelisted) external onlyOwner {
    for (uint256 i = 0; i < accounts.length; i++) {
        feeWhitelisted[accounts[i]] = _whitelisted;
    }
}
```

**问题描述**:
如果传入过大的数组, 可能导致 gas 超出区块限制, 交易失败。建议添加最大长度检查。

---

### L-03: `FundRelay` 构造函数中 `approve(type(uint256).max)` — 无限授权

**文件**: FundRelay.sol:99
**严重程度**: 🔵 低危

```solidity
IERC20(_usdx).approve(_aeContract, type(uint256).max);
```

**问题描述**:
虽然 AE 合约是可信的, 但无限授权是一种不推荐的模式。如果 AE 合约存在漏洞, 攻击者可以通过 AE 合约提取 FundRelay 中的所有 USDX。

---

### L-04: 事件参数命名不一致

**文件**: AEBase.sol 多处
**严重程度**: 🔵 低危

**问题描述**:
`_updateBuyInvestmentAndEmitEvent` 中参数名为 `burnFee` 和 `liquidityFee`, 但实际传入的是 `nodeRewardFee` 和 `communityRewardFee` (第771-772行)。这会导致事件数据被错误解读。

---

### L-05: `_processFundRelayFees` 使用 `swapExactTokensForTokens` 而非 `SupportingFeeOnTransferTokens`

**文件**: AEBase.sol:1502-1509
**严重程度**: 🔵 低危

```solidity
uniswapV2Router.swapExactTokensForTokens(
    xfAmount, 0, path, address(fundRelay), block.timestamp + 300
)
```

**问题描述**:
AE 代币本身有转账税(买卖时), 使用不支持 fee-on-transfer 的 swap 函数可能导致交易失败。虽然此处 from 是合约自身(白名单), 但如果白名单配置有误则会出问题。

---

## ⚪ 信息性问题

### I-01: 中心化风险 — Owner 权限过大

Owner 拥有以下关键权限:

| 函数 | 风险 |
|------|------|
| `setBlacklisted` | 可冻结任意用户资产 |
| `setColdTime` | 可阻止所有用户卖出 |
| `setSwapAtAmount` | 可阻止费用处理 |
| `setMarketingAddress` | 可更改费用接收地址 |
| `setFeeWhitelisted` | 可让任意地址免税交易 |
| `recoverStuckTokens` | 可提取合约中的 USDX |
| `setPresaleActive` | 可反复开启预售阻止购买 |
| `setDelayedBuyEnabled` | 可阻止购买 |

**建议**: 考虑使用 Timelock + 多签钱包管理 owner 权限, 或将部分功能设为不可变。

---

### I-02: 缺少重入保护

**问题描述**:
合约使用自定义的 `lockSwap` modifier 防止 swap 重入, 但没有使用 OpenZeppelin 的 `ReentrancyGuard`。`_handleSell` 函数中先执行外部调用(swap), 再更新状态(投资记录), 虽然 Solidity 0.8.x 的 checks-effects-interactions 模式在此处基本安全, 但建议使用标准的重入保护。

---

### I-03: `SELL_LIQUIDITY_ACCUM_FEE` 命名误导

**文件**: AEBase.sol:209
**严重程度**: ⚪ 信息

```solidity
uint256 private constant SELL_LIQUIDITY_ACCUM_FEE = 150; // 1.5%
```

常量名暗示是"流动性累积费", 但实际在 `_handleSell` 中用作销毁费 (`burnFee`), 代币被发送到 `DEAD_ADDRESS`。命名与实际用途不符。

---

### I-04: 未使用的函数

以下函数已定义但在合约内部未被调用:
- `_emitBuyTransactionEvent` (第1433行)
- `_estimateSwapInput` (第1457行)
- `_processImmediateLiquidity` / `_processImmediateLiquidityInternal` (第1543/1558行)
- `_processProfitTax` (第1582行)
- `_processFundRelayFees` (第1493行)
- `_handleLiquidityOperation` (第673行)

这些可能是旧版本遗留代码, 增加了合约大小和部署成本。

---

### I-05: `_addLiquidity` 函数中 `amountMin` 也为 0

**文件**: AEBase.sol:1362-1380

与 H-02 类似, `_addLiquidity` 中的 `addLiquidity` 调用也没有最小值保护。

---

## 漏洞汇总

| 编号 | 严重程度 | 标题 |
|------|----------|------|
| C-01 | 🔴 严重 | `_swapTokensForUSDX` 滑点保护为零 |
| C-02 | 🔴 严重 | `recycle` 函数可操纵价格 |
| C-03 | 🔴 严重 | 卖出盈利税基于预估值, 与实际偏差大 |
| H-01 | 🟠 高危 | 盈利税 swap 失败但卖出继续 |
| H-02 | 🟠 高危 | `addLiquidity` 无最小值保护 |
| H-03 | 🟠 高危 | `recoverStuckTokens` 可提取 USDX |
| H-04 | 🟠 高危 | 费用清零后 swap 失败导致费用丢失 |
| H-05 | 🟠 高危 | `FundRelay.receiveAndForward` 无访问控制 |
| M-01 | 🟡 中危 | swap 失败时 USDX 流向营销地址 |
| M-02 | 🟡 中危 | `isContract` 可被绕过 |
| M-03 | 🟡 中危 | `userInvestment` 部分卖出跟踪不准确 |
| M-04 | 🟡 中危 | `coldTime` 无上下限 |
| M-05 | 🟡 中危 | `swapAtAmount` 无上下限 |
| M-06 | 🟡 中危 | 盈利税 swap 影响后续卖出价格 |
| L-01 | 🔵 低危 | Transfer 事件追踪困难 |
| L-02 | 🔵 低危 | 批量操作无数组长度限制 |
| L-03 | 🔵 低危 | FundRelay 无限授权 |
| L-04 | 🔵 低危 | 事件参数命名不一致 |
| L-05 | 🔵 低危 | swap 函数类型不匹配 |
| I-01 | ⚪ 信息 | 中心化风险 |
| I-02 | ⚪ 信息 | 缺少标准重入保护 |
| I-03 | ⚪ 信息 | 常量命名误导 |
| I-04 | ⚪ 信息 | 未使用的函数 |
| I-05 | ⚪ 信息 | `_addLiquidity` 无最小值保护 |

---

## 总结

AE 合约存在 3 个严重问题、5 个高危问题、6 个中危问题。最关键的是:

1. **三明治攻击风险** (C-01): 所有 swap 操作的滑点保护为零, 这是最紧迫需要修复的问题
2. **价格操纵** (C-02): `recycle` 函数可直接从 Pair 转出代币
3. **盈利税计算偏差** (C-03/M-06): 预估值与实际值的偏差会系统性地损害用户利益
4. **费用丢失风险** (H-04): swap 失败时累积的费用会永久丢失
5. **中心化风险** (I-01): Owner 权限过大, 建议引入 Timelock 和多签
