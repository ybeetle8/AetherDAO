# SYI 系统部署与测试命令

**最新版本**: v2.0 - 完全无税版本 (2025-10-13)

我已建立了主网的镜像节点，并部署了合约，以供开发与测试。

## 已部署的合约地址

- **SYI 币**: `0x853BF2ff186910A5Df8e9D8C48d24da883484C68`
  - 以 `syi-deployment.json` 文件中 `SYI` 值为准
- **Staking 质押合约**: `0x0F30b6db7ffFe0D465f989BFcC8a73A7cc4D69E9`
  - 以 `syi-deployment.json` 文件中 `Staking` 值为准
- **USDT 币**: `0x55d398326f99059fF775485246999027B3197955`
- **Root 钱包（根推荐人）**: `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`
- **质押费钱包（1%）**: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
- **ABI 文件位置**: `abi/SYI.json`, `abi/Staking.json`

> **⚠️ 重要**: 为了方便测试质押，合约已改为 **3 秒钟 = 1 天**  LP池子已添加4万USDT和4000万SYI
> 例如：质押 30 天，现实中等 90 秒即完成

## 钱包测试 RPC

可在 MetaMask 钱包中添加以下 RPC（记得添加代币 SYI 与 USDT）：

- **网络名称**: GoChain Testnet
- **RPC URL**: https://bsc.ai-hello.cn/
- **Chain ID**: 31337
- **币名**: GO（BNB 的别名）

## 测试代码及构建流程

### 环境要求

- Node.js >= 22
- Git

### 快速开始

```bash
# 测试,前端,后端 都能拉我这个代码直接运行测试代码,所有环境都对的,拉下来直接跑就行.

# 第一步：克隆代码
git clone https://github.com/ybeetle8/stable-yield.git

# 第二步：进入项目目录
cd stable-yield

# 第三步：安装依赖
npm install

# 第四步：编译合约
npx hardhat compile

# 第五步：运行测试脚本（向你的钱包发送 BNB 与 USDT，进代码改下你的地址）
npx hardhat run scripts/sendBnbUsdt.js --network localhost
```

### 常用测试脚本

```bash
# 发币到自己的钱包（进代码改下你的地址，运行后将发送 100 BNB 与 10000 USDT）
npx hardhat run scripts/sendBnbUsdt.js --network localhost

# 监听事件测试代码（打开后会打印所有事件，后端只需事件：BindReferral）
npx hardhat run scripts/monitorStakingEvents.js --network localhost

# 随机生成一个钱包成为你的下线并质押 USDT（代码里填你的钱包地址，快速测试发展下线）
npx hardhat run scripts/testStaking.js --network localhost

# 读取合约上用户信息的测试代码（前端,后端需要）
npx hardhat run scripts/testUserInfo.js --network localhost

# 管理员修改, 推荐人是否需要质押的配置
npx hardhat run scripts/testReferrerStakeRequirement.js --network localhost


```



### 相关文档

- [前端链上数据获取指南](notes/前端链上数据获取指南.md)

### AI 指令示例

前端在获取链上信息时需要 AI 辅助，提示词可以这样写：

```
参考合约：

币合约：
  - contracts/SYI/mainnet/SYI.sol
  - contracts/SYI/abstract/SYIBase.sol

质押合约：
  - contracts/SYI-Staking/mainnet/Staking.sol
  - contracts/SYI-Staking/abstract/StakingBase.sol

注意：Fork 的节点我已手动打开：
npx hardhat node --fork https://binance.llamarpc.com --fork-block-number 63482920

打开后可以调用主网一样的合约，你就不要再去启动了。

请新写个测试代码：scripts/testXXXX.js

我的需求是：
通过链上去读取，质押合约的用户详细信息（这里写你的要求）
```



