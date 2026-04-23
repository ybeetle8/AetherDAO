# 模块 2：到期赎回 (unstake) 测试

## 前置条件

1. 启动本地 Hardhat 节点（Fork BSC 主网）
2. 执行部署脚本 `deployAE.js`

## 执行方式

```bash
# 先运行第一部分 (2.1~2.8)
npx hardhat run test/unstake/unstake-basic.test.js --network localhost

# 再运行第二部分 (2.9~2.15)
npx hardhat run test/unstake/unstake-advanced.test.js --network localhost
```

## 测试项

| 文件 | 测试项 | 说明 |
|------|--------|------|
| unstake-basic.test.js | 2.1~2.8 | 正常赎回、未到期、复利、教育基金、团队奖励、手续费、余额清零 |
| unstake-advanced.test.js | 2.9~2.15 | 重复赎回、多笔独立赎回、事件验证、历史记录、各期限收益、利息提取后赎回 |

## 注意

- 使用 `evm_increaseTime + evm_mine` 进行时间加速
- 每个测试使用独立账户（accounts[20]~[33]），避免状态干扰
- 时间推进是全局累积的，测试顺序需按文件内顺序执行
