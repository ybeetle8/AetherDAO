# OLA 生态系统 BSC 测试网部署教程

## 📋 部署概述

本教程将指导您将完整的OLA生态系统部署到BSC测试网，包括所有必要的配置和验证步骤。

## 🛠️ 环境准备

### 1. 安装依赖

```bash
# 确保已安装Node.js 16+
node --version

# 安装依赖包
npm install
npm install @openzeppelin/contracts
npm install @prb/math
```

### 2. 获取BSC测试网资源

#### 2.1 获取测试BNB
- 访问 [BSC测试网水龙头](https://testnet.bnbchain.org/faucet-smart)
- 连接MetaMask钱包
- 申请测试BNB (每24小时可申请0.1 BNB)

#### 2.2 配置MetaMask
添加BSC测试网络：
```
网络名称: BSC Testnet
RPC URL: https://data-seed-prebsc-1-s1.binance.org:8545/
链ID: 97
符号: BNB
区块浏览器: https://testnet.bscscan.com/
```

### 3. 配置私钥

创建 `.env` 文件：
```env
# BSC测试网私钥 (不要提交到Git)
TESTNET_PRIVATE_KEY=your_private_key_here

# BSCScan API Key (用于验证合约)
BSCSCAN_API_KEY=your_bscscan_api_key

# 可选：Infura/Alchemy项目ID
INFURA_PROJECT_ID=your_infura_project_id
```

## ⚙️ Hardhat 配置

更新 `hardhat.config.js`:

```javascript
require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    // 本地开发网络
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    // BSC测试网
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      chainId: 97,
      accounts: process.env.TESTNET_PRIVATE_KEY ? [process.env.TESTNET_PRIVATE_KEY] : [],
      gasPrice: 20000000000, // 20 gwei
      gas: 2100000,
    },
    // BSC主网 (生产环境)
    bscMainnet: {
      url: "https://bsc-dataseed1.binance.org/",
      chainId: 56,
      accounts: process.env.MAINNET_PRIVATE_KEY ? [process.env.MAINNET_PRIVATE_KEY] : [],
      gasPrice: 5000000000, // 5 gwei
    }
  },
  etherscan: {
    apiKey: {
      bscTestnet: process.env.BSCSCAN_API_KEY,
      bsc: process.env.BSCSCAN_API_KEY
    }
  }
};
```

## 🚀 测试网部署脚本

创建 `scripts/deployToTestnet.js`:

```javascript
const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    
    console.log("🚀 开始部署 OLA 生态系统到 BSC 测试网");
    console.log("部署地址:", deployer.address);
    console.log("账户余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");
    
    // 检查余额
    const balance = await ethers.provider.getBalance(deployer.address);
    if (balance < ethers.parseEther("0.1")) {
        throw new Error("❌ 余额不足！请先获取测试BNB: https://testnet.bnbchain.org/faucet-smart");
    }

    // 1. 部署 USDT 测试代币
    console.log("\\n=== 步骤 1: 部署 USDT 测试代币 ===");
    const USDT = await ethers.getContractFactory("USDT");
    const usdt = await USDT.deploy();
    await usdt.waitForDeployment();
    console.log("✅ USDT 部署完成:", await usdt.getAddress());
    
    // 2. 使用官方PancakeSwap测试网合约
    console.log("\\n=== 步骤 2: 使用 PancakeSwap 测试网合约 ===");
    
    const PANCAKE_TESTNET_ADDRESSES = {
        factory: "0x6725F303b657a9124d3a91E9CF7f2F442c8b5f39",      // PancakeSwap Factory
        router: "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3",       // PancakeSwap Router  
        wbnb: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"          // WBNB
    };
    
    console.log("✅ 使用 PancakeSwap Factory:", PANCAKE_TESTNET_ADDRESSES.factory);
    console.log("✅ 使用 PancakeSwap Router:", PANCAKE_TESTNET_ADDRESSES.router);
    console.log("✅ 使用 WBNB:", PANCAKE_TESTNET_ADDRESSES.wbnb);
    
    // 3. 部署 FundRelay
    console.log("\\n=== 步骤 3: 部署 FundRelay ===");
    const FundRelay = await ethers.getContractFactory("FundRelay");
    const fundRelay = await FundRelay.deploy(await usdt.getAddress(), ethers.ZeroAddress);
    await fundRelay.waitForDeployment();
    console.log("✅ FundRelay 部署完成:", await fundRelay.getAddress());
    
    // 4. 部署 Staking 合约
    console.log("\\n=== 步骤 4: 部署 Staking 合约 ===");
    const Staking = await ethers.getContractFactory("Staking");
    const staking = await Staking.deploy(
        await usdt.getAddress(),              // USDT地址
        PANCAKE_TESTNET_ADDRESSES.router,     // PancakeSwap Router
        deployer.address,                     // rootAddress
        deployer.address                      // feeRecipient
    );
    await staking.waitForDeployment();
    console.log("✅ Staking 合约部署完成:", await staking.getAddress());
    
    // 5. 部署 OLA 代币合约
    console.log("\\n=== 步骤 5: 部署 OLA 代币合约 ===");
    const OLA = await ethers.getContractFactory("OLA");
    const ola = await OLA.deploy(
        await usdt.getAddress(),              // USDT地址
        PANCAKE_TESTNET_ADDRESSES.router,     // PancakeSwap Router
        await staking.getAddress(),           // Staking地址
        deployer.address                      // marketingAddress
    );
    await ola.waitForDeployment();
    console.log("✅ OLA 代币合约部署完成:", await ola.getAddress());
    
    // 6. 配置合约关联
    console.log("\\n=== 步骤 6: 配置合约关联 ===");
    
    // 在 Staking 中设置 OLA 地址
    const setOLATx = await staking.setOLA(await ola.getAddress());
    await setOLATx.wait();
    console.log("✅ Staking 合约已配置 OLA 地址");
    
    // 重新部署 FundRelay 包含 OLA 地址
    const fundRelay2 = await FundRelay.deploy(await usdt.getAddress(), await ola.getAddress());
    await fundRelay2.waitForDeployment();
    console.log("✅ 重新部署 FundRelay 完成:", await fundRelay2.getAddress());
    
    // 在 OLA 中设置 FundRelay
    const setFundRelayTx = await ola.setFundRelay(await fundRelay2.getAddress());
    await setFundRelayTx.wait();
    console.log("✅ OLA 合约已配置 FundRelay 地址");
    
    // 7. 创建交易对
    console.log("\\n=== 步骤 7: 创建 OLA/USDT 交易对 ===");
    
    const factory = await ethers.getContractAt("IPancakeFactory", PANCAKE_TESTNET_ADDRESSES.factory);
    const createPairTx = await factory.createPair(await ola.getAddress(), await usdt.getAddress());
    await createPairTx.wait();
    
    const pairAddress = await factory.getPair(await ola.getAddress(), await usdt.getAddress());
    console.log("✅ OLA/USDT 交易对创建完成:", pairAddress);
    
    // 在 OLA 合约中设置交易对
    const setPairTx = await ola.setPair(pairAddress);
    await setPairTx.wait();
    console.log("✅ OLA 合约已配置交易对地址");
    
    // 8. 初始化白名单
    console.log("\\n=== 步骤 8: 初始化配置 ===");
    
    const initWhitelistTx = await ola.initializeWhitelist();
    await initWhitelistTx.wait();
    console.log("✅ OLA 白名单已初始化");
    
    // 9. 添加初始流动性
    console.log("\\n=== 步骤 9: 添加初始流动性 ===");
    
    const olaAmount = ethers.parseEther("10000"); // 1万 OLA
    const usdtAmount = ethers.parseEther("10000"); // 1万 USDT
    
    // 铸造 USDT 用于流动性
    const mintUsdtTx = await usdt.mint(deployer.address, usdtAmount);
    await mintUsdtTx.wait();
    
    // 授权 Router 使用代币
    const approveOLATx = await ola.approve(PANCAKE_TESTNET_ADDRESSES.router, olaAmount);
    await approveOLATx.wait();
    const approveUSDTTx = await usdt.approve(PANCAKE_TESTNET_ADDRESSES.router, usdtAmount);
    await approveUSDTTx.wait();
    
    // 添加流动性
    const router = await ethers.getContractAt("IPancakeRouter", PANCAKE_TESTNET_ADDRESSES.router);
    const addLiquidityTx = await router.addLiquidity(
        await ola.getAddress(),
        await usdt.getAddress(),
        olaAmount,
        usdtAmount,
        0, // slippage protection disabled for initial liquidity
        0,
        deployer.address,
        Math.floor(Date.now() / 1000) + 3600 // 1 hour deadline
    );
    await addLiquidityTx.wait();
    console.log("✅ 初始流动性添加完成");
    
    // 10. 输出部署摘要
    console.log("\\n🎉 =================================================================");
    console.log("🎉                 BSC 测试网部署完成                              ");
    console.log("🎉 =================================================================");
    
    const addresses = {
        network: "BSC Testnet (ChainID: 97)",
        deployer: deployer.address,
        usdt: await usdt.getAddress(),
        ola: await ola.getAddress(),
        staking: await staking.getAddress(),
        fundRelay: await fundRelay2.getAddress(),
        pair: pairAddress,
        // 官方合约地址
        pancakeFactory: PANCAKE_TESTNET_ADDRESSES.factory,
        pancakeRouter: PANCAKE_TESTNET_ADDRESSES.router,
        wbnb: PANCAKE_TESTNET_ADDRESSES.wbnb
    };
    
    console.log("📋 部署地址:");
    Object.entries(addresses).forEach(([name, address]) => {
        console.log(\`   \${name.padEnd(15)}: \${address}\`);
    });
    
    // 保存地址到文件
    require('fs').writeFileSync(
        'testnet-addresses.json', 
        JSON.stringify(addresses, null, 2)
    );
    console.log("\\n💾 合约地址已保存到 testnet-addresses.json");
    
    // 11. 验证部署
    console.log("\\n=== 步骤 11: 验证部署 ===");
    
    const olaBalance = await ola.balanceOf(deployer.address);
    const pairOlaBalance = await ola.balanceOf(pairAddress);
    const pairUsdtBalance = await usdt.balanceOf(pairAddress);
    
    console.log("✅ 验证结果:");
    console.log(\`   部署者 OLA 余额: \${ethers.formatEther(olaBalance)}\`);
    console.log(\`   交易对 OLA 余额: \${ethers.formatEther(pairOlaBalance)}\`);
    console.log(\`   交易对 USDT 余额: \${ethers.formatEther(pairUsdtBalance)}\`);
    
    console.log("\\n📱 BSCScan 链接:");
    console.log(\`   OLA: https://testnet.bscscan.com/address/\${await ola.getAddress()}\`);
    console.log(\`   Staking: https://testnet.bscscan.com/address/\${await staking.getAddress()}\`);
    console.log(\`   USDT: https://testnet.bscscan.com/address/\${await usdt.getAddress()}\`);
    console.log(\`   Pair: https://testnet.bscscan.com/address/\${pairAddress}\`);
    
    console.log("\\n🚀 BSC 测试网部署完成！");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ 部署过程中出现错误:");
        console.error(error);
        process.exit(1);
    });
```

## 📝 部署步骤

### 1. 编译合约

```bash
npx hardhat compile
```

### 2. 部署到测试网

```bash
# 部署到BSC测试网
npx hardhat run scripts/deployToTestnet.js --network bscTestnet

# 查看部署结果
cat testnet-addresses.json
```

### 3. 验证合约 (可选)

```bash
# 验证 OLA 合约
npx hardhat verify --network bscTestnet <OLA_ADDRESS> <USDT_ADDRESS> <ROUTER_ADDRESS> <STAKING_ADDRESS> <MARKETING_ADDRESS>

# 验证 Staking 合约  
npx hardhat verify --network bscTestnet <STAKING_ADDRESS> <USDT_ADDRESS> <ROUTER_ADDRESS> <ROOT_ADDRESS> <FEE_RECIPIENT>

# 验证 USDT 合约
npx hardhat verify --network bscTestnet <USDT_ADDRESS>
```

## 🧪 部署后测试

### 测试脚本

创建 `scripts/testOnTestnet.js`:

```javascript
const { ethers } = require("hardhat");

async function main() {
    // 读取测试网部署地址
    const addresses = JSON.parse(require('fs').readFileSync('testnet-addresses.json', 'utf8'));
    
    const [deployer, user1] = await ethers.getSigners();
    
    console.log("🧪 开始测试网功能测试");
    console.log("网络:", addresses.network);
    
    // 获取合约实例
    const ola = await ethers.getContractAt("OLA", addresses.ola);
    const staking = await ethers.getContractAt("Staking", addresses.staking);
    const usdt = await ethers.getContractAt("USDT", addresses.usdt);
    
    // 1. 测试代币基本功能
    console.log("\\n=== 代币功能测试 ===");
    console.log("OLA 总供应量:", ethers.formatEther(await ola.totalSupply()));
    console.log("部署者 OLA 余额:", ethers.formatEther(await ola.balanceOf(deployer.address)));
    
    // 2. 测试推荐人绑定
    console.log("\\n=== 推荐系统测试 ===");
    if (user1) {
        const lockTx = await staking.connect(user1).lockReferral(deployer.address);
        await lockTx.wait();
        console.log("✅ User1 绑定推荐人成功");
        
        const referrer = await staking.getReferral(user1.address);
        console.log("User1 推荐人:", referrer);
    }
    
    // 3. 测试质押功能
    console.log("\\n=== 质押功能测试 ===");
    
    // 给user1一些USDT用于测试
    if (user1) {
        const mintTx = await usdt.mint(user1.address, ethers.parseEther("1000"));
        await mintTx.wait();
        console.log("✅ 为 User1 铸造 1000 USDT");
        
        // 授权质押
        const approveTx = await usdt.connect(user1).approve(addresses.staking, ethers.parseEther("100"));
        await approveTx.wait();
        
        try {
            const stakeTx = await staking.connect(user1).stake(100, 0); // 100 USDT, 1天期
            await stakeTx.wait();
            console.log("✅ User1 质押 100 USDT 成功");
        } catch (error) {
            console.log("⚠️ 质押测试:", error.message);
        }
    }
    
    // 4. 测试流动性
    console.log("\\n=== 流动性测试 ===");
    const pair = await ethers.getContractAt("IPancakePair", addresses.pair);
    const reserves = await pair.getReserves();
    console.log("流动性储备0:", ethers.formatEther(reserves[0]));
    console.log("流动性储备1:", ethers.formatEther(reserves[1]));
    
    console.log("\\n✅ 测试网功能测试完成");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
```

运行测试：
```bash
npx hardhat run scripts/testOnTestnet.js --network bscTestnet
```

## 🔍 部署验证清单

### 部署后检查项目

- [ ] OLA 代币合约部署成功
- [ ] Staking 合约部署成功  
- [ ] 合约关联配置正确
- [ ] 交易对创建成功
- [ ] 初始流动性添加成功
- [ ] 白名单初始化完成
- [ ] BSCScan 上合约验证通过
- [ ] 基础功能测试通过

### BSCScan 验证检查

访问以下链接验证部署：
- OLA 合约: `https://testnet.bscscan.com/address/{OLA_ADDRESS}`
- Staking 合约: `https://testnet.bscscan.com/address/{STAKING_ADDRESS}`
- 交易对合约: `https://testnet.bscscan.com/address/{PAIR_ADDRESS}`

## 💰 Gas 费用估算

BSC 测试网部署预估费用：
- OLA 合约: ~0.12 BNB
- Staking 合约: ~0.15 BNB  
- 其他操作: ~0.03 BNB
- **总计**: ~0.3 BNB

## 🚨 注意事项

### 安全提醒
1. **私钥安全**: 永远不要将私钥提交到代码仓库
2. **测试网限制**: 测试网代币无实际价值，仅用于测试
3. **Gas 限制**: 注意交易Gas限制，复杂合约可能需要更高Gas

### 常见问题

#### Q: 部署失败 "insufficient funds"
**A**: 确保账户有足够的测试BNB，至少0.5 BNB

#### Q: 交易一直处于pending状态
**A**: 检查Gas价格设置，BSC测试网建议至少20 gwei

#### Q: 合约验证失败
**A**: 确保构造函数参数正确，编译器版本匹配

#### Q: PancakeSwap交互失败
**A**: 确保使用正确的测试网Router地址

## 🎯 后续步骤

部署成功后，您可以：

1. **前端集成**: 使用部署地址集成到前端应用
2. **功能测试**: 测试所有DeFi和质押功能
3. **安全审计**: 进行代码审计和安全测试
4. **主网准备**: 准备主网部署配置

## 📞 技术支持

如遇到部署问题，可以：
1. 检查BSCScan交易详情
2. 查看Hardhat输出日志
3. 验证网络配置和账户余额
4. 确认合约编译无误

---

**祝您部署成功！** 🎉