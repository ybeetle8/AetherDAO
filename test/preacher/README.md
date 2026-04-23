# 模块 7：布道者身份 (Preacher) 测试

## 测试内容

| 编号 | 测试项 | 说明 |
|------|--------|------|
| 7.1 | 自动获得布道者 | 质押总额 >= 200 USDT 时 isPreacher 返回 true |
| 7.2 | 未达门槛 | 质押 100 USDT，isPreacher 返回 false |
| 7.3 | 恰好达到门槛 | 质押恰好 200 USDT，isPreacher 返回 true |
| 7.4 | 赎回后失去身份 | 赎回后质押总额 < 200 USDT，isPreacher 返回 false |
| 7.5 | 多笔质押累计 | 两笔 100 USDT 质押，合计 200 USDT，应为布道者 |

## 执行方式

确保本地节点已启动且已部署合约：

```bash
npx hardhat run test/preacher/preacher.test.js --network localhost
```
