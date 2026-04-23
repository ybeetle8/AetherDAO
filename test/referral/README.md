# 模块 4：推荐人绑定 测试

## 测试文件

- `referral-bind.test.js` — 测试 4.1~4.8（绑定操作、权限校验、循环引用、深度限制）
- `referral-query.test.js` — 测试 4.9~4.16（root绑定、事件验证、查询函数、批量绑定边界）

## 执行方式

确保本地节点已启动且已部署合约，然后分别运行：

```bash
npx hardhat run test/referral/referral-bind.test.js --network localhost
npx hardhat run test/referral/referral-query.test.js --network localhost
```

或一次性运行全部：

```bash
npx hardhat run test/referral/referral-bind.test.js --network localhost && \
npx hardhat run test/referral/referral-query.test.js --network localhost
```
