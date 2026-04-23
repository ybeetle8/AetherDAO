# 质押功能 (stake) 测试

## 前置条件

1. 启动本地 Hardhat 节点（Fork BSC 主网）：
```bash
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000
```

2. 部署 AE 系统：
```bash
npx hardhat run scripts/deployAE.js --network localhost
```

## 执行测试

```bash
# 第一部分：测试项 1.1~1.9（基本质押、限额、期限、推荐人）
npx hardhat run test/staking/stake-basic.test.js --network localhost

# 第二部分：测试项 1.10~1.15（流动性、LP烧毁、累计、事件）
npx hardhat run test/staking/stake-advanced.test.js --network localhost
```

## 注意事项

- 测试使用 `evm_increaseTime` + `evm_mine` 进行时间加速
- 每次质押前推进 120 秒以重置 `NETWORK_CHECK_INTERVAL`（1分钟）窗口
- 测试使用 `accounts[10]~[18]` 避免与其他脚本的账户冲突
- 节点状态是持久的，重复运行测试前建议重启节点并重新部署
