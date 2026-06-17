# importReferralData 主网执行报错原因分析

## 报错信息

```
npx hardhat run scripts/importReferralData.js --network bsc

✗ 导入失败: could not decode result data (value="0x", info={ "method": "getRootAddress", "signature": "getRootAddress()" }, code=BAD_DATA, version=6.16.0)
```

## 根本原因

**脚本读取了错误的部署配置文件，导致使用了 localhost 的合约地址去访问 BSC 主网。**

### 详细分析

1. 脚本第 22 行引用的配置文件：
   ```javascript
   const deployment = require("../ae-deployment.json");
   ```

2. `ae-deployment.json` 的内容是 **localhost 本地测试网络** 的部署记录：
   ```json
   {
     "network": "localhost",
     "contracts": {
       "Staking": "0x68De0189977D1B447C5ad6337bEE80C9C700dA73"
     }
   }
   ```

3. 而 BSC 主网的部署记录在 **`ae-mainnet-deployment.json`** 中：
   ```json
   {
     "network": "bsc",
     "contracts": {
       "Staking": "0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3"
     }
   }
   ```

4. 链上验证结果：
   - `0x68De...0dA73`（localhost 地址）在 BSC 主网上 **不存在合约代码**（`getCode` 返回 `0x`）
   - `0xf812...9B3`（主网地址）在 BSC 主网上 **存在合约代码**（代码长度 46840 字节）

### 报错链路

```
脚本启动 (--network bsc)
  → 读取 ae-deployment.json（localhost 部署记录）
    → 获取 Staking 地址 = 0x68De...0dA73（localhost 地址）
      → 调用 staking.getRootAddress()
        → 该地址在 BSC 主网上无合约代码
          → 返回 0x（空数据）
            → ethers 无法解码空数据
              → 抛出 BAD_DATA 错误
```

## 解决方案

脚本需要根据当前网络（`--network` 参数）选择正确的部署配置文件：

- `--network localhost` → 读取 `ae-deployment.json`
- `--network bsc` → 读取 `ae-mainnet-deployment.json`

### 修改思路

在脚本中根据 `hre.network.name` 动态选择配置文件，例如：

```javascript
const deploymentFile = hre.network.name === 'bsc'
  ? "../ae-mainnet-deployment.json"
  : "../ae-deployment.json";
const deployment = require(deploymentFile);
```

## 涉及文件

| 文件 | 说明 |
|------|------|
| `scripts/importReferralData.js:22` | 硬编码引用了 `ae-deployment.json` |
| `ae-deployment.json` | localhost 本地部署记录（Staking: `0x68De...`) |
| `ae-mainnet-deployment.json` | BSC 主网部署记录（Staking: `0xf812...`) |

## 日期

2026-05-04
