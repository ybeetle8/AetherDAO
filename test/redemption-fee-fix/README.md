# C-01：赎回手续费缺陷修复验证测试

## 测试内容

| 编号 | 测试项 | 说明 |
|------|--------|------|
| RF-1 | unstake: 用户到手已扣赎回费 | 用户收到的 USDX = (usdxReceived - edu - team) * 95% |
| RF-2 | unstake: feeRecipient 收到赎回费 | feeRecipient 余额增加额等于事件中赎回费金额 |
| RF-3 | unstake: 赎回费精确 5% | 赎回费 = userPayout(扣费前) * 500 / 10000 |
| RF-4 | unstake: 事件 aeAmount 为 0 | 方案 A 不再消耗额外 AE |
| RF-5 | unstake: 资金平衡 | educationFund + teamFee + redemptionFee + userPayout = usdxReceived |
| RF-6 | unstake: 不额外消耗 AE | 赎回费从 USDX 中扣除，不触发额外 swap |
| RF-7 | withdrawInterest: 用户到手已扣赎回费 | 同 RF-1，针对提息场景 |
| RF-8 | withdrawInterest: feeRecipient 收到赎回费 | 同 RF-2，针对提息场景 |
| RF-9 | withdrawInterest: 资金平衡 | 同 RF-5，针对提息场景 |

## 执行方式

确保本地节点已启动且已部署合约：

```bash
npx hardhat run test/redemption-fee-fix/redemption-fee-fix.test.js --network localhost
```
