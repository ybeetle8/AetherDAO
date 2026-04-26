# BSCScan 合约验证问题及解决方案

## 问题现象

使用 `hardhat-verify` 进行 BSCScan 合约验证时，出现以下错误：

```
[WARNING] Network and explorer-specific api keys are deprecated in favour of the new Etherscan v2 api.
A network request failed. This is an error from the block explorer, not Hardhat.
Error: Connect Timeout Error / read ECONNRESET
```

## 根本原因

**Etherscan 已于 2025 年 8 月 15 日废弃 V1 API**，统一迁移到 V2 API。

- 旧的 V1 端点（如 `https://api.bscscan.com/api`、`https://api-testnet.bscscan.com/api`）已关闭
- V2 统一端点为 `https://api.etherscan.io/v2/api`，通过 `chainid` 参数区分链
- 一个 API Key 可用于所有 Etherscan 系列浏览器（BSCScan、Etherscan、Polygonscan 等）

参考：
- [Etherscan V2 Migration 官方文档](https://docs.etherscan.io/v2-migration)
- [Hardhat Issue #7623](https://github.com/NomicFoundation/hardhat/issues/7623)

## 当前项目的情况

- 使用 `@nomicfoundation/hardhat-toolbox@4.0.0`，依赖 `hardhat-verify@2.x`
- `hardhat-verify` 2.x 内置了 BSC/BSC Testnet 的旧 V1 API URL
- `customChains` 配置**无法覆盖内置链**的 URL（这是 2.x 的已知限制）
- 即使配了 `customChains` 指向 V2，插件仍然使用内置的 V1 地址

## 解决方案

### 方案一：升级到 Hardhat 3 + hardhat-verify 3.x（推荐，但改动大）

`hardhat-verify@3.0.15` 已修复此问题（PR #7649），默认使用 V2 API。

**问题**：`hardhat-toolbox@4.0.0` 的 peerDependency 要求 `hardhat-verify@^2.0.0`，直接升级会破坏依赖。需要同时升级 hardhat 到 v3 + hardhat-toolbox 到 v7。

**改动范围**：
- 升级 hardhat 到 v3（配置文件格式可能有变化）
- 升级 hardhat-toolbox 到 v7
- hardhat-verify 自动升级到 3.x
- 需要全面测试编译和部署流程

### 方案二：Patch hardhat-verify 2.x 的源码（简单快速）

手动修改 `node_modules/@nomicfoundation/hardhat-verify/src/internal/etherscan.ts` 中的内置链 URL。

具体做法：使用 `patch-package` 工具固化补丁。

```bash
# 1. 安装 patch-package
npm install patch-package --save-dev

# 2. 手动修改 node_modules 中的文件
#    找到 hardhat-verify 的链配置，把 BSC 的 apiURL 改成 V2

# 3. 生成补丁
npx patch-package @nomicfoundation/hardhat-verify

# 4. 在 package.json 的 scripts 中添加
#    "postinstall": "patch-package"
```

**优点**：改动最小，不影响其它依赖
**缺点**：需要维护补丁文件，`npm install` 后自动应用

### 方案三：绕过 hardhat-verify，直接调 Etherscan V2 API（最可靠）

不依赖 hardhat-verify 插件，在脚本中直接用 HTTP 请求调用 Etherscan V2 的合约验证 API。

**API 调用方式**：

```
POST https://api.etherscan.io/v2/api?chainid=97
Content-Type: application/x-www-form-urlencoded

module=contract
&action=verifysourcecode
&apikey=YOUR_API_KEY
&contractaddress=0x...
&sourceCode={Standard JSON Input}
&codeformat=solidity-standard-json-input
&contractname=contracts/AE/src/mainnet/AE.sol:AE
&compilerversion=v0.8.28+commit.7893614a
&optimizationUsed=1
&runs=200
&evmversion=cancun
&constructorArguements=ABI编码的构造参数
```

**实现步骤**：
1. 用 `npx hardhat compile` 生成 Standard JSON Input（`artifacts/build-info/*.json`）
2. 从 build-info 中提取 solcInput
3. ABI 编码构造函数参数
4. 用 `fetch` 或 `axios` 调用 V2 API
5. 轮询查询验证结果

**优点**：完全不依赖 hardhat-verify，最可靠
**缺点**：需要写较多代码，处理 Standard JSON Input 和 ABI 编码

### 方案四：使用代理解决网络问题（如果 V1 还能访问）

如果 V1 端点只是被你的网络环境屏蔽（而非真正关闭），可以配置代理：

```javascript
// hardhat.config.js 顶部添加
const { ProxyAgent, setGlobalDispatcher } = require("undici");
const proxyAgent = new ProxyAgent("http://127.0.0.1:7890");
setGlobalDispatcher(proxyAgent);
```

**注意**：V1 API 已于 2025.8 正式关闭，此方案大概率无效。

## 建议

**当前阶段（测试网验证）**：采用**方案三**，写一个独立的验证脚本 `scripts/verifyContracts.js`，直接调 Etherscan V2 API。这是最可靠的方案，且不需要改动任何现有依赖。

**后续主网**：同样使用方案三的验证脚本。或者等 Hardhat 3 稳定后统一升级（方案一）。

## 相关文件

| 文件 | 说明 |
|------|------|
| `hardhat.config.js` | etherscan 配置段 |
| `scripts/deployAETest.js` | 测试网部署（含验证逻辑） |
| `scripts/deployAEMain.js` | 主网部署（含验证逻辑） |
| `ae-testnet-deployment.json` | 测试网已部署的合约地址 |
