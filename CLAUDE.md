# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在处理此代码库时提供指导。

## 项目概览

AetherDAO 是一个部署在 BSC (币安智能链) 上的 DeFi 质押系统，具有零税代币和复杂的奖励机制。

### 核心组件


## 开发命令

### 文档位置
md 文档都放到 notes 目录下面,用中文写.  如果文档太长, 可以使用分段的方式,避免写入出错..


### 编译和测试

```bash
# 编译合约
npx hardhat compile

# 启动本地测试网络（Fork BSC 主网）
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 部署 SYI 系统（在另一个终端）
npx hardhat run scripts/deploySYI.js --network localhost

# 运行测试脚本
npx hardhat run scripts/testSYI.js --network localhost
npx hardhat run scripts/testSYIStaking.js --network localhost
npx hardhat run scripts/testSYISwap.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deploySYI.js --network localhost && \
npx hardhat run scripts/testSYI.js --network localhost
```
