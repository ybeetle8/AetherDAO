# FundRelay 详解

## 它解决什么问题？

PancakeSwap（Uniswap V2）的 Pair 合约里有一个校验：**swap 的接收地址不能是交易对中的代币合约本身**。违反这个规则会触发 `INVALID_TO` 错误。

具体场景：AE 合约在处理手续费时，需要把自己持有的 AE 代币 swap 成 USDX。swap 路径是 AE → USDX，交易对是 AE/USDX。问题来了——swap 产出的 USDX 要发给谁？

- 发给 AE 合约自身？不行。AE 是交易对的一方，PancakeSwap 会拒绝：`require(to != token0 && to != token1, 'INVALID_TO')`
- 发给某个外部地址？可以，但 AE 合约还需要拿到这些 USDX 来做后续分配

**FundRelay 就是这个"外部地址"**——一个极简的中间人合约，专门用来接收 swap 产出的 USDX，然后立刻转回给 AE 合约。

## 工作原理

```
AE 合约发起 swap
       ↓
PancakeSwap Router 执行 AE → USDX
       ↓
USDX 发送到 FundRelay（绕过 INVALID_TO 校验）
       ↓
AE 合约调用 fundRelay.receiveAndForward()
       ↓
FundRelay 把 USDX 转回 AE 合约
```

整个过程在一笔交易内完成，用户无感知。

## 合约结构

**文件位置：** `contracts/AE/src/utils/FundRelay.sol`

FundRelay 非常简单，只有三个不可变的状态变量：

```solidity
address public immutable AE_CONTRACT;         // AE 合约地址
address public immutable USDX;                // USDX 代币地址
address public immutable EMERGENCY_RECIPIENT; // 紧急提取地址
```

构造函数中做了一件关键的事——预授权 AE 合约可以无限额转走 USDX：

```solidity
IERC20(_usdx).approve(_aeContract, type(uint256).max);
```

### 核心函数

| 函数 | 作用 | 谁能调用 |
|------|------|----------|
| `receiveAndForward()` | 把当前持有的 USDX 全部转给 AE 合约 | 外部调用 |
| `withdrawToAE(amount)` | AE 合约提取指定数量的 USDX | 仅 AE 合约 |
| `withdrawAEToContract(amount)` | AE 合约提取指定数量的 AE 代币 | 仅 AE 合约 |
| `emergencyWithdraw()` | 紧急提取全部 USDX | 仅紧急接收人 |
| `emergencyWithdrawToken(token, amount)` | 紧急提取任意代币 | 仅紧急接收人 |

## 在 AE 合约中的四个使用场景

### 场景 1：手续费 swap（核心场景）

**函数：** `_swapTokensForUSDX()`（`AEBase.sol:897-958`）

AE 合约累积了一定量的手续费（AE 代币）后，需要 swap 成 USDX 来分配给各方。

```
AE 合约持有的手续费 AE
    ↓ approve Router
Router.swapExactTokensForTokensSupportingFeeOnTransferTokens()
    ↓ USDX 发到 FundRelay
fundRelay.receiveAndForward()
    ↓ USDX 转回 AE 合约
AE 合约拿到 USDX，进行后续分配
```

如果 FundRelay 未设置，代码会尝试直接把 USDX 发到 AE 合约自身——这在某些情况下可能触发 `INVALID_TO`。

### 场景 2：常规转账时触发分配

**函数：** `_tryTriggerFundRelayDistribution()`（`AEBase.sol:1237-1250`）

每次普通转账（非买卖）时，AE 合约会尝试调用 `fundRelay.receiveAndForward()`，把 FundRelay 中可能残留的 USDX 取回来。这是一个"顺便清扫"的机制。

如果 FundRelay 未设置，直接跳过。

### 场景 3：Fund Relay 手续费处理

**函数：** `_processFundRelayFees()`（`AEBase.sol:1499-1547`）

处理通过 FundRelay 累积的手续费：

```
从 FundRelay 取回 AE 代币
    ↓ swap AE → USDX（通过 FundRelay 中转）
    ↓ 从 FundRelay 取回 USDX
分配：60% → 营销地址，40% → LP 质押奖励
```

### 场景 4：即时流动性处理

**函数：** `_processImmediateLiquidity()`（`AEBase.sol:1549-1586`）

处理流动性手续费时，如果当前正在 swap 中（`_inSwap == true`），会把 AE 代币暂存到 FundRelay，等下次再处理。

如果 FundRelay 未设置，改为累加到 `amountLPFee` 变量中。

## 不设置 FundRelay 会怎样？

合约代码对 FundRelay 做了零地址判断，不会直接崩溃，但行为会降级：

| 场景 | 有 FundRelay | 无 FundRelay |
|------|-------------|-------------|
| 手续费 swap | USDX 经 FundRelay 中转，安全可靠 | 直接发到 AE 合约，可能触发 INVALID_TO |
| 转账时清扫 | 取回残留 USDX | 跳过 |
| Fund Relay 手续费 | 正常处理和分配 | 无法执行 |
| 即时流动性 | 暂存到 FundRelay | 累加到变量，延后处理 |

**结论：** 不设置不会让合约崩溃，但手续费的 swap 和分配流程不完整，正式运营前必须部署和配置。

## 部署和配置

FundRelay 需要在 AE 合约部署之后单独部署，因为它的构造函数需要 AE 合约地址：

```javascript
// 1. 部署 FundRelay
const FundRelay = await ethers.getContractFactory("FundRelay");
const fundRelay = await FundRelay.deploy(
    ae.address,           // AE 合约地址
    USDX_ADDRESS,         // USDX 地址
    emergencyRecipient    // 紧急提取地址
);

// 2. 在 AE 合约中配置
await ae.setFundRelay(fundRelay.address);
// setFundRelay 会同时把 FundRelay 加入手续费白名单
```

## 安全设计

- **不可变地址：** AE_CONTRACT、USDX、EMERGENCY_RECIPIENT 都是 immutable，部署后无法修改
- **权限控制：** 只有 AE 合约能调用 withdraw 系列函数
- **紧急机制：** 如果出现异常，紧急接收人可以提取卡住的资金
- **预授权：** 构造时就授权 AE 合约，避免每次转账都需要额外的 approve 交易
- **白名单：** `setFundRelay()` 会自动把 FundRelay 加入手续费白名单，FundRelay 与 AE 之间的转账不收税
