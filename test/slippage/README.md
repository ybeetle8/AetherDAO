# 模块 10：滑点保护与 DEX 交互 测试

## 测试文件

- `slippage-dex.test.js` — 测试项 10.1 ~ 10.5

## 执行方式

确保本地节点已启动并已部署合约，然后执行：

```bash
npx hardhat run test/slippage/slippage-dex.test.js --network localhost
```

## 测试项说明

| 编号 | 测试项 | 说明 |
|------|--------|------|
| 10.1 | 基础滑点容忍度 | 验证 getSlippageConfig 返回 15%/20%/2%，previewStakeOutput 小额质押使用基础滑点 |
| 10.2 | 最大滑点容忍度 | 大额质押触发高价格冲击时，动态滑点 cap 到 20% |
| 10.3 | 价格冲击阈值 | 对比低冲击(<2%)和高冲击(>2%)的 minAEOut 比例差异 |
| 10.4 | AE 买入费用计算 | 验证 3% 总买入费 (0.5% burn + 2.5% 流动性)，并实际执行质押 |
| 10.5 | swap 失败处理 | 授权不足、余额不足时质押 revert，正常条件下成功 |
