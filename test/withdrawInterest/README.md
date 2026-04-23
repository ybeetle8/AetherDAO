# 模块 3：提前提取利息 (withdrawInterest) 测试

## 前置条件

1. 启动本地 Hardhat 节点（Fork BSC 主网）
2. 执行部署脚本 `deployAE.js`

## 执行方式

```bash
# 先运行第一部分 (3.1~3.6)
npx hardhat run test/withdrawInterest/withdrawInterest-basic.test.js --network localhost

# 再运行第二部分 (3.7~3.11)
npx hardhat run test/withdrawInterest/withdrawInterest-advanced.test.js --network localhost
```

## 测试项

| 文件 | 测试项 | 说明 |
|------|--------|------|
| withdrawInterest-basic.test.js | 3.1~3.6 | 基本利息提取、本金不变、教育基金、团队奖励、赎回手续费、多次提取 |
| withdrawInterest-advanced.test.js | 3.7~3.11 | 已提取利息追踪、可用利息查询、无可用利息、事件验证、提取后继续生息 |

## 注意

- 使用 `evm_increaseTime + evm_mine` 进行时间加速
- 每个测试使用独立账户（accounts[14]~[18]），避免状态干扰
- 时间推进是全局累积的，测试顺序需按文件内顺序执行
