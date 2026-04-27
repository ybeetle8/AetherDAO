# 质押订单列表查询测试

## 概述

测试 `getUserStakeRecords()` 批量查询接口，验证一次 RPC 调用即可返回用户所有质押订单的完整信息。

## 测试项

| 编号 | 测试项 | 说明 |
|------|--------|------|
| SOL-1 | 无质押时返回空数组 | 未质押用户调用返回 `[]` |
| SOL-2 | 单笔质押后列表正确 | 质押 500 USDX (档位1) 后，列表包含1条记录，字段正确 |
| SOL-3 | 多笔质押列表完整 | 质押3笔不同档位后，列表包含3条记录，index 0/1/2 |
| SOL-4 | 当前价值计算正确 | `currentValue` >= `amount`（因含利息） |
| SOL-5 | 到期判断正确 | 推进时间到期后，`canWithdraw=true`, `timeRemaining=0` |
| SOL-6 | 已提取状态正确 | unstake 后该订单 `status=true`, `currentValue=0` |
| SOL-7 | 已提取利息金额正确 | withdrawInterest 后 `withdrawnInterestAmount` > 0 |

## 运行方法

### 前置条件

需要先启动本地测试网络并完成部署：

```bash
# 终端 1: 启动本地测试网络 (Fork BSC 主网)
npx hardhat node --hostname 0.0.0.0 --port 8545 --fork https://rpc.tornadoeth.cash/bsc --fork-block-number 64340000

# 终端 2: 部署合约
npx hardhat run scripts/deployAE.js --network localhost
```

### 运行测试

```bash
npx hardhat run test/stake-order-list/stake-order-list.test.js --network localhost
```

### 一键编译-部署-测试

```bash
npx hardhat compile && \
npx hardhat run scripts/deployAE.js --network localhost && \
npx hardhat run test/stake-order-list/stake-order-list.test.js --network localhost
```
