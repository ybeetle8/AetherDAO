const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// 加载配置文件
const configPath = path.join(__dirname, "..", "ae-deployment-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// BSC 主网地址（从配置文件读取）
const USDX_ADDRESS = config.addresses.usdx;
const ROUTER_ADDRESS = config.addresses.pancakeRouter;
const FACTORY_ADDRESS = config.addresses.pancakeFactory;

// 配置地址
const MARKETING_ADDRESS = config.addresses.marketingAddress;
const ROOT_ADDRESS = config.addresses.rootAddress;
const FEE_RECIPIENT = config.addresses.feeRecipient;
const BUY_TAX_NODE_REWARD_ADDRESS = config.addresses.buyTaxNodeRewardAddress;
const BUY_TAX_COMMUNITY_REWARD_ADDRESS = config.addresses.buyTaxCommunityRewardAddress;
const MARKETING_FUND_ADDRESS = config.addresses.marketingFundAddress;
const WEEKLY_TOP15_REWARD_ADDRESS = config.addresses.weeklyTop15RewardAddress;
const NODE_REWARD_ADDRESS = config.addresses.buyTaxNodeRewardAddress; // 使用买入税节点奖励地址作为节点奖励分配地址
const CROSS_CHAIN_RESERVE_ADDRESS = config.addresses.crossChainReserveAddress;
const EDUCATION_FUND_ADDRESS = config.addresses.educationFundAddress;

// 代币经济学参数
const TOTAL_SUPPLY = hre.ethers.parseEther(config.tokenomics.totalSupply);
const STAKING_RESERVE = hre.ethers.parseEther(config.tokenomics.stakingReserve);
const INITIAL_LIQUIDITY_AE = hre.ethers.parseEther(config.tokenomics.initialLiquidity.ae);
const INITIAL_LIQUIDITY_USDX = hre.ethers.parseEther(config.tokenomics.initialLiquidity.usdx);
const NODE_REWARD_ALLOCATION = hre.ethers.parseEther(config.tokenomics.nodeRewardAllocation);
const CROSS_CHAIN_RESERVE_ALLOCATION = hre.ethers.parseEther(config.tokenomics.crossChainReserveAllocation);

async function main() {
  console.log("\n=== 开始部署 AE 系统 ===\n");

  // 获取签名者
  const [deployer] = await hre.ethers.getSigners();

  console.log("部署者地址:", deployer.address);
  console.log("部署者余额:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "BNB\n");

  // 获取合约实例
  const usdx = await hre.ethers.getContractAt("IERC20", USDX_ADDRESS);
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);
  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", FACTORY_ADDRESS);

  console.log("=== 步骤 1: 部署质押合约 ===");
  const Staking = await hre.ethers.getContractFactory("contracts/AE-Staking/src/mainnet/Staking.sol:Staking");
  const staking = await Staking.deploy(
    USDX_ADDRESS,
    ROUTER_ADDRESS,
    ROOT_ADDRESS,
    FEE_RECIPIENT,
    EDUCATION_FUND_ADDRESS
  );
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log("✓ 质押合约已部署:", stakingAddress, "\n");

  console.log("=== 步骤 2: 部署 AE 代币合约 ===");
  const AE = await hre.ethers.getContractFactory("contracts/AE/src/mainnet/AE.sol:AE");
  const ae = await AE.deploy(
    USDX_ADDRESS,
    ROUTER_ADDRESS,
    stakingAddress,
    MARKETING_ADDRESS,
    BUY_TAX_NODE_REWARD_ADDRESS,
    BUY_TAX_COMMUNITY_REWARD_ADDRESS,
    MARKETING_FUND_ADDRESS,
    WEEKLY_TOP15_REWARD_ADDRESS
  );
  await ae.waitForDeployment();
  const aeAddress = await ae.getAddress();
  console.log("✓ AE 代币已部署:", aeAddress);
  console.log("✓ 初始供应量已铸造:", hre.ethers.formatEther(await ae.balanceOf(deployer.address)), "AE\n");

  console.log("=== 步骤 3: 初始化 AE 白名单 ===");
  const initWhitelistTx = await ae.initializeWhitelist();
  await initWhitelistTx.wait();
  console.log("✓ 白名单已初始化\n");

  console.log("=== 步骤 4: 配置质押合约 ===");
  const setAETx = await staking.setAE(aeAddress);
  await setAETx.wait();
  console.log("✓ Staking.setAE() 已完成\n");

  console.log("=== 步骤 5: 创建 AE/USDX 交易对 ===");
  const createPairTx = await factory.createPair(aeAddress, USDX_ADDRESS);
  await createPairTx.wait();
  const pairAddress = await factory.getPair(aeAddress, USDX_ADDRESS);
  console.log("✓ AE/USDX 交易对已创建:", pairAddress, "\n");

  console.log("=== 步骤 6: 配置 AE 代币交易对 ===");
  const setPairTx = await ae.setPair(pairAddress);
  await setPairTx.wait();
  console.log("✓ AE.setPair() 已完成\n");

  console.log("=== 步骤 7: 转移 AE 储备金到质押合约 ===");
  const transferReserveTx = await ae.transfer(stakingAddress, STAKING_RESERVE);
  await transferReserveTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(STAKING_RESERVE), "AE 到质押合约");
  console.log("  质押合约 AE 余额:", hre.ethers.formatEther(await ae.balanceOf(stakingAddress)), "AE\n");

  console.log("=== 步骤 8: 设置 USDX 用于流动性 ===");

  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    // 本地测试网络: 使用 hardhat_setStorageAt 为部署者设置 USDX 余额
    // USDX (BSC) 的余额存储槽位为 9
    // 常见槽位为 0, 1, 2, 51（用于代理合约）

    const usdcAmount = INITIAL_LIQUIDITY_USDX;
    const usdcAmountHex = hre.ethers.zeroPadValue(hre.ethers.toBeHex(usdcAmount), 32);

    let deployerUsdcBalance = 0n;
    const slotsToTry = [9, 0, 1, 2, 51]; // USDX 余额映射的存储槽位（9 为主槽位）

    for (const slot of slotsToTry) {
      const balanceSlot = hre.ethers.keccak256(
        hre.ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256"],
          [deployer.address, slot]
        )
      );

      await hre.network.provider.send("hardhat_setStorageAt", [
        USDX_ADDRESS,
        balanceSlot,
        usdcAmountHex,
      ]);

      deployerUsdcBalance = await usdx.balanceOf(deployer.address);

      if (deployerUsdcBalance >= INITIAL_LIQUIDITY_USDX) {
        console.log(`✓ 找到正确的存储槽位: ${slot}`);
        console.log(`✓ 设置部署者 USDX 余额: ${hre.ethers.formatEther(deployerUsdcBalance)} USDX`);
        break;
      }
    }

    if (deployerUsdcBalance < INITIAL_LIQUIDITY_USDX) {
      throw new Error(`尝试槽位 ${slotsToTry.join(', ')} 后设置 USDX 余额失败。期望: ${hre.ethers.formatEther(INITIAL_LIQUIDITY_USDX)}, 实际: ${hre.ethers.formatEther(deployerUsdcBalance)}`);
    }
  } else {
    // 主网: 检查 deployer 已有余额是否足够
    const balance = await usdx.balanceOf(deployer.address);
    if (balance < INITIAL_LIQUIDITY_USDX) {
      throw new Error(`USDX 余额不足: ${hre.ethers.formatEther(balance)}, 需要: ${hre.ethers.formatEther(INITIAL_LIQUIDITY_USDX)}`);
    }
    console.log(`✓ 部署者 USDX 余额充足: ${hre.ethers.formatEther(balance)} USDX`);
  }
  console.log();

  console.log("=== 步骤 9: 授权 Router 用于流动性 ===");
  const approveAETx = await ae.approve(ROUTER_ADDRESS, INITIAL_LIQUIDITY_AE);
  await approveAETx.wait();
  const approveUSDXTx = await usdx.approve(ROUTER_ADDRESS, INITIAL_LIQUIDITY_USDX);
  await approveUSDXTx.wait();
  console.log("✓ 已授权 Router 使用 AE 和 USDX\n");

  console.log("=== 步骤 10: 添加初始流动性 ===");
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 分钟
  const lpRecipient = config.deployment.burnLP ? hre.ethers.ZeroAddress : deployer.address;

  // 主网设置 1% 滑点保护，本地测试网络无需滑点保护
  const isLocalNetwork = hre.network.name === "localhost" || hre.network.name === "hardhat";
  const slippage = 99n; // 1% 滑点容忍
  const amountAMin = isLocalNetwork ? 0n : INITIAL_LIQUIDITY_AE * slippage / 100n;
  const amountBMin = isLocalNetwork ? 0n : INITIAL_LIQUIDITY_USDX * slippage / 100n;

  const addLiquidityTx = await router.addLiquidity(
    aeAddress,
    USDX_ADDRESS,
    INITIAL_LIQUIDITY_AE,
    INITIAL_LIQUIDITY_USDX,
    amountAMin,
    amountBMin,
    lpRecipient, // LP 代币接收者（address(0) 表示销毁）
    deadline
  );
  await addLiquidityTx.wait();

  console.log("✓ 已添加流动性:");
  console.log("  AE:", hre.ethers.formatEther(INITIAL_LIQUIDITY_AE));
  console.log("  USDX:", hre.ethers.formatEther(INITIAL_LIQUIDITY_USDX));
  console.log("  LP 代币发送至:", lpRecipient === hre.ethers.ZeroAddress ? "已销毁 (address(0))" : lpRecipient, "\n");

  console.log("=== 步骤 11: 部署 LiquidityStaking 合约 ===");
  const LiquidityStaking = await hre.ethers.getContractFactory("contracts/LiquidityStaking/src/mainnet/LiquidityStaking.sol:LiquidityStaking");
  const liquidityStaking = await LiquidityStaking.deploy(
    USDX_ADDRESS,           // _usdt
    aeAddress,              // _olaContract (AE 代币)
    pairAddress,            // _lpToken (AE/USDX LP)
    stakingAddress,         // _staking
    MARKETING_ADDRESS,      // _marketingAddress
    deployer.address,       // _admin
    ROUTER_ADDRESS          // _router
  );
  await liquidityStaking.waitForDeployment();
  const liquidityStakingAddress = await liquidityStaking.getAddress();
  console.log("✓ LiquidityStaking 合约已部署:", liquidityStakingAddress, "\n");

  console.log("=== 步骤 12: 配置 AE 合约的 LiquidityStaking 地址 ===");
  const setLiquidityStakingTx = await ae.setLiquidityStaking(liquidityStakingAddress);
  await setLiquidityStakingTx.wait();
  console.log("✓ AE.setLiquidityStaking() 已完成");
  console.log("  LiquidityStaking 已加入手续费白名单\n");

  console.log("=== 步骤 13: 转移 AE 到节点奖励地址 ===");
  const transferNodeTx = await ae.transfer(NODE_REWARD_ADDRESS, NODE_REWARD_ALLOCATION);
  await transferNodeTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(NODE_REWARD_ALLOCATION), "AE 到节点奖励地址");
  console.log("  节点奖励地址:", NODE_REWARD_ADDRESS);
  console.log("  节点奖励地址 AE 余额:", hre.ethers.formatEther(await ae.balanceOf(NODE_REWARD_ADDRESS)), "AE\n");

  console.log("=== 步骤 14: 转移 AE 到跨链储备地址 ===");
  const transferCrossChainTx = await ae.transfer(CROSS_CHAIN_RESERVE_ADDRESS, CROSS_CHAIN_RESERVE_ALLOCATION);
  await transferCrossChainTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(CROSS_CHAIN_RESERVE_ALLOCATION), "AE 到跨链储备地址");
  console.log("  跨链储备地址:", CROSS_CHAIN_RESERVE_ADDRESS);
  console.log("  跨链储备地址 AE 余额:", hre.ethers.formatEther(await ae.balanceOf(CROSS_CHAIN_RESERVE_ADDRESS)), "AE\n");

  console.log("=== 步骤 15: 验证部署 ===");
  const deployerAEBalance = await ae.balanceOf(deployer.address);
  const stakingAEBalance = await ae.balanceOf(stakingAddress);
  const pairAEBalance = await ae.balanceOf(pairAddress);
  const nodeRewardAEBalance = await ae.balanceOf(NODE_REWARD_ADDRESS);
  const crossChainReserveAEBalance = await ae.balanceOf(CROSS_CHAIN_RESERVE_ADDRESS);

  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║                    AE 代币分配详情                              ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log("║ 总供应量: 100,000,000 AE                                       ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  const totalSupplyFormatted = hre.ethers.formatEther(TOTAL_SUPPLY);
  const deployerPercent = (Number(hre.ethers.formatEther(deployerAEBalance)) / Number(totalSupplyFormatted) * 100).toFixed(2);
  const stakingPercent = (Number(hre.ethers.formatEther(stakingAEBalance)) / Number(totalSupplyFormatted) * 100).toFixed(2);
  const pairPercent = (Number(hre.ethers.formatEther(pairAEBalance)) / Number(totalSupplyFormatted) * 100).toFixed(2);
  const nodePercent = (Number(hre.ethers.formatEther(nodeRewardAEBalance)) / Number(totalSupplyFormatted) * 100).toFixed(2);
  const crossChainPercent = (Number(hre.ethers.formatEther(crossChainReserveAEBalance)) / Number(totalSupplyFormatted) * 100).toFixed(2);

  console.log("║ 1. 部署者 (剩余)                                               ║");
  console.log(`║    数量: ${hre.ethers.formatEther(deployerAEBalance).padEnd(20)} AE (${deployerPercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${deployer.address}`.padEnd(65) + "║");
  console.log("║    用途: 全部已分配完毕，无剩余                               ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  console.log("║ 2. 质押合约储备金                                              ║");
  console.log(`║    数量: ${hre.ethers.formatEther(stakingAEBalance).padEnd(20)} AE (${stakingPercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${stakingAddress}`.padEnd(65) + "║");
  console.log("║    用途: 用户质押奖励 (循环使用)                               ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  console.log("║ 3. 流动性池 (PancakeSwap)                                      ║");
  console.log(`║    数量: ${hre.ethers.formatEther(pairAEBalance).padEnd(20)} AE (${pairPercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${pairAddress}`.padEnd(65) + "║");
  console.log(`║    配对: ${hre.ethers.formatEther(INITIAL_LIQUIDITY_USDX)} USDX`.padEnd(65) + "║");
  console.log(`║    价格: 1 AE = ${(Number(hre.ethers.formatEther(INITIAL_LIQUIDITY_USDX)) / Number(hre.ethers.formatEther(INITIAL_LIQUIDITY_AE))).toFixed(4)} USDX`.padEnd(65) + "║");
  console.log("║    LP代币: 已永久销毁                                          ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  console.log("║ 4. 节点奖励                                                    ║");
  console.log(`║    数量: ${hre.ethers.formatEther(nodeRewardAEBalance).padEnd(20)} AE (${nodePercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${NODE_REWARD_ADDRESS}`.padEnd(65) + "║");
  console.log("║    用途: 节点运营奖励                                          ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  console.log("║ 5. 跨链储备                                                    ║");
  console.log(`║    数量: ${hre.ethers.formatEther(crossChainReserveAEBalance).padEnd(20)} AE (${crossChainPercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${CROSS_CHAIN_RESERVE_ADDRESS}`.padEnd(65) + "║");
  console.log("║    用途: 跨链桥储备金                                          ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  const totalDistributed = deployerAEBalance + stakingAEBalance + pairAEBalance + nodeRewardAEBalance + crossChainReserveAEBalance;
  console.log(`║ 总计: ${hre.ethers.formatEther(totalDistributed).padEnd(20)} AE (100%)`.padEnd(65) + "║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // 保存部署信息
  const deploymentInfo = {
    network: config.network,
    timestamp: new Date().toISOString(),
    contracts: {
      AE: aeAddress,
      Staking: stakingAddress,
      LiquidityStaking: liquidityStakingAddress,
      Pair: pairAddress,
    },
    addresses: {
      deployer: deployer.address,
      marketingAddress: MARKETING_ADDRESS,
      rootAddress: ROOT_ADDRESS,
      feeRecipient: FEE_RECIPIENT,
      buyTaxNodeRewardAddress: BUY_TAX_NODE_REWARD_ADDRESS,
      buyTaxCommunityRewardAddress: BUY_TAX_COMMUNITY_REWARD_ADDRESS,
      marketingFundAddress: MARKETING_FUND_ADDRESS,
      weeklyTop15RewardAddress: WEEKLY_TOP15_REWARD_ADDRESS,
      crossChainReserveAddress: CROSS_CHAIN_RESERVE_ADDRESS,
      educationFundAddress: EDUCATION_FUND_ADDRESS,
      nodeRewardAddress: NODE_REWARD_ADDRESS,
    },
    tokenomics: {
      totalSupply: hre.ethers.formatEther(TOTAL_SUPPLY),
      stakingReserve: hre.ethers.formatEther(STAKING_RESERVE),
      initialLiquidityAE: hre.ethers.formatEther(INITIAL_LIQUIDITY_AE),
      initialLiquidityUSDX: hre.ethers.formatEther(INITIAL_LIQUIDITY_USDX),
      nodeRewardAllocation: hre.ethers.formatEther(NODE_REWARD_ALLOCATION),
      crossChainReserveAllocation: hre.ethers.formatEther(CROSS_CHAIN_RESERVE_ALLOCATION),
    },
    balances: {
      deployer: hre.ethers.formatEther(deployerAEBalance),
      staking: hre.ethers.formatEther(stakingAEBalance),
      liquidityPool: hre.ethers.formatEther(pairAEBalance),
      nodeReward: hre.ethers.formatEther(nodeRewardAEBalance),
      crossChainReserve: hre.ethers.formatEther(crossChainReserveAEBalance),
    }
  };

  const outputPath = path.join(__dirname, "..", "ae-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ 部署信息已保存至:", outputPath, "\n");

  console.log("=== AE 系统部署成功完成! ===\n");
  console.log("合约地址:");
  console.log("  AE 代币:", aeAddress);
  console.log("  质押合约:", stakingAddress);
  console.log("  流动性质押合约:", liquidityStakingAddress);
  console.log("  AE/USDX 交易对:", pairAddress);
  console.log("\n配置地址:");
  console.log("  营销地址:", MARKETING_ADDRESS);
  console.log("  根地址:", ROOT_ADDRESS);
  console.log("  手续费接收者:", FEE_RECIPIENT);
  console.log("  节点奖励地址:", NODE_REWARD_ADDRESS);
  console.log("  跨链储备地址:", CROSS_CHAIN_RESERVE_ADDRESS);
  // Presale 状态提醒
  const presaleStatus = await ae.getPresaleStatus();
  if (presaleStatus.isInPresale) {
    console.log("⚠️  presale 当前处于激活状态，买入交易将被阻止");
    console.log("  剩余时间:", presaleStatus.remainingTime.toString(), "秒");
    console.log("  如需立即开放交易，请执行: ae.setPresaleActive(false)");
  }

  console.log("\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
