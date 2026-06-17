# PancakeSwap 添加流动性操作指南

## 背景

AE 合约部署完成后，deployer 钱包持有 60,000,000 AE 代币，需要在 PancakeSwap 上手动添加初始流动性，建立 AE/USDC 交易对。添加流动性后再调用 `setPresaleActive(false)` 开放交易。

## 关键信息汇总

| 项目 | 值 |
|------|-----|
| AE Token 地址 | `0x01edd7445DF0e9c2064c77Df150BE9FC793C828b` |
| USDC 地址 | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` |
| AE/USDC Pair 地址 | `0x526bb930F25C8976290c01CEF775249373343132` |
| PancakeSwap Router V2 | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| Deployer 钱包 | `0xB138e42B76ad0E6F21E715578F34F2Cf2285eE76` |
| 计划注入的 AE 数量 | 60,000,000 AE |
| 计划注入的 USDC 数量 | 60,000 USDC |
| 初始价格 | 1 AE = 0.001 USDC（1 USDC = 1,000 AE）|

## 池子类型选择

### 必须选择: PancakeSwap V2 流动性池

**不要选 V3，必须选 V2。** 原因如下：

1. **合约代码绑定了 V2 Router**：AE 合约中硬编码使用的是 PancakeSwap V2 Router (`0x10ED43C718714eb63d5aA57B78B54704E256024E`)，所有自动化操作（卖出税费兑换、LP 添加/销毁）都通过 V2 Router 执行。

2. **Pair 地址已通过 V2 Factory 创建**：部署脚本已经通过 V2 Factory (`0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73`) 创建了 AE/USDC Pair (`0x526bb930F25C8976290c01CEF775249373343132`)，并通过 `ae.setPair()` 注册到合约中。合约的税费逻辑依赖这个 Pair 地址来判断买入/卖出行为。

3. **V3 不兼容**：V3 使用集中流动性和不同的合约接口，AE 合约的 `swapExactTokensForTokensSupportingFeeOnTransferTokens` 调用只在 V2 Router 上可用。V3 不支持带税代币的 `supportingFeeOnTransfer` 系列函数。

### 交易对: AE / USDC

- 不是 AE/BNB，不是 AE/BUSD
- 必须是 AE 和 BSC 上的 USDC (`0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`)
- 这个 USDC 在合约代码中被称为 `USDX`

## 操作步骤（网页版 PancakeSwap）

### 前提条件

- Deployer 钱包已导入 MetaMask（或其他 Web3 钱包）
- 钱包网络切换到 BSC 主网（Chain ID: 56）
- 钱包中有足够的 BNB 用于支付 Gas（建议至少 0.1 BNB）
- 钱包中有 60,000 USDC（BSC 上的）
- 钱包中有 60,000,000 AE（部署后已在钱包中）

### 第一步：打开 PancakeSwap V2 添加流动性页面

打开浏览器访问：

```
https://pancakeswap.finance/v2/add/0x01edd7445DF0e9c2064c77Df150BE9FC793C828b/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
```

这个 URL 会直接打开 V2 版本的添加流动性页面，并自动填入 AE 和 USDC 的地址。

> **注意**：如果 URL 方式无法自动识别代币，手动操作如下：
> 1. 访问 https://pancakeswap.finance/liquidity
> 2. 点击页面顶部确认切换到 **V2** 标签（不要用 V3）
> 3. 点击 "Add Liquidity"
> 4. 第一个代币：粘贴 AE 地址 `0x01edd7445DF0e9c2064c77Df150BE9FC793C828b`
> 5. 第二个代币：粘贴 USDC 地址 `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`

### 第二步：输入数量

- AE 数量输入：`60000000`（6000 万）
- USDC 数量输入：`60000`（6 万）

因为这是首次添加流动性（池子是空的），你可以自由设定两个代币的比例，这将决定初始价格：

```
初始价格 = USDC 数量 / AE 数量 = 60,000 / 60,000,000 = 0.001 USDC/AE
```

### 第三步：Approve 代币

PancakeSwap 会要求你先 Approve（授权）代币给 Router 合约：

1. **Approve AE**：点击 "Approve AE" 按钮，钱包弹出确认，确认交易
2. **等待 AE Approve 交易上链确认**
3. **Approve USDC**：点击 "Approve USDC" 按钮，钱包弹出确认，确认交易
4. **等待 USDC Approve 交易上链确认**

> 如果之前从未操作过，两个代币都需要 Approve。如果页面只显示一个 Approve 按钮，说明另一个已经授权过了。

### 第四步：确认添加流动性

1. 两个代币都 Approve 完成后，"Supply" 按钮会变为可点击状态
2. 点击 "Supply"
3. 弹出确认弹窗，核实：
   - AE 数量：60,000,000
   - USDC 数量：60,000
   - 价格比例：1 AE = 0.001 USDC
4. 确认后，钱包弹出交易确认，点击确认
5. 等待交易上链

### 第五步：验证流动性添加成功

交易确认后，验证以下几点：

1. **在 PancakeSwap 上查看**：回到 Liquidity 页面，应该能看到你的 AE/USDC LP 仓位
2. **在 BSCScan 上查看 Pair 合约**：
   - 打开 `https://bscscan.com/address/0x526bb930F25C8976290c01CEF775249373343132`
   - 查看 Token Holdings，应该有 AE 和 USDC 的余额
3. **检查 LP Token 余额**：你的钱包中应该收到 LP Token

## LP Token 处理

根据项目配置 `"burnLP": true`，初始流动性的 LP Token 应该销毁，锁死流动性。

### 销毁 LP Token 的方法

将 LP Token 转到死地址（黑洞地址）：

```
死地址: 0x000000000000000000000000000000000000dEaD
```

操作方式：
1. 在 MetaMask 中添加 LP Token（地址就是 Pair 地址：`0x526bb930F25C8976290c01CEF775249373343132`）
2. 发起转账，收款地址填死地址 `0x000000000000000000000000000000000000dEaD`
3. 数量选 "全部" / "MAX"
4. 确认交易

> 销毁 LP Token 后，这笔流动性将永远无法撤出，这是向社区表明项目方不会 Rug Pull 的信号。

## 开放交易

流动性添加完成且 LP 销毁后，调用合约函数开放交易：

### 方法一：通过 BSCScan 操作

1. 打开 AE 合约的 BSCScan 页面：
   `https://bscscan.com/address/0x01edd7445DF0e9c2064c77Df150BE9FC793C828b#writeContract`
2. 点击 "Connect to Web3"，连接 Deployer 钱包
3. 找到 `setPresaleActive` 函数
4. 输入参数：`false`
5. 点击 "Write"，确认交易

### 方法二：通过 Hardhat 脚本

```javascript
const ae = await ethers.getContractAt("AE", "0x01edd7445DF0e9c2064c77Df150BE9FC793C828b");
const tx = await ae.setPresaleActive(false);
await tx.wait();
console.log("交易已开放");
```

执行：
```bash
npx hardhat run scripts/openTrading.js --network bsc
```

## 开放交易后的验证

1. **尝试小额买入**：用另一个钱包在 PancakeSwap 上用少量 USDC 购买 AE，确认交易能成功
2. **检查税费**：买入应该扣除 3% 税（2% 节点奖励 + 1% 社区奖励），实际到账约 97%
3. **尝试小额卖出**：等待 10 秒冷却期后，卖出少量 AE 换回 USDC，确认税费正常收取

## 完整操作流程总结

```
1. 打开 PancakeSwap V2 添加流动性页面
2. 选择 AE + USDC 交易对
3. 输入数量：60,000,000 AE + 60,000 USDC
4. Approve AE → Approve USDC
5. 点击 Supply，确认交易
6. 验证流动性添加成功
7. 将 LP Token 转到 0x...dEaD 销毁
8. 调用 ae.setPresaleActive(false) 开放交易
9. 用小额交易验证买入/卖出正常
```

## 注意事项

- **操作顺序不能反**：必须先添加流动性，再开放交易。如果先开放交易，池子里没有流动性，用户无法交易。
- **Gas 费用**：添加流动性的 Gas 消耗较大（约 200,000-300,000 gas），确保钱包有足够的 BNB。
- **滑点设置**：首次添加流动性时不需要考虑滑点（因为池子是空的）。但后续用户交易时，因为有 3% 税，需要设置至少 4-5% 的滑点。
- **Presale 期间**：在 `presaleActive = true` 期间，买入会被合约拒绝（`NotAllowedBuy` 错误），但添加流动性不受影响，因为添加流动性走的是 Router 的 `addLiquidity` 函数，不经过 AE 的 `_transfer` 税费逻辑判断买入行为。
- **USDC 精度**：BSC 上的 USDC 是 18 位精度（不是以太坊上的 6 位），输入 60000 即可，PancakeSwap 前端会自动处理精度。
