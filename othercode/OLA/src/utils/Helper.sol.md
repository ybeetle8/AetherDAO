# Helper.sol 合约功能说明

## 概述
`Helper.sol` 是一个Solidity工具库，提供了智能合约开发中常用的辅助函数，主要用于DEX（去中心化交易所）的交换计算。

## 合约信息
- **类型**: Library（库合约）
- **Solidity版本**: ^0.8.20
- **License**: UNLICENSED

## 主要功能

### 1. isContract(address account)
**功能**: 检查给定地址是否为智能合约

**实现原理**:
- 使用汇编语言的 `extcodesize` 操作码获取地址的代码大小
- 如果代码大小 > 0，则该地址为合约地址
- 否则为普通外部账户（EOA）

**返回值**: `bool` - 如果是合约地址返回true，否则返回false

**使用场景**: 用于区分合约地址和普通用户地址，常用于权限控制和安全检查

---

### 2. getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
**功能**: 计算给定输入数量的代币，能兑换出多少输出代币（类似Uniswap的swap计算）

**参数**:
- `amountIn`: 输入代币数量
- `reserveIn`: 输入代币的流动性池储备量
- `reserveOut`: 输出代币的流动性池储备量

**计算公式**:
```
amountInWithFee = amountIn × 9975
numerator = amountInWithFee × reserveOut
denominator = (reserveIn × 10000) + amountInWithFee
amountOut = numerator / denominator
```

**手续费**: 0.25% (使用9975/10000来实现扣除手续费后的计算)

**返回值**: `uint256 amountOut` - 可以获得的输出代币数量

**使用场景**: 在执行swap交易前预估能获得的代币数量

---

### 3. getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
**功能**: 计算为了获得指定数量的输出代币，需要输入多少代币（反向计算）

**参数**:
- `amountOut`: 期望获得的输出代币数量
- `reserveIn`: 输入代币的流动性池储备量
- `reserveOut`: 输出代币的流动性池储备量

**计算公式**:
```
numerator = reserveIn × amountOut × 10000
denominator = (reserveOut - amountOut) × 9975
amountIn = (numerator / denominator) + 1
```

**特点**:
- 同样考虑了0.25%的手续费
- 结果+1是为了防止由于除法向下取整导致的输入不足

**返回值**: `uint256 amountIn` - 需要输入的代币数量

**使用场景**: 当用户指定想要获得的精确输出数量时，计算需要投入的输入数量

---

## 技术特点
1. **Pure函数**: `getAmountOut` 和 `getAmountIn` 都是pure函数，不读取也不修改状态，只进行数学计算
2. **Gas优化**: 作为library使用，可以被其他合约复用，节省部署成本
3. **兼容Uniswap**: 计算逻辑与Uniswap V2的AMM算法兼容，手续费为0.25%

## 安全考虑
- 所有函数都是internal，只能被引用该库的合约调用
- 数学计算使用Solidity 0.8+的内置溢出保护
- `getAmountIn`的+1操作确保不会因为精度损失导致swap失败
