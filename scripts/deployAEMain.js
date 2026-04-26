const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// =====================================================================
// AE 主网部署脚本
// 用法: npx hardhat run scripts/deployAEMain.js --network bsc
//
// 注意事项:
// 1. 部署前务必替换 ae-mainnet-config.json 中所有占位地址
// 2. 流动性需要管理员在 PancakeSwap 上手动添加（本脚本不处理）
// 3. 部署后需要手动调用 ae.setPresaleActive(false) 开放交易
// 4. 部署完成后会自动进行 BSCScan 合约验证
// =====================================================================

// 加载主网配置文件
const configPath = path.join(__dirname, "..", "ae-mainnet-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// BSC 主网固定地址
const USDX_ADDRESS = config.addresses.usdx;
const ROUTER_ADDRESS = config.addresses.pancakeRouter;
const FACTORY_ADDRESS = config.addresses.pancakeFactory;

// =====================================================================
// 【管理员必须替换的地址】
// 部署前请确认 ae-mainnet-config.json 中以下地址已替换为真实地址
// 标注 (immutable) 的地址写入合约构造函数后不可修改！
// =====================================================================
const MARKETING_ADDRESS = config.addresses.marketingAddress;                     // AE + LiquidityStaking constructor (immutable)
const ROOT_ADDRESS = config.addresses.rootAddress;                               // Staking constructor (immutable)
const FEE_RECIPIENT = config.addresses.feeRecipient;                             // Staking constructor (immutable)
const BUY_TAX_NODE_REWARD_ADDRESS = config.addresses.buyTaxNodeRewardAddress;    // AE constructor (immutable)
const BUY_TAX_COMMUNITY_REWARD_ADDRESS = config.addresses.buyTaxCommunityRewardAddress; // AE constructor (immutable)
const MARKETING_FUND_ADDRESS = config.addresses.marketingFundAddress;            // AE constructor (immutable)
const WEEKLY_TOP15_REWARD_ADDRESS = config.addresses.weeklyTop15RewardAddress;   // AE constructor (immutable)
const EDUCATION_FUND_ADDRESS = config.addresses.educationFundAddress;            // Staking constructor (immutable)
const NODE_REWARD_ADDRESS = config.addresses.nodeRewardAllocationAddress;        // 接收 18,740,000 AE
const CROSS_CHAIN_RESERVE_ADDRESS = config.addresses.crossChainReserveAddress;   // 接收 1,260,000 AE

// 代币经济学参数
const STAKING_RESERVE = hre.ethers.parseEther(config.tokenomics.stakingReserve);
const NODE_REWARD_ALLOCATION = hre.ethers.parseEther(config.tokenomics.nodeRewardAllocation);
const CROSS_CHAIN_RESERVE_ALLOCATION = hre.ethers.parseEther(config.tokenomics.crossChainReserveAllocation);

// =====================================================================
// 地址校验：确保所有地址已替换为真实地址
// =====================================================================
function validateAddresses() {
  const placeholder = /^0x0{39}[0-9a-fA-F]$/;
  const addressEntries = [
    ["marketingAddress", MARKETING_ADDRESS],
    ["rootAddress", ROOT_ADDRESS],
    ["feeRecipient", FEE_RECIPIENT],
    ["buyTaxNodeRewardAddress", BUY_TAX_NODE_REWARD_ADDRESS],
    ["buyTaxCommunityRewardAddress", BUY_TAX_COMMUNITY_REWARD_ADDRESS],
    ["marketingFundAddress", MARKETING_FUND_ADDRESS],
    ["weeklyTop15RewardAddress", WEEKLY_TOP15_REWARD_ADDRESS],
    ["educationFundAddress", EDUCATION_FUND_ADDRESS],
    ["nodeRewardAllocationAddress", NODE_REWARD_ADDRESS],
    ["crossChainReserveAddress", CROSS_CHAIN_RESERVE_ADDRESS],
  ];

  const errors = [];
  for (const [name, addr] of addressEntries) {
    if (!addr || addr === hre.ethers.ZeroAddress || placeholder.test(addr)) {
      errors.push(`  ✗ ${name} = ${addr} (占位地址，请替换为真实地址)`);
    }
  }

  if (errors.length > 0) {
    console.error("\n╔══════════════════════════════════════════════════════╗");
    console.error("║          ⚠️  地址校验失败，以下地址未替换：           ║");
    console.error("╚══════════════════════════════════════════════════════╝\n");
    errors.forEach((e) => console.error(e));
    console.error("\n请修改 ae-mainnet-config.json 后重新运行。\n");
    process.exit(1);
  }

  console.log("✓ 所有配置地址校验通过\n");
}

// =====================================================================
// BSCScan 合约验证
// =====================================================================
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

// =====================================================================
// 主部署流程
// =====================================================================
async function main() {
  // 网络检查
  if (hre.network.name !== "bsc") {
    console.error("⚠️  此脚本仅用于 BSC 主网部署！");
    console.error("   请使用: npx hardhat run scripts/deployAEMain.js --network bsc");
    console.error(`   当前网络: ${hre.network.name}`);
    process.exit(1);
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║            AE 系统 - BSC 主网部署                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  // 获取签名者
  const [deployer] = await hre.ethers.getSigners();
  const deployerBalance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("部署者地址:", deployer.address);
  console.log("部署者 BNB 余额:", hre.ethers.formatEther(deployerBalance), "BNB");

  if (deployerBalance < hre.ethers.parseEther("0.05")) {
    console.error("⚠️  BNB 余额不足，建议至少 0.05 BNB 用于支付 Gas");
    process.exit(1);
  }
  console.log();

  // 地址校验
  console.log("=== 地址校验 ===");
  validateAddresses();

  // 打印配置摘要
  console.log("=== 配置摘要 ===");
  console.log("  USDC:          ", USDX_ADDRESS);
  console.log("  PancakeRouter: ", ROUTER_ADDRESS);
  console.log("  PancakeFactory:", FACTORY_ADDRESS);
  console.log("  营销地址:      ", MARKETING_ADDRESS);
  console.log("  根地址:        ", ROOT_ADDRESS);
  console.log("  手续费接收:    ", FEE_RECIPIENT);
  console.log("  节点奖励税:    ", BUY_TAX_NODE_REWARD_ADDRESS);
  console.log("  社区奖励税:    ", BUY_TAX_COMMUNITY_REWARD_ADDRESS);
  console.log("  营销基金:      ", MARKETING_FUND_ADDRESS);
  console.log("  周Top15奖励:   ", WEEKLY_TOP15_REWARD_ADDRESS);
  console.log("  教育基金:      ", EDUCATION_FUND_ADDRESS);
  console.log("  节点奖励分配:  ", NODE_REWARD_ADDRESS);
  console.log("  跨链储备:      ", CROSS_CHAIN_RESERVE_ADDRESS);
  console.log();

  // 获取合约实例
  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", FACTORY_ADDRESS);

  // 用于存储部署结果
  const deployed = {};

  // =================================================================
  // 步骤 1: 部署 Staking 合约
  // =================================================================
  console.log("=== 步骤 1/14: 部署 Staking 合约 ===");
  const Staking = await hre.ethers.getContractFactory("contracts/AE-Staking/src/mainnet/Staking.sol:Staking");
  const staking = await Staking.deploy(
    USDX_ADDRESS,
    ROUTER_ADDRESS,
    ROOT_ADDRESS,
    FEE_RECIPIENT,
    EDUCATION_FUND_ADDRESS
  );
  await staking.waitForDeployment();
  deployed.staking = await staking.getAddress();
  console.log("✓ Staking 合约已部署:", deployed.staking);
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
    MARKETING_ADDRESS,
    BUY_TAX_NODE_REWARD_ADDRESS,
    BUY_TAX_COMMUNITY_REWARD_ADDRESS,
    MARKETING_FUND_ADDRESS,
    WEEKLY_TOP15_REWARD_ADDRESS
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
  console.log("✓ 白名单已初始化 (Owner, AE, Staking, Marketing, Router)");
  console.log();

  // =================================================================
  // 步骤 4: 配置 Staking 合约
  // =================================================================
  console.log("=== 步骤 4/14: Staking.setAE() ===");
  const setAETx = await staking.setAE(deployed.ae);
  await setAETx.wait();
  console.log("✓ Staking 合约已关联 AE 代币");
  console.log();

  // =================================================================
  // 步骤 5: 创建 AE/USDC 交易对
  // =================================================================
  console.log("=== 步骤 5/14: 创建 AE/USDC 交易对 ===");
  const createPairTx = await factory.createPair(deployed.ae, USDX_ADDRESS);
  await createPairTx.wait();
  deployed.pair = await factory.getPair(deployed.ae, USDX_ADDRESS);
  console.log("✓ AE/USDC 交易对已创建:", deployed.pair);
  console.log();

  // =================================================================
  // 步骤 6: 配置 AE 交易对
  // =================================================================
  console.log("=== 步骤 6/14: AE.setPair() ===");
  const setPairTx = await ae.setPair(deployed.pair);
  await setPairTx.wait();
  console.log("✓ AE 交易对已设置");
  console.log();

  // =================================================================
  // 步骤 7: 转移质押储备金
  // =================================================================
  console.log("=== 步骤 7/14: 转移质押储备金 ===");
  const transferReserveTx = await ae.transfer(deployed.staking, STAKING_RESERVE);
  await transferReserveTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(STAKING_RESERVE), "AE → Staking 合约");
  console.log("  Staking AE 余额:", hre.ethers.formatEther(await ae.balanceOf(deployed.staking)), "AE");
  console.log();

  // =================================================================
  // 步骤 8: 部署 LiquidityStaking 合约
  // =================================================================
  console.log("=== 步骤 8/14: 部署 LiquidityStaking 合约 ===");
  const LiquidityStaking = await hre.ethers.getContractFactory(
    "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking"
  );
  const liquidityStaking = await LiquidityStaking.deploy(
    USDX_ADDRESS,            // _usdt
    deployed.ae,             // _olaContract
    deployed.pair,           // _lpToken
    deployed.staking,        // _staking
    MARKETING_ADDRESS,       // _marketingAddress
    deployer.address,        // _admin
    ROUTER_ADDRESS           // _router
  );
  await liquidityStaking.waitForDeployment();
  deployed.liquidityStaking = await liquidityStaking.getAddress();
  console.log("✓ LiquidityStaking 已部署:", deployed.liquidityStaking);
  console.log();

  // =================================================================
  // 步骤 9: 配置 LiquidityStaking
  // =================================================================
  console.log("=== 步骤 9/14: AE.setLiquidityStaking() ===");
  const setLiquidityStakingTx = await ae.setLiquidityStaking(deployed.liquidityStaking);
  await setLiquidityStakingTx.wait();
  console.log("✓ LiquidityStaking 已加入手续费白名单");
  console.log();

  // =================================================================
  // 步骤 10: 部署 FundRelay 合约
  // =================================================================
  console.log("=== 步骤 10/14: 部署 FundRelay 合约 ===");
  const FundRelay = await hre.ethers.getContractFactory("contracts/AE/src/utils/FundRelay.sol:FundRelay");
  const fundRelay = await FundRelay.deploy(
    deployed.ae,             // AE 合约地址
    USDX_ADDRESS,            // USDC 地址
    deployer.address         // 紧急提取地址
  );
  await fundRelay.waitForDeployment();
  deployed.fundRelay = await fundRelay.getAddress();
  console.log("✓ FundRelay 已部署:", deployed.fundRelay);
  console.log();

  // =================================================================
  // 步骤 11: 配置 FundRelay
  // =================================================================
  console.log("=== 步骤 11/14: AE.setFundRelay() ===");
  const setFundRelayTx = await ae.setFundRelay(deployed.fundRelay);
  await setFundRelayTx.wait();
  console.log("✓ FundRelay 已加入手续费白名单");
  console.log();

  // =================================================================
  // 步骤 12: 转移节点奖励
  // =================================================================
  console.log("=== 步骤 12/14: 转移节点奖励 ===");
  const transferNodeTx = await ae.transfer(NODE_REWARD_ADDRESS, NODE_REWARD_ALLOCATION);
  await transferNodeTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(NODE_REWARD_ALLOCATION), "AE → 节点奖励地址");
  console.log("  地址:", NODE_REWARD_ADDRESS);
  console.log();

  // =================================================================
  // 步骤 13: 转移跨链储备
  // =================================================================
  console.log("=== 步骤 13/14: 转移跨链储备 ===");
  const transferCrossChainTx = await ae.transfer(CROSS_CHAIN_RESERVE_ADDRESS, CROSS_CHAIN_RESERVE_ALLOCATION);
  await transferCrossChainTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(CROSS_CHAIN_RESERVE_ALLOCATION), "AE → 跨链储备地址");
  console.log("  地址:", CROSS_CHAIN_RESERVE_ADDRESS);
  console.log();

  // =================================================================
  // 步骤 14: 验证部署 & 保存结果
  // =================================================================
  console.log("=== 步骤 14/14: 验证部署结果 ===\n");

  const deployerAEBalance = await ae.balanceOf(deployer.address);
  const stakingAEBalance = await ae.balanceOf(deployed.staking);
  const nodeRewardAEBalance = await ae.balanceOf(NODE_REWARD_ADDRESS);
  const crossChainReserveAEBalance = await ae.balanceOf(CROSS_CHAIN_RESERVE_ADDRESS);

  const TOTAL_SUPPLY = hre.ethers.parseEther(config.tokenomics.totalSupply);
  const fmt = (val) => Number(hre.ethers.formatEther(val)).toLocaleString();
  const pct = (val) => (Number(hre.ethers.formatEther(val)) / Number(hre.ethers.formatEther(TOTAL_SUPPLY)) * 100).toFixed(2);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                   AE 代币余额验证                        ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  部署者 (待添加流动性):  ${fmt(deployerAEBalance).padEnd(20)} AE  (${pct(deployerAEBalance)}%)`.padEnd(59) + "║");
  console.log(`║  Staking 储备金:        ${fmt(stakingAEBalance).padEnd(20)} AE  (${pct(stakingAEBalance)}%)`.padEnd(59) + "║");
  console.log(`║  节点奖励:              ${fmt(nodeRewardAEBalance).padEnd(20)} AE  (${pct(nodeRewardAEBalance)}%)`.padEnd(59) + "║");
  console.log(`║  跨链储备:              ${fmt(crossChainReserveAEBalance).padEnd(20)} AE  (${pct(crossChainReserveAEBalance)}%)`.padEnd(59) + "║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // 保存部署信息
  const deploymentInfo = {
    network: "bsc",
    chainId: 56,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      AE: deployed.ae,
      Staking: deployed.staking,
      LiquidityStaking: deployed.liquidityStaking,
      FundRelay: deployed.fundRelay,
      "AE/USDC Pair": deployed.pair,
    },
    configAddresses: {
      marketingAddress: MARKETING_ADDRESS,
      rootAddress: ROOT_ADDRESS,
      feeRecipient: FEE_RECIPIENT,
      buyTaxNodeRewardAddress: BUY_TAX_NODE_REWARD_ADDRESS,
      buyTaxCommunityRewardAddress: BUY_TAX_COMMUNITY_REWARD_ADDRESS,
      marketingFundAddress: MARKETING_FUND_ADDRESS,
      weeklyTop15RewardAddress: WEEKLY_TOP15_REWARD_ADDRESS,
      educationFundAddress: EDUCATION_FUND_ADDRESS,
      nodeRewardAllocationAddress: NODE_REWARD_ADDRESS,
      crossChainReserveAddress: CROSS_CHAIN_RESERVE_ADDRESS,
    },
    balances: {
      deployer: hre.ethers.formatEther(deployerAEBalance),
      staking: hre.ethers.formatEther(stakingAEBalance),
      nodeReward: hre.ethers.formatEther(nodeRewardAEBalance),
      crossChainReserve: hre.ethers.formatEther(crossChainReserveAEBalance),
    },
  };

  const outputPath = path.join(__dirname, "..", "ae-mainnet-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ 部署信息已保存至:", outputPath);
  console.log();

  // =================================================================
  // 合约开源验证 (BSCScan)
  // =================================================================
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                BSCScan 合约验证                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (!process.env.BSCSCAN_API_KEY) {
    console.log("⚠️  未配置 BSCSCAN_API_KEY，跳过自动验证。");
    console.log("   请在 .env 中设置 BSCSCAN_API_KEY 后手动验证。\n");
  } else {
    // 等待一些区块确认，BSCScan 需要时间索引合约
    console.log("等待区块确认后开始验证...\n");

    // 验证 Staking
    await verifyContract(
      "Staking",
      deployed.staking,
      [USDX_ADDRESS, ROUTER_ADDRESS, ROOT_ADDRESS, FEE_RECIPIENT, EDUCATION_FUND_ADDRESS],
      "contracts/AE-Staking/src/mainnet/Staking.sol:Staking"
    );

    // 验证 AE
    await verifyContract(
      "AE",
      deployed.ae,
      [
        USDX_ADDRESS,
        ROUTER_ADDRESS,
        deployed.staking,
        MARKETING_ADDRESS,
        BUY_TAX_NODE_REWARD_ADDRESS,
        BUY_TAX_COMMUNITY_REWARD_ADDRESS,
        MARKETING_FUND_ADDRESS,
        WEEKLY_TOP15_REWARD_ADDRESS,
      ],
      "contracts/AE/src/mainnet/AE.sol:AE"
    );

    // 验证 LiquidityStaking
    await verifyContract(
      "LiquidityStaking",
      deployed.liquidityStaking,
      [
        USDX_ADDRESS,
        deployed.ae,
        deployed.pair,
        deployed.staking,
        MARKETING_ADDRESS,
        deployer.address,
        ROUTER_ADDRESS,
      ],
      "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking"
    );

    // 验证 FundRelay
    await verifyContract(
      "FundRelay",
      deployed.fundRelay,
      [deployed.ae, USDX_ADDRESS, deployer.address],
      "contracts/AE/src/utils/FundRelay.sol:FundRelay"
    );

    console.log();
  }

  // =================================================================
  // 最终输出
  // =================================================================
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              AE 主网部署完成!                            ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║                                                          ║");
  console.log("║  已部署的合约:                                           ║");
  console.log(`║    AE 代币:           ${deployed.ae}  ║`);
  console.log(`║    Staking:           ${deployed.staking}  ║`);
  console.log(`║    LiquidityStaking:  ${deployed.liquidityStaking}  ║`);
  console.log(`║    FundRelay:         ${deployed.fundRelay}  ║`);
  console.log(`║    AE/USDC Pair:      ${deployed.pair}  ║`);
  console.log("║                                                          ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  接下来需要手动完成:                                      ║");
  console.log("║                                                          ║");
  console.log("║  1. 在 PancakeSwap 添加流动性:                           ║");
  console.log("║     - 60,000,000 AE + 60,000 USDC                       ║");
  console.log("║     - 需要先 approve AE 和 USDC 给 Router               ║");
  console.log("║     - LP 代币建议销毁到 address(0)                       ║");
  console.log("║                                                          ║");
  console.log("║  2. 开放交易:                                            ║");
  console.log("║     - 调用 ae.setPresaleActive(false)                    ║");
  console.log("║                                                          ║");
  console.log("║  3. 验证确认:                                            ║");
  console.log("║     - 在 BSCScan 确认合约已开源                          ║");
  console.log("║     - 测试买入/卖出交易                                   ║");
  console.log("║                                                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n⚠️  部署失败:", error);
    process.exit(1);
  });
