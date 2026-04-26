const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// =====================================================================
// AE 测试网部署脚本 (BSC Testnet / Chapel)
// 用法: npx hardhat run scripts/deployAETest.js --network bscTestnet
//
// 支持断点续跑：中途失败后重新运行，自动跳过已完成的步骤
// 状态文件: ae-testnet-deployment.json
// 如需全新部署，删除该文件后重新运行
// =====================================================================

// PancakeSwap 测试网地址 (官方)
const ROUTER_ADDRESS = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const FACTORY_ADDRESS = "0x6725F303b657a9451d8BA641348b6761A6CC7a17";

// 代币经济学参数
const STAKING_RESERVE_STR = "20000000";
const INITIAL_LIQUIDITY_AE_STR = "60000000";
const INITIAL_LIQUIDITY_USDX_STR = "60000";
const NODE_REWARD_STR = "18740000";
const CROSS_CHAIN_STR = "1260000";

// 状态文件路径
const STATE_PATH = path.join(__dirname, "..", "ae-testnet-deployment.json");

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

  if (deployerBalance < hre.ethers.parseEther("0.02")) {
    console.error("⚠️  tBNB 余额不足，请从水龙头获取测试币");
    console.error("   https://www.bnbchain.org/en/testnet-faucet");
    process.exit(1);
  }
  console.log();

  // 加载断点状态
  const state = loadState();
  const done = state.completedStep || 0;
  const C = state.contracts; // 已部署合约地址的简写

  // 测试网所有配置地址统一使用部署者地址
  const ALL_ADDR = deployer.address;
  console.log("=== 测试网简化配置 ===");
  console.log("  所有配置地址统一使用部署者地址:", ALL_ADDR);
  console.log("  PancakeSwap Router:", ROUTER_ADDRESS);
  console.log("  PancakeSwap Factory:", FACTORY_ADDRESS);
  console.log();

  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", FACTORY_ADDRESS);
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);

  // =================================================================
  // 步骤 0: 部署 MockUSDC
  // =================================================================
  if (done < 1) {
    console.log("=== 步骤 0: 部署 MockUSDC (测试用配对代币) ===");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const mockUsdcSupply = hre.ethers.parseEther("1000000");
    const mockUsdc = await MockERC20.deploy("Mock USDC", "USDC", mockUsdcSupply);
    await mockUsdc.waitForDeployment();
    C.MockUSDC = await mockUsdc.getAddress();
    state.completedStep = 1;
    saveState(state);
    console.log("✓ MockUSDC 已部署:", C.MockUSDC);
    console.log();
  } else {
    console.log("=== 步骤 0: MockUSDC 已存在，跳过 ===", C.MockUSDC);
    console.log();
  }

  const USDX_ADDRESS = C.MockUSDC;

  // =================================================================
  // 步骤 1: 部署 Staking
  // =================================================================
  if (done < 2) {
    console.log("=== 步骤 1/14: 部署 Staking 合约 ===");
    const Staking = await hre.ethers.getContractFactory("contracts/AE-Staking/src/mainnet/Staking.sol:Staking");
    const staking = await Staking.deploy(USDX_ADDRESS, ROUTER_ADDRESS, ALL_ADDR, ALL_ADDR, ALL_ADDR);
    await staking.waitForDeployment();
    C.Staking = await staking.getAddress();
    state.completedStep = 2;
    saveState(state);
    console.log("✓ Staking 已部署:", C.Staking);
    console.log();
  } else {
    console.log("=== 步骤 1/14: Staking 已存在，跳过 ===", C.Staking);
    console.log();
  }

  // =================================================================
  // 步骤 2: 部署 AE
  // =================================================================
  if (done < 3) {
    console.log("=== 步骤 2/14: 部署 AE 代币合约 ===");
    const AE = await hre.ethers.getContractFactory("contracts/AE/src/mainnet/AE.sol:AE");
    const ae = await AE.deploy(USDX_ADDRESS, ROUTER_ADDRESS, C.Staking, ALL_ADDR, ALL_ADDR, ALL_ADDR, ALL_ADDR, ALL_ADDR);
    await ae.waitForDeployment();
    C.AE = await ae.getAddress();
    state.completedStep = 3;
    saveState(state);
    console.log("✓ AE 已部署:", C.AE);
    console.log();
  } else {
    console.log("=== 步骤 2/14: AE 已存在，跳过 ===", C.AE);
    console.log();
  }

  // 获取 AE 合约实例 (续跑时也需要)
  const ae = await hre.ethers.getContractAt("contracts/AE/src/mainnet/AE.sol:AE", C.AE);

  // =================================================================
  // 步骤 3: 初始化白名单
  // =================================================================
  if (done < 4) {
    console.log("=== 步骤 3/14: 初始化 AE 白名单 ===");
    const tx = await ae.initializeWhitelist();
    await tx.wait();
    state.completedStep = 4;
    saveState(state);
    console.log("✓ 白名单已初始化");
    console.log();
  } else {
    console.log("=== 步骤 3/14: 白名单已初始化，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 4: Staking.setAE()
  // =================================================================
  if (done < 5) {
    console.log("=== 步骤 4/14: Staking.setAE() ===");
    const staking = await hre.ethers.getContractAt("contracts/AE-Staking/src/mainnet/Staking.sol:Staking", C.Staking);
    const tx = await staking.setAE(C.AE);
    await tx.wait();
    state.completedStep = 5;
    saveState(state);
    console.log("✓ Staking 已关联 AE");
    console.log();
  } else {
    console.log("=== 步骤 4/14: Staking.setAE() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 5: 创建交易对
  // =================================================================
  if (done < 6) {
    console.log("=== 步骤 5/14: 创建 AE/USDC 交易对 ===");
    const tx = await factory.createPair(C.AE, USDX_ADDRESS);
    await tx.wait();
    C.Pair = await factory.getPair(C.AE, USDX_ADDRESS);
    state.completedStep = 6;
    saveState(state);
    console.log("✓ 交易对已创建:", C.Pair);
    console.log();
  } else {
    console.log("=== 步骤 5/14: 交易对已存在，跳过 ===", C.Pair);
    console.log();
  }

  // =================================================================
  // 步骤 6: AE.setPair()
  // =================================================================
  if (done < 7) {
    console.log("=== 步骤 6/14: AE.setPair() ===");
    const tx = await ae.setPair(C.Pair);
    await tx.wait();
    state.completedStep = 7;
    saveState(state);
    console.log("✓ 交易对已设置");
    console.log();
  } else {
    console.log("=== 步骤 6/14: AE.setPair() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 7: 转移质押储备金
  // =================================================================
  if (done < 8) {
    console.log("=== 步骤 7/14: 转移质押储备金 ===");
    const tx = await ae.transfer(C.Staking, hre.ethers.parseEther(STAKING_RESERVE_STR));
    await tx.wait();
    state.completedStep = 8;
    saveState(state);
    console.log("✓ 已转移", STAKING_RESERVE_STR, "AE → Staking");
    console.log();
  } else {
    console.log("=== 步骤 7/14: 质押储备金已转移，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 8: 部署 LiquidityStaking
  // =================================================================
  if (done < 9) {
    console.log("=== 步骤 8/14: 部署 LiquidityStaking ===");
    const LS = await hre.ethers.getContractFactory("contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking");
    const ls = await LS.deploy(USDX_ADDRESS, C.AE, C.Pair, C.Staking, ALL_ADDR, deployer.address, ROUTER_ADDRESS);
    await ls.waitForDeployment();
    C.LiquidityStaking = await ls.getAddress();
    state.completedStep = 9;
    saveState(state);
    console.log("✓ LiquidityStaking 已部署:", C.LiquidityStaking);
    console.log();
  } else {
    console.log("=== 步骤 8/14: LiquidityStaking 已存在，跳过 ===", C.LiquidityStaking);
    console.log();
  }

  // =================================================================
  // 步骤 9: AE.setLiquidityStaking()
  // =================================================================
  if (done < 10) {
    console.log("=== 步骤 9/14: AE.setLiquidityStaking() ===");
    const tx = await ae.setLiquidityStaking(C.LiquidityStaking);
    await tx.wait();
    state.completedStep = 10;
    saveState(state);
    console.log("✓ LiquidityStaking 已加入白名单");
    console.log();
  } else {
    console.log("=== 步骤 9/14: setLiquidityStaking() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 10: 部署 FundRelay
  // =================================================================
  if (done < 11) {
    console.log("=== 步骤 10/14: 部署 FundRelay ===");
    const FR = await hre.ethers.getContractFactory("contracts/AE/src/utils/FundRelay.sol:FundRelay");
    const fr = await FR.deploy(C.AE, USDX_ADDRESS, deployer.address);
    await fr.waitForDeployment();
    C.FundRelay = await fr.getAddress();
    state.completedStep = 11;
    saveState(state);
    console.log("✓ FundRelay 已部署:", C.FundRelay);
    console.log();
  } else {
    console.log("=== 步骤 10/14: FundRelay 已存在，跳过 ===", C.FundRelay);
    console.log();
  }

  // =================================================================
  // 步骤 11: AE.setFundRelay()
  // =================================================================
  if (done < 12) {
    console.log("=== 步骤 11/14: AE.setFundRelay() ===");
    const tx = await ae.setFundRelay(C.FundRelay);
    await tx.wait();
    state.completedStep = 12;
    saveState(state);
    console.log("✓ FundRelay 已加入白名单");
    console.log();
  } else {
    console.log("=== 步骤 11/14: setFundRelay() 已完成，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 12: 转移节点奖励 (测试网转到自己)
  // =================================================================
  if (done < 13) {
    console.log("=== 步骤 12/14: 转移节点奖励 ===");
    const tx = await ae.transfer(ALL_ADDR, hre.ethers.parseEther(NODE_REWARD_STR));
    await tx.wait();
    state.completedStep = 13;
    saveState(state);
    console.log("✓ 节点奖励:", NODE_REWARD_STR, "AE (转到部署者自身)");
    console.log();
  } else {
    console.log("=== 步骤 12/14: 节点奖励已转移，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 13: 转移跨链储备 (测试网转到自己)
  // =================================================================
  if (done < 14) {
    console.log("=== 步骤 13/14: 转移跨链储备 ===");
    const tx = await ae.transfer(ALL_ADDR, hre.ethers.parseEther(CROSS_CHAIN_STR));
    await tx.wait();
    state.completedStep = 14;
    saveState(state);
    console.log("✓ 跨链储备:", CROSS_CHAIN_STR, "AE (转到部署者自身)");
    console.log();
  } else {
    console.log("=== 步骤 13/14: 跨链储备已转移，跳过 ===");
    console.log();
  }

  // =================================================================
  // 步骤 14: 添加流动性 + 开放交易
  // =================================================================
  if (done < 15) {
    console.log("=== 步骤 14/14: 添加流动性 & 开放交易 ===");

    const LIQUIDITY_AE = hre.ethers.parseEther(INITIAL_LIQUIDITY_AE_STR);
    const LIQUIDITY_USDX = hre.ethers.parseEther(INITIAL_LIQUIDITY_USDX_STR);

    // Approve
    const mockUsdc = await hre.ethers.getContractAt("IERC20", USDX_ADDRESS);
    const approveAETx = await ae.approve(ROUTER_ADDRESS, LIQUIDITY_AE);
    await approveAETx.wait();
    const approveUSDXTx = await mockUsdc.approve(ROUTER_ADDRESS, LIQUIDITY_USDX);
    await approveUSDXTx.wait();
    console.log("✓ 已授权 Router");

    // Add Liquidity
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const addLiqTx = await router.addLiquidity(
      C.AE, USDX_ADDRESS,
      LIQUIDITY_AE, LIQUIDITY_USDX,
      0n, 0n,
      deployer.address,
      deadline
    );
    await addLiqTx.wait();
    console.log("✓ 已添加流动性:", INITIAL_LIQUIDITY_AE_STR, "AE +", INITIAL_LIQUIDITY_USDX_STR, "USDC");

    // 关闭预售
    const setPresaleTx = await ae.setPresaleActive(false);
    await setPresaleTx.wait();
    console.log("✓ 预售已关闭，交易已开放");

    state.completedStep = 15;
    saveState(state);
    console.log();
  } else {
    console.log("=== 步骤 14/14: 流动性已添加，跳过 ===");
    console.log();
  }

  // =================================================================
  // 验证部署结果
  // =================================================================
  console.log("=== 部署结果 ===\n");

  const deployerAE = await ae.balanceOf(deployer.address);
  const stakingAE = await ae.balanceOf(C.Staking);
  const pairAE = await ae.balanceOf(C.Pair);

  console.log("  部署者 AE 余额:", hre.ethers.formatEther(deployerAE));
  console.log("  Staking AE 余额:", hre.ethers.formatEther(stakingAE));
  console.log("  流动性池 AE:    ", hre.ethers.formatEther(pairAE));
  console.log();

  // 更新最终状态
  state.network = "bscTestnet";
  state.chainId = 97;
  state.deployer = deployer.address;
  state.pancakeSwap = { router: ROUTER_ADDRESS, factory: FACTORY_ADDRESS };
  saveState(state);
  console.log("✓ 部署信息已保存至:", STATE_PATH);
  console.log();

  // =================================================================
  // BSCScan Testnet 合约验证
  // =================================================================
  if (done < 16) {
    console.log("=== BSCScan Testnet 合约验证 ===\n");

    if (!process.env.BSCSCAN_API_KEY) {
      console.log("⚠️  未配置 BSCSCAN_API_KEY，跳过验证。\n");
    } else {
      console.log("等待区块确认...\n");

      const mockUsdcSupply = hre.ethers.parseEther("1000000");

      await verifyContract("MockUSDC", C.MockUSDC,
        ["Mock USDC", "USDC", mockUsdcSupply.toString()],
        "contracts/test/MockERC20.sol:MockERC20"
      );

      await verifyContract("Staking", C.Staking,
        [USDX_ADDRESS, ROUTER_ADDRESS, ALL_ADDR, ALL_ADDR, ALL_ADDR],
        "contracts/AE-Staking/src/mainnet/Staking.sol:Staking"
      );

      await verifyContract("AE", C.AE,
        [USDX_ADDRESS, ROUTER_ADDRESS, C.Staking, ALL_ADDR, ALL_ADDR, ALL_ADDR, ALL_ADDR, ALL_ADDR],
        "contracts/AE/src/mainnet/AE.sol:AE"
      );

      await verifyContract("LiquidityStaking", C.LiquidityStaking,
        [USDX_ADDRESS, C.AE, C.Pair, C.Staking, ALL_ADDR, deployer.address, ROUTER_ADDRESS],
        "contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking"
      );

      await verifyContract("FundRelay", C.FundRelay,
        [C.AE, USDX_ADDRESS, deployer.address],
        "contracts/AE/src/utils/FundRelay.sol:FundRelay"
      );

      state.completedStep = 16;
      saveState(state);
      console.log();
    }
  } else {
    console.log("=== BSCScan 验证已完成，跳过 ===\n");
  }

  // =================================================================
  // 完成
  // =================================================================
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║          AE 测试网部署完成!                          ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  MockUSDC:          ${C.MockUSDC}  ║`);
  console.log(`║  AE:                ${C.AE}  ║`);
  console.log(`║  Staking:           ${C.Staking}  ║`);
  console.log(`║  LiquidityStaking:  ${C.LiquidityStaking}  ║`);
  console.log(`║  FundRelay:         ${C.FundRelay}  ║`);
  console.log(`║  Pair:              ${C.Pair}  ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  流动性已添加，交易已开放，可直接测试买卖             ║");
  console.log("║                                                      ║");
  console.log("║  如需全新部署，删除 ae-testnet-deployment.json 即可  ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n⚠️  部署失败:", error);
    process.exit(1);
  });
