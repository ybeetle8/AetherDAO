const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// =====================================================================
// AE 测试网部署脚本 (BSC Testnet / Chapel)
// 用法: npx hardhat run scripts/deployAETest.js --network bscTestnet
//
// 与主网脚本的区别:
// 1. 自动部署 MockUSDC 作为配对代币
// 2. 所有配置地址统一使用部署者地址（简化测试）
// 3. 脚本自动添加流动性 + 自动关闭预售
// 4. 使用 PancakeSwap 测试网 Router/Factory
// =====================================================================

// PancakeSwap 测试网地址 (官方)
const ROUTER_ADDRESS = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const FACTORY_ADDRESS = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";

// 代币经济学参数
const TOTAL_SUPPLY_STR = "100000000";
const STAKING_RESERVE_STR = "20000000";
const INITIAL_LIQUIDITY_AE_STR = "60000000";
const INITIAL_LIQUIDITY_USDX_STR = "60000";
const NODE_REWARD_STR = "18740000";
const CROSS_CHAIN_STR = "1260000";

// BSCScan 合约验证
async function verifyContract(name, address, constructorArgs, contractPath) {
  console.log(`  验证 ${name} (${address})...`);
  try {
    await hre.run("verify:verify", {
      address: address,
      constructorArguments: constructorArgs,
      contract: contractPath,
    });
    console.log(`  ✓ ${name} 验证成功`);
    return true;
  } catch (error) {
    if (error.message.includes("Already Verified") || error.message.includes("already verified")) {
      console.log(`  ✓ ${name} 已经验证过了`);
      return true;
    }
    console.error(`  ✗ ${name} 验证失败: ${error.message}`);
    return false;
  }
}

async function main() {
  // 网络检查
  if (hre.network.name !== "bscTestnet") {
    console.error("⚠️  此脚本仅用于 BSC 测试网！");
    console.error("   请使用: npx hardhat run scripts/deployAETest.js --network bscTestnet");
    console.error(`   当前网络: ${hre.network.name}`);
    process.exit(1);
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║         AE 系统 - BSC 测试网部署 (Chapel)            ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const [deployer] = await hre.ethers.getSigners();
  const deployerBalance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("部署者地址:", deployer.address);
  console.log("tBNB 余额:", hre.ethers.formatEther(deployerBalance), "tBNB");

  if (deployerBalance < hre.ethers.parseEther("0.05")) {
    console.error("⚠️  tBNB 余额不足，请从水龙头获取测试币");
    console.error("   https://www.bnbchain.org/en/testnet-faucet");
    process.exit(1);
  }
  console.log();

  // 测试网所有配置地址统一使用部署者地址
  const ALL_ADDR = deployer.address;
  console.log("=== 测试网简化配置 ===");
  console.log("  所有配置地址统一使用部署者地址:", ALL_ADDR);
  console.log("  PancakeSwap Router:", ROUTER_ADDRESS);
  console.log("  PancakeSwap Factory:", FACTORY_ADDRESS);
  console.log();

  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", FACTORY_ADDRESS);
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);
  const deployed = {};

  // =================================================================
  // 步骤 0: 部署 MockUSDC
  // =================================================================
  console.log("=== 步骤 0: 部署 MockUSDC (测试用配对代币) ===");
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const mockUsdcSupply = hre.ethers.parseEther("1000000"); // 100万
  const mockUsdc = await MockERC20.deploy("Mock USDC", "USDC", mockUsdcSupply);
  await mockUsdc.waitForDeployment();
  deployed.mockUsdc = await mockUsdc.getAddress();
  console.log("✓ MockUSDC 已部署:", deployed.mockUsdc);
  console.log("  余额:", hre.ethers.formatEther(await mockUsdc.balanceOf(deployer.address)), "USDC");
  console.log();

  const USDX_ADDRESS = deployed.mockUsdc;

  // =================================================================
  // 步骤 1: 部署 Staking 合约
  // =================================================================
  console.log("=== 步骤 1/14: 部署 Staking 合约 ===");
  const Staking = await hre.ethers.getContractFactory("contracts/AE-Staking/src/mainnet/Staking.sol:Staking");
  const staking = await Staking.deploy(
    USDX_ADDRESS,
    ROUTER_ADDRESS,
    ALL_ADDR,   // rootAddress
    ALL_ADDR,   // feeRecipient
    ALL_ADDR    // educationFundAddress
  );
  await staking.waitForDeployment();
  deployed.staking = await staking.getAddress();
  console.log("✓ Staking 已部署:", deployed.staking);
  console.log();

  // =================================================================
  // 步骤 2: 部署 AE 代币合约
  // =================================================================
  console.log("=== 步骤 2/14: 部署 AE 代币合约 ===");
  const AE = await hre.ethers.getContractFactory("contracts/AE/src/mainnet/AE.sol:AE");
  const ae = await AE.deploy(
    USDX_ADDRESS,
    ROUTER_ADDRESS,
    deployed.staking,
    ALL_ADDR,   // marketingAddress
    ALL_ADDR,   // buyTaxNodeRewardAddress
    ALL_ADDR,   // buyTaxCommunityRewardAddress
    ALL_ADDR,   // marketingFundAddress
    ALL_ADDR    // weeklyTop15RewardAddress
  );
  await ae.waitForDeployment();
  deployed.ae = await ae.getAddress();
  console.log("✓ AE 代币已部署:", deployed.ae);
  console.log("  初始供应量:", hre.ethers.formatEther(await ae.balanceOf(deployer.address)), "AE");
  console.log();

  // =================================================================
  // 步骤 3: 初始化 AE 白名单
  // =================================================================
  console.log("=== 步骤 3/14: 初始化 AE 白名单 ===");
  const initWhitelistTx = await ae.initializeWhitelist();
  await initWhitelistTx.wait();
  console.log("✓ 白名单已初始化");
  console.log();

  // =================================================================
  // 步骤 4: Staking.setAE()
  // =================================================================
  console.log("=== 步骤 4/14: Staking.setAE() ===");
  const setAETx = await staking.setAE(deployed.ae);
  await setAETx.wait();
  console.log("✓ Staking 已关联 AE");
  console.log();

  // =================================================================
  // 步骤 5: 创建交易对
  // =================================================================
  console.log("=== 步骤 5/14: 创建 AE/USDC 交易对 ===");
  const createPairTx = await factory.createPair(deployed.ae, USDX_ADDRESS);
  await createPairTx.wait();
  deployed.pair = await factory.getPair(deployed.ae, USDX_ADDRESS);
  console.log("✓ 交易对已创建:", deployed.pair);
  console.log();

  // =================================================================
  // 步骤 6: AE.setPair()
  // =================================================================
  console.log("=== 步骤 6/14: AE.setPair() ===");
  const setPairTx = await ae.setPair(deployed.pair);
  await setPairTx.wait();
  console.log("✓ 交易对已设置");
  console.log();

  // =================================================================
  // 步骤 7: 转移质押储备金
  // =================================================================
  console.log("=== 步骤 7/14: 转移质押储备金 ===");
  const STAKING_RESERVE = hre.ethers.parseEther(STAKING_RESERVE_STR);
  const transferReserveTx = await ae.transfer(deployed.staking, STAKING_RESERVE);
  await transferReserveTx.wait();
  console.log("✓ 已转移", STAKING_RESERVE_STR, "AE → Staking");
  console.log();

  // =================================================================
  // 步骤 8: 部署 LiquidityStaking
  // =================================================================
  console.log("=== 步骤 8/14: 部署 LiquidityStaking ===");
  const LiquidityStaking = await hre.ethers.getContractFactory(
    "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking"
  );
  const liquidityStaking = await LiquidityStaking.deploy(
    USDX_ADDRESS,
    deployed.ae,
    deployed.pair,
    deployed.staking,
    ALL_ADDR,           // marketingAddress
    deployer.address,   // admin
    ROUTER_ADDRESS
  );
  await liquidityStaking.waitForDeployment();
  deployed.liquidityStaking = await liquidityStaking.getAddress();
  console.log("✓ LiquidityStaking 已部署:", deployed.liquidityStaking);
  console.log();

  // =================================================================
  // 步骤 9: AE.setLiquidityStaking()
  // =================================================================
  console.log("=== 步骤 9/14: AE.setLiquidityStaking() ===");
  const setLSTx = await ae.setLiquidityStaking(deployed.liquidityStaking);
  await setLSTx.wait();
  console.log("✓ LiquidityStaking 已加入白名单");
  console.log();

  // =================================================================
  // 步骤 10: 部署 FundRelay
  // =================================================================
  console.log("=== 步骤 10/14: 部署 FundRelay ===");
  const FundRelay = await hre.ethers.getContractFactory("contracts/AE/src/utils/FundRelay.sol:FundRelay");
  const fundRelay = await FundRelay.deploy(
    deployed.ae,
    USDX_ADDRESS,
    deployer.address
  );
  await fundRelay.waitForDeployment();
  deployed.fundRelay = await fundRelay.getAddress();
  console.log("✓ FundRelay 已部署:", deployed.fundRelay);
  console.log();

  // =================================================================
  // 步骤 11: AE.setFundRelay()
  // =================================================================
  console.log("=== 步骤 11/14: AE.setFundRelay() ===");
  const setFRTx = await ae.setFundRelay(deployed.fundRelay);
  await setFRTx.wait();
  console.log("✓ FundRelay 已加入白名单");
  console.log();

  // =================================================================
  // 步骤 12: 转移节点奖励
  // =================================================================
  console.log("=== 步骤 12/14: 转移节点奖励 ===");
  const NODE_REWARD_ALLOCATION = hre.ethers.parseEther(NODE_REWARD_STR);
  const transferNodeTx = await ae.transfer(ALL_ADDR, NODE_REWARD_ALLOCATION);
  await transferNodeTx.wait();
  console.log("✓ 节点奖励:", NODE_REWARD_STR, "AE (转到部署者自身，测试用)");
  console.log();

  // =================================================================
  // 步骤 13: 转移跨链储备
  // =================================================================
  console.log("=== 步骤 13/14: 转移跨链储备 ===");
  const CROSS_CHAIN_ALLOCATION = hre.ethers.parseEther(CROSS_CHAIN_STR);
  const transferCCTx = await ae.transfer(ALL_ADDR, CROSS_CHAIN_ALLOCATION);
  await transferCCTx.wait();
  console.log("✓ 跨链储备:", CROSS_CHAIN_STR, "AE (转到部署者自身，测试用)");
  console.log();

  // =================================================================
  // 步骤 14: 添加流动性 + 开放交易
  // =================================================================
  console.log("=== 步骤 14/14: 添加流动性 & 开放交易 ===");

  const LIQUIDITY_AE = hre.ethers.parseEther(INITIAL_LIQUIDITY_AE_STR);
  const LIQUIDITY_USDX = hre.ethers.parseEther(INITIAL_LIQUIDITY_USDX_STR);

  // Approve
  const approveAETx = await ae.approve(ROUTER_ADDRESS, LIQUIDITY_AE);
  await approveAETx.wait();
  const approveUSDXTx = await mockUsdc.approve(ROUTER_ADDRESS, LIQUIDITY_USDX);
  await approveUSDXTx.wait();
  console.log("✓ 已授权 Router");

  // Add Liquidity
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const addLiqTx = await router.addLiquidity(
    deployed.ae,
    USDX_ADDRESS,
    LIQUIDITY_AE,
    LIQUIDITY_USDX,
    0n,  // 测试网不需要滑点保护
    0n,
    deployer.address,
    deadline
  );
  await addLiqTx.wait();
  console.log("✓ 已添加流动性:", INITIAL_LIQUIDITY_AE_STR, "AE +", INITIAL_LIQUIDITY_USDX_STR, "USDC");

  // 关闭预售
  const setPresaleTx = await ae.setPresaleActive(false);
  await setPresaleTx.wait();
  console.log("✓ 预售已关闭，交易已开放");
  console.log();

  // =================================================================
  // 验证部署结果
  // =================================================================
  console.log("=== 部署结果 ===\n");

  const deployerAE = await ae.balanceOf(deployer.address);
  const stakingAE = await ae.balanceOf(deployed.staking);
  const pairAE = await ae.balanceOf(deployed.pair);

  console.log("  部署者 AE 余额:", hre.ethers.formatEther(deployerAE));
  console.log("  Staking AE 余额:", hre.ethers.formatEther(stakingAE));
  console.log("  流动性池 AE:    ", hre.ethers.formatEther(pairAE));
  console.log();

  // 保存部署信息
  const deploymentInfo = {
    network: "bscTestnet",
    chainId: 97,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      MockUSDC: deployed.mockUsdc,
      AE: deployed.ae,
      Staking: deployed.staking,
      LiquidityStaking: deployed.liquidityStaking,
      FundRelay: deployed.fundRelay,
      "AE/USDC Pair": deployed.pair,
    },
    pancakeSwap: {
      router: ROUTER_ADDRESS,
      factory: FACTORY_ADDRESS,
    },
  };

  const outputPath = path.join(__dirname, "..", "ae-testnet-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ 部署信息已保存至:", outputPath);
  console.log();

  // =================================================================
  // BSCScan Testnet 合约验证
  // =================================================================
  console.log("=== BSCScan Testnet 合约验证 ===\n");

  if (!process.env.BSCSCAN_API_KEY) {
    console.log("⚠️  未配置 BSCSCAN_API_KEY，跳过验证。\n");
  } else {
    console.log("等待区块确认...\n");

    await verifyContract("MockUSDC", deployed.mockUsdc,
      ["Mock USDC", "USDC", mockUsdcSupply.toString()],
      "contracts/test/MockERC20.sol:MockERC20"
    );

    await verifyContract("Staking", deployed.staking,
      [USDX_ADDRESS, ROUTER_ADDRESS, ALL_ADDR, ALL_ADDR, ALL_ADDR],
      "contracts/AE-Staking/src/mainnet/Staking.sol:Staking"
    );

    await verifyContract("AE", deployed.ae,
      [USDX_ADDRESS, ROUTER_ADDRESS, deployed.staking, ALL_ADDR, ALL_ADDR, ALL_ADDR, ALL_ADDR, ALL_ADDR],
      "contracts/AE/src/mainnet/AE.sol:AE"
    );

    await verifyContract("LiquidityStaking", deployed.liquidityStaking,
      [USDX_ADDRESS, deployed.ae, deployed.pair, deployed.staking, ALL_ADDR, deployer.address, ROUTER_ADDRESS],
      "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking"
    );

    await verifyContract("FundRelay", deployed.fundRelay,
      [deployed.ae, USDX_ADDRESS, deployer.address],
      "contracts/AE/src/utils/FundRelay.sol:FundRelay"
    );

    console.log();
  }

  // =================================================================
  // 完成
  // =================================================================
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║          AE 测试网部署完成!                          ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  MockUSDC:          ${deployed.mockUsdc}  ║`);
  console.log(`║  AE:                ${deployed.ae}  ║`);
  console.log(`║  Staking:           ${deployed.staking}  ║`);
  console.log(`║  LiquidityStaking:  ${deployed.liquidityStaking}  ║`);
  console.log(`║  FundRelay:         ${deployed.fundRelay}  ║`);
  console.log(`║  Pair:              ${deployed.pair}  ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  流动性已添加，交易已开放，可直接测试买卖             ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n⚠️  部署失败:", error);
    process.exit(1);
  });
