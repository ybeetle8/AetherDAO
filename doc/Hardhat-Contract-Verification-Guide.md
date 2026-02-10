# Hardhat 部署自动开源（代码验证）指南

在区块链浏览器（如 BscScan）上"开源"合约，实际上就是**验证合约代码 (Verify Contract)**。验证成功后，用户可以直接在浏览器上阅读源码并与合约交互。

由于本项目已经安装了 `@nomicfoundation/hardhat-toolbox`，它内置了 `hardhat-verify` 插件，我们只需要进行简单的配置即可。

## 1. 准备工作：获取 API Key

要验证 BSC 上的合约，你需要 BscScan 的 API Key。

1.  访问 [BscScan 官网](https://bscscan.com/) 并注册/登录。
2.  进入个人中心，找到 **API-KEYs** 菜单。
3.  创建一个新的 Key，复制该字符串。

## 2. 配置 Hardhat

### 2.1 更新 `.env`

在项目根目录的 `.env` 文件中添加 API Key：

```properties
# 其他配置...
BSC_RPC_URL=...
BSC_PRIVATE_KEY=...

# 新增
BSCSCAN_API_KEY=你的_BscScan_API_Key
```

### 2.2 修改 `hardhat.config.js`

在 `hardhat.config.js` 中添加 `etherscan` 配置块。虽然名字叫 `etherscan`，但它通用配置各种区块浏览器。

```javascript
// ... existing imports

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // ... existing solidity and networks config

  // 新增 etherscan 配置
  etherscan: {
    apiKey: {
      // 对应 networks 中的网络名称
      bsc: process.env.BSCSCAN_API_KEY,
      bscTestnet: process.env.BSCSCAN_API_KEY,
    }
  }
};
```

## 3. 执行验证（开源）的两种方式

### 方式一：部署脚本中自动验证（推荐）

你可以在部署脚本（`scripts/deployXXX.js`）的末尾添加代码，在部署完成后自动调用验证任务。

**注意**：部署后通常需要等待几秒钟（等待区块确认和浏览器索引），否则验证可能会因为"找不到合约"而失败。

```javascript
const hre = require("hardhat");

async function main() {
  // 1. 部署合约
  const MyContract = await hre.ethers.getContractFactory("MyContract");
  // 假设构造函数参数是 "Argument1", 123
  const myContract = await MyContract.deploy("Argument1", 123); 
  await myContract.waitForDeployment();
  const address = await myContract.getAddress();

  console.log("Contract deployed to:", address);

  // 2. 等待几个区块，确保浏览器已索引合约
  console.log("Waiting for block confirmations...");
  // 仅在真实网络等待
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
      // 等待 6 个区块
      await myContract.deploymentTransaction().wait(6); 
      
      // 3. 开始验证
      console.log("Verifying contract...");
      try {
        await hre.run("verify:verify", {
          address: address,
          constructorArguments: [
            "Argument1", // 必须与部署时的参数完全一致
            123
          ],
        });
      } catch (error) {
        if (error.message.toLowerCase().includes("already verified")) {
          console.log("Contract is already verified!");
        } else {
          console.error("Verification failed:", error);
        }
      }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### 方式二：部署后手动命令行验证

如果你不想修改部署脚本，或者自动验证失败了，可以使用命令行手动验证。

**基本语法**：
```bash
npx hardhat verify --network <网络名称> <合约地址> <构造函数参数1> <构造函数参数2> ...
```

**示例**：
假设合约地址是 `0x123...abc`，部署时构造函数参数是 `"Hello"` 和 `100`。

```bash
npx hardhat verify --network bsc 0x123...abc "Hello" 100
```

如果构造函数参数很复杂（例如数组或结构体），建议创建一个 `arguments.js` 文件：

```javascript
// arguments.js
module.exports = [
  "Argument1",
  [1, 2, 3], // 数组参数
  { x: 1, y: 2 } // 结构体参数
];
```

然后使用 `--constructor-args` 参数：

```bash
npx hardhat verify --network bsc 0x123...abc --constructor-args arguments.js
```

## 4. 常见问题排查

1.  **"Already Verified"**: 
    *   说明代码完全一样，之前已经有人部署过相同的字节码，或者你重复运行了命令。这是好事，不用处理。

2.  **"Etherscan: Failed to send contract verification request"**:
    *   检查 API Key 是否正确。
    *   检查网络连接（有时需要梯子才能访问 BscScan API）。

3.  **"Bytecode does not match"**:
    *   **最常见原因**：构造函数参数 (`constructorArguments`) 不正确。必须与部署时完全一致。
    *   **原因二**：编译设置不一致。确保本地的 `optimizer` (优化器) 设置与部署时一致。
    *   **原因三**：Flattened 代码问题。如果合约使用了 `import` 路径重映射（remapping），有时插件处理不好，可能需要先 flatten 代码。但通常 `hardhat-toolbox` 能处理好。

4.  **代理合约 (Proxy)**:
    *   如果你使用的是代理模式（OpenZeppelin Upgrades），你需要验证的是**实现合约 (Implementation)** 的地址，而不是代理合约 (Proxy) 的地址。
    *   代理合约本身通常已经被 Etherscan 收录，不需要验证。
    *   在 BscScan 上找到你的 Proxy 合约页，点击 "Code" -> "More Options" -> "Is this a proxy?" 来关联实现合约。
