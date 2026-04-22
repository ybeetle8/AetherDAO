# 稳定币命名统一修改方案：USDT → USDX

## 背景

当前代码中所有稳定币相关的变量、函数、事件、注释都使用 `USDT` 命名，但实际部署时配置的地址是 BSC 上的 USDC（`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`）。部分脚本中已经出现了混乱的注释：

```js
// USDC 地址 (配置文件中的 usdt 实际是 USDC)
const USDC_ADDRESS = deploymentConfig.addresses.usdt;
```

为了明确表示系统支持任意稳定币（USDT、USDC、BUSD 等），建议将所有 `USDT` 命名统一改为 `USDX`。

## 现状分析

### 架构层面（好消息）

稳定币地址在合约中**没有硬编码**，而是通过构造函数参数传入并存储为 `immutable`：

```solidity
// AEBase.sol
address public immutable USDT;  // 构造函数传入，部署后不可变

// StakingBase.sol
address internal immutable USDT;  // 同上

// FundRelay.sol
address public immutable USDT;  // 同上
```

这意味着合约本身已经支持任意稳定币，只是**命名上绑定了 USDT**。

### 需要修改的范围

| 类别 | 文件 | 修改内容 |
|------|------|----------|
| **合约状态变量** | AEBase.sol | `address public immutable USDT` → `USDX` |
| | StakingBase.sol | `address internal immutable USDT` → `USDX` |
| | FundRelay.sol | `address public immutable USDT` → `USDX` |
| **构造函数参数** | AEBase.sol, StakingBase.sol, FundRelay.sol, AE.sol, Staking.sol | `_usdt` → `_usdx` |
| **接口函数名** | IStaking.sol (两份) | `getUSDTAddress()` → `getUSDXAddress()` |
| | IStaking.sol (两份) | `emergencyWithdrawUSDT()` → `emergencyWithdrawUSDX()` |
| | IAE.sol | `getUSDTAddress()` → `getUSDXAddress()` |
| | IAE.sol | `getUSDTReserve()` → `getUSDXReserve()` |
| **事件名** | FundRelay.sol | `USDTReceived` → `USDXReceived` |
| | FundRelay.sol | `USDTForwarded` → `USDXForwarded` |
| | AEBase.sol | `LiquidityAdded` 参数 `usdtAmount` → `usdxAmount` |
| | IAE.sol | `LpFeeProcessed` 参数 `usdtReceived` → `usdxReceived` |
| | ILiquidityStaking.sol | `BLASwappedToRewards` 参数 `usdtAmount` → `usdxAmount` |
| **结构体字段** | IStaking.sol (两份) | `RedemptionResult.usdtReceived` → `usdxReceived` |
| | IStaking.sol (两份) | 事件参数 `usdtReceived` → `usdxReceived` |
| **合约内部引用** | AEBase.sol | 所有 `USDT` 变量引用（约 20+ 处） |
| | StakingBase.sol | 所有 `USDT` 变量引用（约 30+ 处） |
| | FundRelay.sol | 所有 `USDT` 变量引用（约 5 处） |
| **NatSpec 注释** | IStaking.sol (两份) | 所有 `USDT` 文字描述 → `USDX` |
| | IAE.sol | 所有 `USDT` 文字描述 → `USDX` |
| | ILiquidityStaking.sol | 注释中的 `USDT` → `USDX` |
| **配置文件** | ae-deployment-config.json | `"usdt"` 键名 → `"usdx"` |
| **部署脚本** | scripts/deployAE.js | `USDC_ADDRESS` → `USDX_ADDRESS`，config 读取键名 |
| **测试脚本** | scripts/testReferralBinding.js | `USDC_ADDRESS` → `USDX_ADDRESS`，删除混乱注释 |
| | scripts/testLevelDetermination.js | 同上 |
| | scripts/testTokenTrading.js | 同上 |

## 详细修改清单

### 1. 合约文件（Solidity）

#### AEBase.sol (`contracts/AE/src/abstract/AEBase.sol`)

- 第 214 行：`address public immutable USDT` → `address public immutable USDX`
- 第 290 行：构造函数参数 `address _usdt` → `address _usdx`
- 第 310 行：`USDT = _usdt` → `USDX = _usdx`
- 第 75 行：事件参数 `usdtAmount` → `usdxAmount`
- 所有内部引用 `USDT` 的地方（约 20+ 处）全部替换为 `USDX`
- 所有 `_usdt` 局部变量替换为 `_usdx`
- require 消息中的 "USDT" 文字替换为 "USDX"

#### StakingBase.sol (`contracts/AE-Staking/src/abstract/StakingBase.sol`)

- 第 108 行：`address internal immutable USDT` → `address internal immutable USDX`
- 第 205 行：构造函数参数 `address _usdt` → `address _usdx`
- 第 211 行：require 消息 `"Invalid USDT address"` → `"Invalid USDX address"`
- 第 215 行：`USDT = _usdt` → `USDX = _usdx`
- 所有内部引用 `USDT` 的地方（约 30+ 处）全部替换为 `USDX`

#### FundRelay.sol (`contracts/AE/src/utils/FundRelay.sol`)

- 第 22 行：`address public immutable USDT` → `address public immutable USDX`
- 第 32 行：`event USDTReceived` → `event USDXReceived`
- 第 35 行：`event USDTForwarded` → `event USDXForwarded`
- 第 84 行：构造函数参数 `address _usdt` → `address _usdx`
- 第 88 行：require 消息 `"Invalid USDT"` → `"Invalid USDX"`
- 第 90 行：`USDT = _usdt` → `USDX = _usdx`
- 所有内部引用替换

#### AE.sol (`contracts/AE/src/mainnet/AE.sol`)

- 第 16 行：构造函数参数 `address _usdt` → `address _usdx`

#### Staking.sol (`contracts/AE-Staking/src/mainnet/Staking.sol`)

- 第 16 行：构造函数参数 `address _usdt` → `address _usdx`

### 2. 接口文件

#### IStaking.sol（两份：`contracts/AE/src/interfaces/` 和 `contracts/AE-Staking/src/interfaces/`）

- 结构体字段 `usdtReceived` → `usdxReceived`
- 函数 `emergencyWithdrawUSDT()` → `emergencyWithdrawUSDX()`
- 所有 NatSpec 注释中的 "USDT" → "USDX"

#### IAE.sol (`contracts/AE-Staking/src/interfaces/IAE.sol`)

- 函数 `getUSDTAddress()` → `getUSDXAddress()`
- 函数 `getUSDTReserve()` → `getUSDXReserve()`
- 事件参数 `usdtReceived` → `usdxReceived`
- 事件参数 `usdtAmount` → `usdxAmount`
- 所有 NatSpec 注释中的 "USDT" → "USDX"

#### ILiquidityStaking.sol (`contracts/AE/src/interfaces/ILiquidityStaking.sol`)

- 事件参数 `usdtAmount` → `usdxAmount`
- 注释中的 "USDT" → "USDX"

### 3. 配置文件

#### ae-deployment-config.json

```json
// 修改前
"usdt": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
"usdt": "60000"

// 修改后
"usdx": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
"usdx": "60000"
```

### 4. 脚本文件

#### scripts/deployAE.js

```js
// 修改前
const USDC_ADDRESS = config.addresses.usdt;
const INITIAL_LIQUIDITY_USDC = hre.ethers.parseEther(config.tokenomics.initialLiquidity.usdt);

// 修改后
const USDX_ADDRESS = config.addresses.usdx;
const INITIAL_LIQUIDITY_USDX = hre.ethers.parseEther(config.tokenomics.initialLiquidity.usdx);
```

#### scripts/testReferralBinding.js, testLevelDetermination.js, testTokenTrading.js

```js
// 修改前
// USDC 地址 (配置文件中的 usdt 实际是 USDC)
const USDC_ADDRESS = deploymentConfig.addresses.usdt;

// 修改后
const USDX_ADDRESS = deploymentConfig.addresses.usdx;
```

## 注意事项

1. **不影响合约逻辑**：所有修改仅涉及命名，不改变任何业务逻辑
2. **ABI 变化**：公开函数名和事件名的修改会导致 ABI 变化，如果有前端或其他系统依赖当前 ABI，需要同步更新
3. **两份 IStaking.sol**：`contracts/AE/src/interfaces/` 和 `contracts/AE-Staking/src/interfaces/` 各有一份，需要同步修改
4. **othercode 目录不动**：`othercode/` 下的旧代码不在本次修改范围内
5. **编译验证**：修改完成后需要 `npx hardhat compile` 确认无编译错误
6. **产品文档同步**：`notes/AetherDAO产品文档.md` 中的 USDT 描述也应改为 USDX
