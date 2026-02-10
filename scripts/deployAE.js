const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// 加载配置文件
const configPath = path.join(__dirname, "..", "ae-deployment-config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// BSC 主网地址（从配置文件读取）
const USDC_ADDRESS = config.addresses.usdt;
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

// 代币经济学参数
const TOTAL_SUPPLY = hre.ethers.parseEther(config.tokenomics.totalSupply);
const STAKING_RESERVE = hre.ethers.parseEther(config.tokenomics.stakingReserve);
const INITIAL_LIQUIDITY_AE = hre.ethers.parseEther(config.tokenomics.initialLiquidity.ae);
const INITIAL_LIQUIDITY_USDC = hre.ethers.parseEther(config.tokenomics.initialLiquidity.usdt);
const NODE_REWARD_ALLOCATION = hre.ethers.parseEther(config.tokenomics.nodeRewardAllocation);
const CROSS_CHAIN_RESERVE_ALLOCATION = hre.ethers.parseEther(config.tokenomics.crossChainReserveAllocation);

async function main() {
  console.log("\n=== 开始部署 AE 系统 ===\n");

  // 获取签名者
  const [deployer] = await hre.ethers.getSigners();

  console.log("部署者地址:", deployer.address);
  console.log("部署者余额:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "BNB\n");

  // 获取合约实例
  const usdc = await hre.ethers.getContractAt("IERC20", USDC_ADDRESS);
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);
  const factory = await hre.ethers.getContractAt("IUniswapV2Factory", FACTORY_ADDRESS);

  console.log("=== 步骤 1: 部署质押合约 ===");
  const Staking = await hre.ethers.getContractFactory("contracts/AE-Staking/src/mainnet/Staking.sol:Staking");
  const staking = await Staking.deploy(
    USDC_ADDRESS,
    ROUTER_ADDRESS,
    ROOT_ADDRESS,
    FEE_RECIPIENT
  );
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log("✓ 质押合约已部署:", stakingAddress, "\n");

  console.log("=== 步骤 2: 部署 AE 代币合约 ===");
  const AE = await hre.ethers.getContractFactory("contracts/AE/src/mainnet/AE.sol:AE");
  const ae = await AE.deploy(
    USDC_ADDRESS,
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

  console.log("=== 步骤 5: 创建 AE/USDC 交易对 ===");
  const createPairTx = await factory.createPair(aeAddress, USDC_ADDRESS);
  await createPairTx.wait();
  const pairAddress = await factory.getPair(aeAddress, USDC_ADDRESS);
  console.log("✓ AE/USDC 交易对已创建:", pairAddress, "\n");

  console.log("=== 步骤 6: 配置 AE 代币交易对 ===");
  const setPairTx = await ae.setPair(pairAddress);
  await setPairTx.wait();
  console.log("✓ AE.setPair() 已完成\n");

  console.log("=== 步骤 7: 转移 AE 储备金到质押合约 ===");
  const transferReserveTx = await ae.transfer(stakingAddress, STAKING_RESERVE);
  await transferReserveTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(STAKING_RESERVE), "AE 到质押合约");
  console.log("  质押合约 AE 余额:", hre.ethers.formatEther(await ae.balanceOf(stakingAddress)), "AE\n");

  console.log("=== 步骤 8: 设置 USDC 用于流动性 ===");
  // 使用 hardhat_setStorageAt 为部署者设置 USDC 余额
  // USDC (BSC) 的余额存储槽位为 9
  // 常见槽位为 0, 1, 2, 51（用于代理合约）

  const usdcAmount = INITIAL_LIQUIDITY_USDC;
  const usdcAmountHex = hre.ethers.zeroPadValue(hre.ethers.toBeHex(usdcAmount), 32);

  let deployerUsdcBalance = 0n;
  const slotsToTry = [9, 0, 1, 2, 51]; // USDC 余额映射的存储槽位（9 为主槽位）

  for (const slot of slotsToTry) {
    // 计算 mapping(address => uint256) 的存储槽位
    // 方法 1: 标准 ABI 编码
    const balanceSlot = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [deployer.address, slot]
      )
    );

    await hre.network.provider.send("hardhat_setStorageAt", [
      USDC_ADDRESS,
      balanceSlot,
      usdcAmountHex,
    ]);

    deployerUsdcBalance = await usdc.balanceOf(deployer.address);

    if (deployerUsdcBalance >= INITIAL_LIQUIDITY_USDC) {
      console.log(`✓ 找到正确的存储槽位: ${slot}`);
      console.log(`✓ 设置部署者 USDC 余额: ${hre.ethers.formatEther(deployerUsdcBalance)} USDC`);
      break;
    }
  }

  // 验证余额是否设置正确
  if (deployerUsdcBalance < INITIAL_LIQUIDITY_USDC) {
    throw new Error(`尝试槽位 ${slotsToTry.join(', ')} 后设置 USDC 余额失败。期望: ${hre.ethers.formatEther(INITIAL_LIQUIDITY_USDC)}, 实际: ${hre.ethers.formatEther(deployerUsdcBalance)}`);
  }
  console.log();

  console.log("=== 步骤 9: 授权 Router 用于流动性 ===");
  const approveAETx = await ae.approve(ROUTER_ADDRESS, INITIAL_LIQUIDITY_AE);
  await approveAETx.wait();
  const approveUSDCTx = await usdc.approve(ROUTER_ADDRESS, INITIAL_LIQUIDITY_USDC);
  await approveUSDCTx.wait();
  console.log("✓ 已授权 Router 使用 AE 和 USDC\n");

  console.log("=== 步骤 10: 添加初始流动性 ===");
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 分钟
  const lpRecipient = config.deployment.burnLP ? hre.ethers.ZeroAddress : deployer.address;

  const addLiquidityTx = await router.addLiquidity(
    aeAddress,
    USDC_ADDRESS,
    INITIAL_LIQUIDITY_AE,
    INITIAL_LIQUIDITY_USDC,
    0, // amountAMin
    0, // amountBMin
    lpRecipient, // LP 代币接收者（address(0) 表示销毁）
    deadline
  );
  await addLiquidityTx.wait();

  console.log("✓ 已添加流动性:");
  console.log("  AE:", hre.ethers.formatEther(INITIAL_LIQUIDITY_AE));
  console.log("  USDC:", hre.ethers.formatEther(INITIAL_LIQUIDITY_USDC));
  console.log("  LP 代币发送至:", lpRecipient === hre.ethers.ZeroAddress ? "已销毁 (address(0))" : lpRecipient, "\n");

  console.log("=== 步骤 11: 转移 AE 到节点奖励地址 ===");
  const transferNodeTx = await ae.transfer(NODE_REWARD_ADDRESS, NODE_REWARD_ALLOCATION);
  await transferNodeTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(NODE_REWARD_ALLOCATION), "AE 到节点奖励地址");
  console.log("  节点奖励地址:", NODE_REWARD_ADDRESS);
  console.log("  节点奖励地址 AE 余额:", hre.ethers.formatEther(await ae.balanceOf(NODE_REWARD_ADDRESS)), "AE\n");

  console.log("=== 步骤 12: 转移 AE 到跨链储备地址 ===");
  const transferCrossChainTx = await ae.transfer(CROSS_CHAIN_RESERVE_ADDRESS, CROSS_CHAIN_RESERVE_ALLOCATION);
  await transferCrossChainTx.wait();
  console.log("✓ 已转移", hre.ethers.formatEther(CROSS_CHAIN_RESERVE_ALLOCATION), "AE 到跨链储备地址");
  console.log("  跨链储备地址:", CROSS_CHAIN_RESERVE_ADDRESS);
  console.log("  跨链储备地址 AE 余额:", hre.ethers.formatEther(await ae.balanceOf(CROSS_CHAIN_RESERVE_ADDRESS)), "AE\n");

  console.log("=== 步骤 13: 验证部署 ===");
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
  console.log("║    用途: 待分配 (团队、营销、生态等)                           ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  console.log("║ 2. 质押合约储备金                                              ║");
  console.log(`║    数量: ${hre.ethers.formatEther(stakingAEBalance).padEnd(20)} AE (${stakingPercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${stakingAddress}`.padEnd(65) + "║");
  console.log("║    用途: 用户质押奖励 (循环使用)                               ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");

  console.log("║ 3. 流动性池 (PancakeSwap)                                      ║");
  console.log(`║    数量: ${hre.ethers.formatEther(pairAEBalance).padEnd(20)} AE (${pairPercent}%)`.padEnd(65) + "║");
  console.log(`║    地址: ${pairAddress}`.padEnd(65) + "║");
  console.log(`║    配对: ${hre.ethers.formatEther(INITIAL_LIQUIDITY_USDC)} USDC`.padEnd(65) + "║");
  console.log(`║    价格: 1 AE = ${(Number(hre.ethers.formatEther(INITIAL_LIQUIDITY_USDC)) / Number(hre.ethers.formatEther(INITIAL_LIQUIDITY_AE))).toFixed(4)} USDC`.padEnd(65) + "║");
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
    },
    tokenomics: {
      totalSupply: hre.ethers.formatEther(TOTAL_SUPPLY),
      stakingReserve: hre.ethers.formatEther(STAKING_RESERVE),
      initialLiquidityAE: hre.ethers.formatEther(INITIAL_LIQUIDITY_AE),
      initialLiquidityUSDC: hre.ethers.formatEther(INITIAL_LIQUIDITY_USDC),
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
  console.log("  AE/USDC 交易对:", pairAddress);
  console.log("\n配置地址:");
  console.log("  营销地址:", MARKETING_ADDRESS);
  console.log("  根地址:", ROOT_ADDRESS);
  console.log("  手续费接收者:", FEE_RECIPIENT);
  console.log("  节点奖励地址:", NODE_REWARD_ADDRESS);
  console.log("  跨链储备地址:", CROSS_CHAIN_RESERVE_ADDRESS);
  console.log("\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
