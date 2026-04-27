# 全局数据记录功能测试

## 测试概述

验证合约中新增的全局统计数据链上记录功能，包括:

| 编号 | 测试项 | 说明 |
|------|--------|------|
| GS-1 | 初始值验证 | 所有全局统计初始值为 0 |
| GS-2 | 质押后参与人数增加 | 新用户首次质押后 totalStakers +1 |
| GS-3 | 同一用户多次质押不重复计数 | 已有质押的用户再次质押，totalStakers 不变 |
| GS-4 | 多用户质押后参与人数正确 | 第二个用户质押后 totalStakers 再 +1 |
| GS-5 | unstake 后分红和教育基金累计正确 | totalDividendsDistributed 和 totalEducationFundDistributed 增加 |
| GS-6 | 部分解质押不影响计数 | 用户只取出部分质押，totalStakers 不变 |
| GS-7 | 全部解质押后参与人数减少 | 用户取出全部本金后 totalStakers -1 |
| GS-8 | withdrawInterest 后分红累计正确 | totalDividendsDistributed 增加 userPayout 金额 |
| GS-9 | getTotalBurned 返回正确值 | 等于 DEAD_ADDRESS 的 AE 余额 |
| GS-10 | getGlobalStats 返回一致数据 | 一次调用获取所有统计，与单独查询一致 |
| GS-11 | 多用户交叉操作正确性 | 多个用户同时质押/解质押，所有计数器正确 |

## 运行方式

### 前置条件

需要先启动本地 Hardhat 节点（Fork BSC 主网）并部署合约。

### 1. 启动本地节点

```bash
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000
```

### 2. 编译并部署合约（另开一个终端）

```bash
npx hardhat compile && npx hardhat run scripts/deployAE.js --network localhost
```

### 3. 运行全局数据记录测试

```bash
npx hardhat run test/global-stats/global-stats.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deployAE.js --network localhost && \
npx hardhat run test/global-stats/global-stats.test.js --network localhost
```

## 涉及的合约修改

| 文件 | 修改内容 |
|------|----------|
| `contracts/AE-Staking/src/abstract/StakingBase.sol` | 新增状态变量、修改 4 个函数、新增 view 函数 |
| `contracts/AE-Staking/src/interfaces/IStaking.sol` | 新增 view 函数声明、events |
| `contracts/AE/src/abstract/AEBase.sol` | 新增 `getTotalBurned()` view 函数 |
| `contracts/AE-Staking/src/interfaces/IAE.sol` | 新增 `getTotalBurned()` 函数声明 |
