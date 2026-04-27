# H-01: addLiquidity 三明治攻击修复验证测试

## 修复内容

`StakingBase._swapAndAddLiquidity()` 中 `ROUTER.addLiquidity()` 的 `amountAMin` 和 `amountBMin` 原来为 `0`，存在三明治攻击风险。

修复方案（方案 A）：基于实际 swap 结果计算 amountMin，使用 5% (500 bps) 的滑点容忍度。

```solidity
uint256 amountUsdxMin = (remainingUsdx *
    (BASIS_POINTS_DENOMINATOR - ADD_LIQUIDITY_SLIPPAGE_TOLERANCE)) /
    BASIS_POINTS_DENOMINATOR;
uint256 amountAeMin = (aeTokensReceived *
    (BASIS_POINTS_DENOMINATOR - ADD_LIQUIDITY_SLIPPAGE_TOLERANCE)) /
    BASIS_POINTS_DENOMINATOR;
```

## 测试项说明

| 编号 | 测试项 | 说明 |
|------|--------|------|
| SA-1 | 常量验证 | ADD_LIQUIDITY_SLIPPAGE_TOLERANCE = 500 bps，原有 swap 滑点配置未被修改 |
| SA-2 | 小额质押 | 修复后 100 USDX 质押正常成功，事件正确触发 |
| SA-3 | 大额质押 | 修复后 1000 USDX 质押正常成功 |
| SA-4 | 滑点保护验证 | addLiquidity 实际接收的代币量在 5% 容忍度内 |
| SA-5 | 连续质押 | 多次连续质押均成功，修复不引入累积问题 |
| SA-6 | 全锁仓期兼容 | 所有锁仓期 (7/30/90/180/365天) 质押均兼容修复 |

## 执行方式

确保本地节点已启动且已部署合约：

```bash
# 1. 启动本地节点（Fork BSC 主网）
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 2. 编译并部署合约（在另一个终端）
npx hardhat compile
npx hardhat run scripts/deploySYI.js --network localhost

# 3. 运行测试
npx hardhat run test/sandwich-attack-fix/sandwich-attack-fix.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deploySYI.js --network localhost && \
npx hardhat run test/sandwich-attack-fix/sandwich-attack-fix.test.js --network localhost
```
