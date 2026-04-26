const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// =====================================================================
// AE 主网部署脚本
// 用法: npx hardhat run scripts/deployAEMain.js --network bsc
//
// 支持断点续跑：中途失败后重新运行，自动跳过已完成的步骤
// 状态文件: ae-mainnet-deployment.json
// 如需全新部署，删除该文件后重新运行
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

// 状态文件路径
const STATE_PATH = path.join(__dirname, "..", "ae-mainnet-deployment.json");

// =====================================================================
// 状态管理: 每完成一步保存，断点续跑时读取跳过
// =====================================================================
function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    const data = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    console.log("✓ 检测到已有部署状态，将从断点继续");
    console.log("  已完成步骤:", data.completedStep || 0);
    console.log();
    return data;
  }
  return { completedStep: 0, contracts: {} };
}

function saveState(state) {
  state.timestamp = new Date().toISOString();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

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
// BSCScan 合约验证 (通过子进程调用 npx hardhat verify)
// =====================================================================
function verifyContract(name, address, constructorArgs, contractPath, networkName) {
  console.log(`  验证 ${name} (${address})...`);
  try {
    const args = constructorArgs.map(a => `"${a}"`).join(" ");
    const cmd = `npx hardhat verify --network ${networkName} --contract "${contractPath}" ${address} ${args}`;
    const output = execSync(cmd, { encoding: "utf8", timeout: 120000 });
    if (output.includes("Already Verified") || output.includes("already verified")) {
      console.log(`  ✓ ${name} 已经验证过了`);
    } else {
      console.log(`  ✓ ${name} 验证成功`);
    }
    return true;
  } catch (error) {
    const stderr = error.stderr || error.stdout || error.message || "";
    if (stderr.includes("Already Verified") || stderr.includes("already verified")) {
      console.log(`  ✓ ${name} 已经验证过了`);
      return true;
    }
    console.error(`  ✗ ${name} 验证失败: ${stderr.split("\n").slice(0, 3).join(" ")}`);
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

  // 加载断点状态
  const state = loadState();
  const done = state.completedStep || 0;
  const C = state.contracts; // 已部署合约地址的简写

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

  // =================================================================
  // 步骤 1: 部署 Staking 合约
  // =================================================================
  if (done < 1) {
    console.log("=== 步骤 1/13: 部署 Staking 合约 ===");
    const Staking = await hre.ethers.getContractFactory("contracts/AE-Staking/src/mainnet/Staking.sol:Staking");
    const staking = await Staking.deploy(
      USDX_ADDRESS,
      ROUTER_ADDRESS,
      ROOT_ADDRESS,
      FEE_RECIPIENT,
      EDUCATION_FUND_ADDRESS
    );
    await staking.waitForDeployment();
    C.Staking = await staking.getAddress();
    state.completedStep = 1;
    saveState(state);
    console.log("✓ Staking 合约已部署:", C.Staking);
    console.log();
  } else {
    console.log("=== 步骤 1/13: Staking 已存在，跳过 ===", C.Staking);
    console.log();
  }

  // =================================================================
  // 步骤 2: 部署 AE 代币合约
  // =================================================================
  if (done < 2) {
    console.log("=== 步骤 2/13: 部署 AE 代币合约 ===");
    const AE = await hre.ethers.getContractFactory("contracts/AE/src/mainnet/AE.sol:AE");
    const ae = await AE.deploy(
      USDX_ADDRESS,
      ROUTER_ADDRESS,
      C.Staking,
      MARKETING_ADDRESS,
      BUY_TAX_NODE_REWARD_ADDRESS,
      BUY_TAX_COMMUNITY_REWARD_ADDRESS,
      MARKETING_FUND_ADDRESS,
      WEEKLY_TOP15_REWARD_ADDRESS
    );
    await ae.waitForDeployment();
    C.AE = await ae.getAddress();
    state.completedStep = 2;
    saveState(state);
    console.log("✓ AE 代币已部署:", C.AE);
    console.log();
  } else {
    console.log("=== 步骤 2/13: AE 已存在，跳过 ===", C.AE);
    console.log();
  }

  // 获取 AE 合约实例 (续跑时也需要)
  const ae = await hre.ethers.getContractAt("contracts/AE/src/mainnet/AE.sol:AE", C.AE);

  // =================================================================
  // 步骤 3: 初始化 AE 白名单
  // =================================================================
  if (done < 3) {
    console.log("=== 步骤 3/13: 初始化 AE 白名单 ===");
    const tx = await ae.initializeWhitelist();
    await tx.wait();
    state.completedStep = 3;
    saveState(state);
    console.log("✓ 白名单已初始化 (Owner, AE, Staking, Marketing, Router)");
    console.log();
  } else {
    console.log("=== 步骤 3/13: 白名单已初始化，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 4: Staking.setAE()
  // =================================================================
  if (done < 4) {
    console.log("=== 步骤 4/13: Staking.setAE() ===");
    const staking = await hre.ethers.getContractAt("contracts/AE-Staking/src/mainnet/Staking.sol:Staking", C.Staking);
    const tx = await staking.setAE(C.AE);
    await tx.wait();
    state.completedStep = 4;
    saveState(state);
    console.log("✓ Staking 合约已关联 AE 代币");
    console.log();
  } else {
    console.log("=== 步骤 4/13: Staking.setAE() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 5: 创建 AE/USDC 交易对
  // =================================================================
  if (done < 5) {
    console.log("=== 步骤 5/13: 创建 AE/USDC 交易对 ===");
    const tx = await factory.createPair(C.AE, USDX_ADDRESS);
    await tx.wait();
    C.Pair = await factory.getPair(C.AE, USDX_ADDRESS);
    state.completedStep = 5;
    saveState(state);
    console.log("✓ AE/USDC 交易对已创建:", C.Pair);
    console.log();
  } else {
    console.log("=== 步骤 5/13: 交易对已存在，跳过 ===", C.Pair);
    console.log();
  }

  // =================================================================
  // 步骤 6: AE.setPair()
  // =================================================================
  if (done < 6) {
    console.log("=== 步骤 6/13: AE.setPair() ===");
    const tx = await ae.setPair(C.Pair);
    await tx.wait();
    state.completedStep = 6;
    saveState(state);
    console.log("✓ AE 交易对已设置");
    console.log();
  } else {
    console.log("=== 步骤 6/13: AE.setPair() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 7: 转移质押储备金
  // =================================================================
  if (done < 7) {
    console.log("=== 步骤 7/13: 转移质押储备金 ===");
    const tx = await ae.transfer(C.Staking, STAKING_RESERVE);
    await tx.wait();
    state.completedStep = 7;
    saveState(state);
    console.log("✓ 已转移", hre.ethers.formatEther(STAKING_RESERVE), "AE → Staking 合约");
    console.log();
  } else {
    console.log("=== 步骤 7/13: 质押储备金已转移，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 8: 部署 LiquidityStaking 合约
  // =================================================================
  if (done < 8) {
    console.log("=== 步骤 8/13: 部署 LiquidityStaking 合约 ===");
    const LS = await hre.ethers.getContractFactory(
      "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking"
    );
    const ls = await LS.deploy(
      USDX_ADDRESS,            // _usdt
      C.AE,                    // _olaContract
      C.Pair,                  // _lpToken
      C.Staking,               // _staking
      MARKETING_ADDRESS,       // _marketingAddress
      deployer.address,        // _admin
      ROUTER_ADDRESS           // _router
    );
    await ls.waitForDeployment();
    C.LiquidityStaking = await ls.getAddress();
    state.completedStep = 8;
    saveState(state);
    console.log("✓ LiquidityStaking 已部署:", C.LiquidityStaking);
    console.log();
  } else {
    console.log("=== 步骤 8/13: LiquidityStaking 已存在，跳过 ===", C.LiquidityStaking);
    console.log();
  }

  // =================================================================
  // 步骤 9: AE.setLiquidityStaking()
  // =================================================================
  if (done < 9) {
    console.log("=== 步骤 9/13: AE.setLiquidityStaking() ===");
    const tx = await ae.setLiquidityStaking(C.LiquidityStaking);
    await tx.wait();
    state.completedStep = 9;
    saveState(state);
    console.log("✓ LiquidityStaking 已加入手续费白名单");
    console.log();
  } else {
    console.log("=== 步骤 9/13: setLiquidityStaking() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 10: 部署 FundRelay 合约
  // =================================================================
  if (done < 10) {
    console.log("=== 步骤 10/13: 部署 FundRelay 合约 ===");
    const FR = await hre.ethers.getContractFactory("contracts/AE/src/utils/FundRelay.sol:FundRelay");
    const fr = await FR.deploy(
      C.AE,                    // AE 合约地址
      USDX_ADDRESS,            // USDC 地址
      deployer.address         // 紧急提取地址
    );
    await fr.waitForDeployment();
    C.FundRelay = await fr.getAddress();
    state.completedStep = 10;
    saveState(state);
    console.log("✓ FundRelay 已部署:", C.FundRelay);
    console.log();
  } else {
    console.log("=== 步骤 10/13: FundRelay 已存在，跳过 ===", C.FundRelay);
    console.log();
  }

  // =================================================================
  // 步骤 11: AE.setFundRelay()
  // =================================================================
  if (done < 11) {
    console.log("=== 步骤 11/13: AE.setFundRelay() ===");
    const tx = await ae.setFundRelay(C.FundRelay);
    await tx.wait();
    state.completedStep = 11;
    saveState(state);
    console.log("✓ FundRelay 已加入手续费白名单");
    console.log();
  } else {
    console.log("=== 步骤 11/13: setFundRelay() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 12: 转移节点奖励
  // =================================================================
  if (done < 12) {
    console.log("=== 步骤 12/13: 转移节点奖励 ===");
    const tx = await ae.transfer(NODE_REWARD_ADDRESS, NODE_REWARD_ALLOCATION);
    await tx.wait();
    state.completedStep = 12;
    saveState(state);
    console.log("✓ 已转移", hre.ethers.formatEther(NODE_REWARD_ALLOCATION), "AE → 节点奖励地址");
    console.log("  地址:", NODE_REWARD_ADDRESS);
    console.log();
  } else {
    console.log("=== 步骤 12/13: 节点奖励已转移，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 13: 转移跨链储备
  // =================================================================
  if (done < 13) {
    console.log("=== 步骤 13/13: 转移跨链储备 ===");
    const tx = await ae.transfer(CROSS_CHAIN_RESERVE_ADDRESS, CROSS_CHAIN_RESERVE_ALLOCATION);
    await tx.wait();
    state.completedStep = 13;
    saveState(state);
    console.log("✓ 已转移", hre.ethers.formatEther(CROSS_CHAIN_RESERVE_ALLOCATION), "AE → 跨链储备地址");
    console.log("  地址:", CROSS_CHAIN_RESERVE_ADDRESS);
    console.log();
  } else {
    console.log("=== 步骤 13/13: 跨链储备已转移，跳过 ===");
    console.log();
  }

  // =================================================================
  // 验证部署结果 & 保存最终状态
  // =================================================================
  console.log("=== 部署结果 ===\n");

  const deployerAEBalance = await ae.balanceOf(deployer.address);
  const stakingAEBalance = await ae.balanceOf(C.Staking);
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

  // 更新最终状态
  state.network = "bsc";
  state.chainId = 56;
  state.deployer = deployer.address;
  state.pancakeSwap = { router: ROUTER_ADDRESS, factory: FACTORY_ADDRESS };
  state.configAddresses = {
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
  };
  state.balances = {
    deployer: hre.ethers.formatEther(deployerAEBalance),
    staking: hre.ethers.formatEther(stakingAEBalance),
    nodeReward: hre.ethers.formatEther(nodeRewardAEBalance),
    crossChainReserve: hre.ethers.formatEther(crossChainReserveAEBalance),
  };
  saveState(state);
  console.log("✓ 部署信息已保存至:", STATE_PATH);
  console.log();

  // =================================================================
  // BSCScan 合约验证
  // =================================================================
  if (done < 14) {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║                BSCScan 合约验证                          ║");
    console.log("╚══════════════════════════════════════════════════════════╝\n");

    if (!process.env.BSCSCAN_API_KEY) {
      console.log("⚠️  未配置 BSCSCAN_API_KEY，跳过自动验证。");
      console.log("   请在 .env 中设置 BSCSCAN_API_KEY 后手动验证。\n");
    } else {
      console.log("等待区块确认后开始验证...\n");

      const net = "bsc";

      verifyContract(
        "Staking",
        C.Staking,
        [USDX_ADDRESS, ROUTER_ADDRESS, ROOT_ADDRESS, FEE_RECIPIENT, EDUCATION_FUND_ADDRESS],
        "contracts/AE-Staking/src/mainnet/Staking.sol:Staking", net
      );

      verifyContract(
        "AE",
        C.AE,
        [
          USDX_ADDRESS,
          ROUTER_ADDRESS,
          C.Staking,
          MARKETING_ADDRESS,
          BUY_TAX_NODE_REWARD_ADDRESS,
          BUY_TAX_COMMUNITY_REWARD_ADDRESS,
          MARKETING_FUND_ADDRESS,
          WEEKLY_TOP15_REWARD_ADDRESS,
        ],
        "contracts/AE/src/mainnet/AE.sol:AE", net
      );

      verifyContract(
        "LiquidityStaking",
        C.LiquidityStaking,
        [
          USDX_ADDRESS,
          C.AE,
          C.Pair,
          C.Staking,
          MARKETING_ADDRESS,
          deployer.address,
          ROUTER_ADDRESS,
        ],
        "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking", net
      );

      verifyContract(
        "FundRelay",
        C.FundRelay,
        [C.AE, USDX_ADDRESS, deployer.address],
        "contracts/AE/src/utils/FundRelay.sol:FundRelay", net
      );

      state.completedStep = 14;
      saveState(state);
      console.log();
    }
  } else {
    console.log("=== BSCScan 验证已完成，跳过 ===\n");
  }

  // =================================================================
  // 完成
  // =================================================================
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║              AE 主网部署完成!                            ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║                                                          ║");
  console.log("║  已部署的合约:                                           ║");
  console.log(`║    AE 代币:           ${C.AE}  ║`);
  console.log(`║    Staking:           ${C.Staking}  ║`);
  console.log(`║    LiquidityStaking:  ${C.LiquidityStaking}  ║`);
  console.log(`║    FundRelay:         ${C.FundRelay}  ║`);
  console.log(`║    AE/USDC Pair:      ${C.Pair}  ║`);
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
  console.log("║  如需全新部署，删除 ae-mainnet-deployment.json 即可      ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n⚠️  部署失败:", error);
    process.exit(1);
  });
