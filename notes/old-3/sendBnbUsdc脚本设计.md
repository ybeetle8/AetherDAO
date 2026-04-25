# sendBnbUsdc.js 脚本设计文档

## 目标

在本地 fork BSC 测试网络上，向指定钱包地址发送 BNB 和 USDC（USDX），方便开发和前端调试。

## 运行方式

```bash
npx hardhat run scripts/sendBnbUsdc.js --network localhost
```

## 功能需求

| 功能 | 说明 |
|------|------|
| 发送 BNB | 向目标地址设置 100 BNB 余额 |
| 发送 USDC | 向目标地址设置 10,000 USDC 余额 |
| 余额验证 | 发送后查询并打印目标地址的 BNB 和 USDC 余额 |

## 配置项

脚本顶部定义常量，用户修改后即可使用：

```javascript
// ============ 配置区域 ============
const TARGET_ADDRESS = "0x你的钱包地址";  // 修改为你的钱包地址
const BNB_AMOUNT = "100";                // 发送 BNB 数量
const USDC_AMOUNT = "10000";             // 发送 USDC 数量
// ==================================
```

## 技术方案

### BNB 发送

使用 Hardhat 的 `hardhat_setBalance` RPC 方法直接设置目标地址的 BNB 余额：

```javascript
await hre.network.provider.send("hardhat_setBalance", [
    targetAddress,
    ethers.toBeHex(ethers.parseEther(bnbAmount))
]);
```

**说明：** 这是 Hardhat 提供的测试网专用方法，直接修改账户的 ETH/BNB 余额，不需要从其他账户转账。

### USDC 发送

USDC 是 ERC20 代币，余额存储在合约的 `mapping(address => uint256)` 中。需要通过 `hardhat_setStorageAt` 直接修改存储槽位来设置余额。

**BSC 主网 USDC 地址：** `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`

**存储槽位计算方法：**

ERC20 的 `balanceOf` 映射存储槽位 = `keccak256(abi.encode(address, slot))`

其中 `slot` 是 `balanceOf` 映射在合约中的存储位置。BSC USDC 的余额映射槽位不确定（常见为 0, 1, 2, 9, 51），脚本会自动尝试多个槽位直到成功。

```javascript
const slotsToTry = [9, 0, 1, 2, 51];

for (const slot of slotsToTry) {
    const balanceSlot = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256"],
            [targetAddress, slot]
        )
    );
    await hre.network.provider.send("hardhat_setStorageAt", [
        USDC_ADDRESS, balanceSlot, amountHex
    ]);
    // 验证是否成功...
}
```

### 安全约束

- 脚本仅在 `localhost` 或 `hardhat` 网络下运行
- 开头检测网络类型，非本地网络直接退出并报错
- 防止误操作在主网执行

## 输出格式

参考项目现有脚本风格，使用清晰的分段输出：

```
========================================
  发送 BNB 和 USDC 到指定钱包
========================================

目标地址: 0x...
网络: localhost

--- 发送 BNB ---
✓ 已发送 100 BNB
  当前 BNB 余额: 100.0 BNB

--- 发送 USDC ---
✓ 找到正确的存储槽位: 9
✓ 已发送 10000 USDC
  当前 USDC 余额: 10000.0 USDC

========================================
  完成！
========================================
```

## 依赖

- `hardhat` (hre.ethers, hre.network.provider)
- 无需额外 npm 包
- 无需读取部署配置文件（USDC 地址硬编码，与 `ae-deployment-config.json` 中一致）

## 文件结构

```
scripts/
  └── sendBnbUsdc.js    # 本脚本
```
