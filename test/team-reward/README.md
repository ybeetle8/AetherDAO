# 模块 6：差额团队奖励分配 测试

## 测试文件

- `team-reward-basic.test.js` — 测试 6.1~6.5（基本差额分配、无推荐链、同等级不重复、等级递增链、等级递减链）
- `team-reward-advanced.test.js` — 测试 6.6~6.13（布道者检查、事件验证、奖励池验证、长推荐链、全链无布道者）

## 执行方式

确保本地节点已启动且已部署合约：

```bash
# 运行第一部分（6.1~6.5）
npx hardhat run test/team-reward/team-reward-basic.test.js --network localhost

# 运行第二部分（6.6~6.13）
npx hardhat run test/team-reward/team-reward-advanced.test.js --network localhost
```

## 注意事项

- 测试使用 `accounts[50]~[199]` 范围的账户，避免与其他模块冲突
- 每个测试用例使用 snapshot/revert 保证状态隔离
- 构建高等级用户需要大量 helper 账户质押以满足 KPI 门槛
