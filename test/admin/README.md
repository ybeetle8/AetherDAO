# 模块 8：管理员功能测试

## 测试文件

| 文件 | 测试项 | 说明 |
|------|--------|------|
| admin-basic.test.js | 8.1 ~ 8.7 | setRootAddress, setAE, setFeeRecipient, emergencyWithdraw, reset7DayStakeUsage |
| admin-advanced.test.js | 8.8 ~ 8.10 | 非 owner 权限检查, FeeRecipientUpdated 事件, 7天重置后再质押 |

## 执行方式

```bash
# 前提：本地节点已启动，合约已部署

# 运行第一部分 (8.1~8.7)
npx hardhat run test/admin/admin-basic.test.js --network localhost

# 运行第二部分 (8.8~8.10)
npx hardhat run test/admin/admin-advanced.test.js --network localhost

# 全部运行
npx hardhat run test/admin/admin-basic.test.js --network localhost && \
npx hardhat run test/admin/admin-advanced.test.js --network localhost
```
