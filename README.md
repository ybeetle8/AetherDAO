# AetherDAO 系统部署与测试命令

**最新版本**: v1.0 - 完全版本

我已建立了主网的镜像节点，并部署了合约，以供开发与测试。

## 已部署的合约地址


合约的参数在 [ae-deployment.json](ae-deployment.json) 文件上, 有重新部署后会改变, 地址要从这文件读
说明文档在: [ae-deployment-json 前端对接说明](doc/ae-deployment-json%20前端对接说明.md)
前端开发文档: [前端开发文档](doc/前端开发文档.md)




## 钱包测试 RPC

可在 MetaMask 钱包中添加以下 RPC（记得添加代币 SYI 与 USDT）：

- **网络名称**: BSChome
- **RPC URL**: http://47.109.157.92:8545    ssl域名: https://9.ai-hello.cn
- **Chain ID**: 10056
- **币名**: tBNB（BNB 的别名）

## 测试代码及构建流程

### 环境要求

- Node.js >= 22
- Git

### 快速开始

```bash
# 测试,前端,后端 都能拉我这个代码直接运行测试代码,所有环境都对的,拉下来直接跑就行.

# 第一步：克隆代码
git clone https://github.com/ybeetle8/AetherDAO.git

# 第二步：进入项目目录
cd AetherDAO

# 第三步：安装依赖
npm install

# 第四步：编译合约
npx hardhat compile

```

### 常用测试脚本

```bash
# 发币到自己的钱包（进代码改下你的地址，运行后将发送 100 BNB 与 10000 USDT）
npx hardhat run scripts/sendBnbUsdc.js --network localhost

# 监听事件测试代码（打开后会打印所有事件，后端只需事件：BindReferral）
npx hardhat run scripts/monitorStakingEvents.js --network localhost

# 查看各种地址的 usdc 数量
npx hardhat run scripts/checkAddressUsdc.js --network localhost


# 跳转7天数
DAYS=7 npx hardhat run scripts/timeTravel.js --network localhost

# 跳转12小时
HOURS=12 npx hardhat run scripts/timeTravel.js --network localhost

```

### 交易所买卖测试

用于测试在 PancakeSwap 上买入/卖出 AE 代币。使用助记词派生的账户执行交易，USDX 不足时会自动补充。

```bash
# 买入 AE（默认用 accounts[5] 花 1000 USDX 买入）
npx hardhat run scripts/testSwapBuy.js --network localhost

# 卖出 AE（默认用 accounts[5] 卖出全部 AE）
npx hardhat run scripts/testSwapSell.js --network localhost

# 先买后卖（连续执行）
npx hardhat run scripts/testSwapBuy.js --network localhost && \
npx hardhat run scripts/testSwapSell.js --network localhost
```

配置说明（打开脚本修改顶部的配置区域）：
- `ACCOUNT_INDEX`: 使用助记词的第几个账户（0 是 deployer，建议用 1-19）
- `BUY_USDX_AMOUNT`: 用多少 USDX 买入 AE
- `SELL_AE_AMOUNT`: 卖出多少 AE（留空则卖出全部）


### 相关文档

- [前端链上数据获取指南](notes/前端链上数据获取指南.md)


