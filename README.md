# SYI 系统部署与测试命令

**最新版本**: v1.0 - 完全版本

我已建立了主网的镜像节点，并部署了合约，以供开发与测试。

## 已部署的合约地址


合约的参数在 [ae-deployment.json](ae-deployment.json) 文件上, 有重新部署后会改变, 地址要从这文件读
说明文档在: [ae-deployment-json 前端对接说明](doc/ae-deployment-json%20前端对接说明.md)
前端开发文档: [前端开发文档](doc/前端开发文档.md)




## 钱包测试 RPC

可在 MetaMask 钱包中添加以下 RPC（记得添加代币 SYI 与 USDT）：

- **网络名称**: GoChain Testnet
- **RPC URL**: http://47.109.157.92:8545  
- **Chain ID**: 56
- **币名**: GO（BNB 的别名）

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



```



### 相关文档

- [前端链上数据获取指南](notes/前端链上数据获取指南.md)


