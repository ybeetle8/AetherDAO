# 模块 11：边界条件与安全测试

## 测试文件

| 文件 | 测试项 | 说明 |
|------|--------|------|
| boundary-security-basic.test.js | 11.1~11.6 | 零地址检查、重入防护、整数溢出、池子异常、sync函数、无效索引 |
| boundary-security-advanced.test.js | 11.7~11.11 | 合约调用限制、多用户并发、极小/极大金额、总质押上限 |

## 执行方式

确保本地节点已启动并已部署合约：

```bash
# 运行第一部分 (11.1~11.6)
npx hardhat run test/boundary-security/boundary-security-basic.test.js --network localhost

# 运行第二部分 (11.7~11.11)
npx hardhat run test/boundary-security/boundary-security-advanced.test.js --network localhost
```

## 测试项清单

- 11.1 零地址检查（setFeeRecipient / setAE / reset7DayStakeUsage / lockReferral）
- 11.2 重入攻击防护（onlyEOA + CEI 模式验证）
- 11.3 整数溢出（大额质押 + 365天长期限复利计算）
- 11.4 池子余额异常（储备量查询 + previewStakeOutput）
- 11.5 sync 函数（USDX 转移到 Pair 并同步）
- 11.6 无质押记录操作（unstake / withdrawInterest / canWithdrawStake 对无效索引的处理）
- 11.7 合约调用限制（onlyEOA 修饰符对 stake/unstake/withdrawInterest 的保护）
- 11.8 多用户并发质押（5用户独立质押，验证状态隔离）
- 11.9 极小金额质押（100 USDT 边界成功，99 USDT 边界失败）
- 11.10 极大金额质押（maxStakeAmount 边界成功，超出边界失败）
- 11.11 总质押恰好 10000 USDT（累计达到上限后继续质押应失败）
