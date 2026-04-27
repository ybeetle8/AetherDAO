# C-01 / M-02 修复验证：Tier 数组越界

## 问题描述

- **C-01**: `tierAllocated` 数组为 `bool[8]`，只能索引 0-7，但 tier 范围为 1-9。当推荐链上出现 V8/V9 用户时，访问 `tierAllocated[8]` 或 `tierAllocated[9]` 导致越界 revert，用户 unstake/withdrawInterest 失败。
- **M-02**: `tierRecipients[7]` / `tierAmounts[7]` 只有 7 个槽位，V9 (index 8) 越界；`activeTiers` 为 `uint8`，`1 << 8 = 256` 超出范围溢出为 0。

## 修复内容

| 位置 | 修改前 | 修改后 |
|------|--------|--------|
| `StakingBase.sol:1461` | `bool[8] memory tierAllocated` | `bool[10] memory tierAllocated` |
| `StakingBase.sol` 多处 | `address[7]` / `uint256[7]` | `address[9]` / `uint256[9]` |
| `StakingBase.sol` 多处 | `uint8 activeTiers` | `uint16 activeTiers` |
| `StakingBase.sol` 多处 | `uint8(1 << (currentTier - 1))` | `uint16(1 << (currentTier - 1))` |
| `IStaking.sol` 事件定义 | `address[7]`, `uint256[7]`, `uint8` | `address[9]`, `uint256[9]`, `uint16` |

## 测试项

| 编号 | 描述 |
|------|------|
| TB-1 | V8 用户在推荐链上时 unstake 不 revert |
| TB-2 | V9 用户在推荐链上时 unstake 不 revert |
| TB-3 | V8/V9 差额团队奖励正确分配 |
| TB-4 | activeTiers 位图正确标记 V8/V9 |
| TB-5 | 合约 AE / USDX 余额查询 |

## 运行方式

确保本地节点已启动且合约已部署：

```bash
# 1. 启动本地节点 (Fork BSC 主网)
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 2. 部署合约 (另一个终端)
npx hardhat run scripts/deploySYI.js --network localhost

# 3. 运行测试
npx hardhat run test/tier-bounds-fix/tier-bounds-fix.test.js --network localhost
```

一键编译-部署-测试：

```bash
npx hardhat compile && \
npx hardhat run scripts/deploySYI.js --network localhost && \
npx hardhat run test/tier-bounds-fix/tier-bounds-fix.test.js --network localhost
```
