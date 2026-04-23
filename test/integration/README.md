# 模块 12：综合场景测试

## 文件说明

| 文件 | 测试项 | 说明 |
|------|--------|------|
| integration-basic.test.js | 12.1~12.4 | 用户生命周期、多级推荐链、等级升降、多期限质押 |
| integration-fees.test.js | 12.5~12.7 | 教育基金累计、赎回费累计、7天质押重置流程 |
| integration-advanced.test.js | 12.8~12.10 | 大规模用户、利息提取+赎回组合、紧急提取后状态 |

## 前置条件

1. 启动本地节点（Fork BSC 主网）
2. 部署 AE 系统

```bash
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000
npx hardhat run scripts/deployAE.js --network localhost
```

## 执行命令

```bash
# 运行全部综合场景测试
npx hardhat run test/integration/integration-basic.test.js --network localhost
npx hardhat run test/integration/integration-fees.test.js --network localhost
npx hardhat run test/integration/integration-advanced.test.js --network localhost

# 或逐个运行
npx hardhat run test/integration/integration-basic.test.js --network localhost   # 12.1~12.4
npx hardhat run test/integration/integration-fees.test.js --network localhost    # 12.5~12.7
npx hardhat run test/integration/integration-advanced.test.js --network localhost # 12.8~12.10
```

## 注意事项

- 12.8 大规模用户测试会创建 20+ 个钱包，执行时间较长
- 每个测试文件使用 snapshot/revert 机制，不会污染后续测试
- 测试依赖 `ae-deployment.json`，确保部署脚本已执行
