# P0: compoundStartTime 复利修复验证测试

## 修复内容

修复两个 P0 级复利计算缺陷：

### 缺陷 1：提息后复利多算（复利膨胀）

用户中途 `withdrawInterest()` 提取利息后，`_calculateStakeReward()` 仍从质押开始时间按全周期复利计算，导致最终 `unstake()` 时严重多付。

**修复**：在 `Record` 结构体中新增 `compoundStartTime` 字段，每次提息后重置为当前时间，`_calculateStakeReward()` 基于此字段计算复利。

### 缺陷 2：提息后整除截断少算一天

`withdrawInterest()` 将 `compoundStartTime` 设为 `block.timestamp`（精确到秒），但复利按整天计算（除以 86400）。提息不可能恰好在整天边界，零头秒数导致整数除法截断，解押时少算 1 天。

**修复**：`compoundStartTime` 对齐到复利周期边界（去掉零头秒数），而非直接使用 `block.timestamp`。

## 测试项说明

| 编号 | 测试项 | 说明 |
|------|--------|------|
| CST-1 | 7天期整除截断验证 | 第1天提息后解押应得6天复利（非5天），核心验证截断修复 |
| CST-2 | 30天期对齐验证 | 第15天提息后解押应得15天复利，验证非7天档位 |
| CST-3 | 对照组：提息 vs 纯持有 | 提息+解押总收益 ≤ 纯持有解押，验证复利膨胀修复 |
| CST-4 | 到期后全额提息再解押 | unstake 利息趋近 0，仅返本金 |
| CST-5 | 从未提息的用户 | 行为与修复前一致，向后兼容 |
| CST-6 | 90天期多次提息对齐 | 每30天提息一次，验证每段 compoundStartTime 正确对齐 |
| CST-7 | 向后兼容验证 | 新质押 compoundStartTime 正确初始化为 stakeTime |

## 执行方式

确保本地节点已启动且已部署合约：

```bash
# 1. 启动本地节点 (Fork BSC 主网)
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 2. 编译并部署合约 (在另一个终端)
npx hardhat compile
npx hardhat run scripts/deployAE.js --network localhost

# 3. 运行测试
npx hardhat run test/compound-start-time-fix/compound-start-time-fix.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deployAE.js --network localhost && \
npx hardhat run test/compound-start-time-fix/compound-start-time-fix.test.js --network localhost
```
