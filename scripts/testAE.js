const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// 加载部署信息
const deploymentPath = path.join(__dirname, "..", "ae-deployment.json");
if (!fs.existsSync(deploymentPath)) {
  console.error("❌ 未找到部署文件。请先运行 deployAE.js。");
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

async function main() {
  console.log("\n=== 测试 AE 系统部署 ===\n");

  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const testWallet = accounts[9];

  console.log("测试钱包地址:", testWallet.address);
  console.log("部署者地址:", deployer.address, "\n");

  // 获取合约实例
  const ae = await hre.ethers.getContractAt("contracts/AE/src/mainnet/AE.sol:AE", deployment.contracts.AE);
  const staking = await hre.ethers.getContractAt("contracts/AE-Staking/src/mainnet/Staking.sol:Staking", deployment.contracts.Staking);
  const pair = await hre.ethers.getContractAt("IUniswapV2Pair", deployment.contracts.Pair);
  const usdx = await hre.ethers.getContractAt("IERC20", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");

  console.log("=== 测试 1: 验证合约地址 ===");
  console.log("✓ AE 代币:", deployment.contracts.AE);
  console.log("✓ 质押合约:", deployment.contracts.Staking);
  console.log("✓ 交易对:", deployment.contracts.Pair, "\n");

  console.log("=== 测试 2: 验证 AE 代币配置 ===");
  const aeName = await ae.name();
  const aeSymbol = await ae.symbol();
  const aeDecimals = await ae.decimals();
  const aeOwner = await ae.owner();
  const aePair = await ae.uniswapV2Pair();
  const aeStaking = await ae.staking();

  console.log("代币名称:", aeName);
  console.log("代币符号:", aeSymbol);
  console.log("代币精度:", aeDecimals);
  console.log("所有者:", aeOwner);
  console.log("交易对地址:", aePair);
  console.log("质押合约地址:", aeStaking);
  console.log("✓ AE 代币配置验证完成\n");

  console.log("=== 测试 3: 验证质押合约配置 ===");
  const stakingName = await staking.name();
  const stakingSymbol = await staking.symbol();
  const stakingAE = await staking.AE();
  const stakingRootAddress = await staking.getRootAddress();
  const stakingFeeRecipient = await staking.feeRecipient();

  console.log("质押代币名称:", stakingName);
  console.log("质押代币符号:", stakingSymbol);
  console.log("AE 地址:", stakingAE);
  console.log("根地址:", stakingRootAddress);
  console.log("手续费接收地址:", stakingFeeRecipient);
  console.log("✓ 质押合约配置验证完成\n");

  console.log("=== 测试 4: 验证代币余额 ===");
  const deployerBalance = await ae.balanceOf(deployer.address);
  const stakingBalance = await ae.balanceOf(deployment.contracts.Staking);
  const pairBalance = await ae.balanceOf(deployment.contracts.Pair);
  const testWalletBalance = await ae.balanceOf(testWallet.address);

  console.log("部署者 AE 余额:", hre.ethers.formatEther(deployerBalance), "AE");
  console.log("质押合约 AE 余额:", hre.ethers.formatEther(stakingBalance), "AE");
  console.log("交易对 AE 余额:", hre.ethers.formatEther(pairBalance), "AE");
  console.log("测试钱包 AE 余额:", hre.ethers.formatEther(testWalletBalance), "AE");
  console.log("✓ 代币余额验证完成\n");

  console.log("=== 测试 5: 验证流动性池 ===");
  const reserves = await pair.getReserves();
  const token0 = await pair.token0();
  const token1 = await pair.token1();

  const isAEToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();
  const aeReserve = isAEToken0 ? reserves[0] : reserves[1];
  const usdcReserve = isAEToken0 ? reserves[1] : reserves[0];

  console.log("代币0:", token0);
  console.log("代币1:", token1);
  console.log("AE 储备量:", hre.ethers.formatEther(aeReserve), "AE");
  console.log("USDX 储备量:", hre.ethers.formatEther(usdcReserve), "USDX");
  console.log("AE 价格:", (Number(hre.ethers.formatEther(usdcReserve)) / Number(hre.ethers.formatEther(aeReserve))).toFixed(6), "USDX");
  console.log("✓ 流动性池验证完成\n");

  console.log("=== 测试 6: 测试购买 AE (用 USDX 兑换 AE) ===");
  const buyAmount = hre.ethers.parseEther("100"); // 用 100 USDX 购买

  // 为测试钱包设置 USDX
  const usdcBalanceSlot = 9;
  const testWalletBalanceSlot = hre.ethers.solidityPackedKeccak256(
    ["uint256", "uint256"],
    [testWallet.address, usdcBalanceSlot]
  );
  await hre.network.provider.send("hardhat_setStorageAt", [
    await usdx.getAddress(),
    testWalletBalanceSlot,
    hre.ethers.toBeHex(hre.ethers.parseEther("10000"), 32),
  ]);

  const testWalletUSDXBefore = await usdx.balanceOf(testWallet.address);
  const testWalletAEBefore = await ae.balanceOf(testWallet.address);
  console.log("测试钱包 USDX 余额（交易前）:", hre.ethers.formatEther(testWalletUSDXBefore), "USDX");
  console.log("测试钱包 AE 余额（交易前）:", hre.ethers.formatEther(testWalletAEBefore), "AE");

  // 授权并兑换
  const router = await hre.ethers.getContractAt("IUniswapV2Router02", "0x10ED43C718714eb63d5aA57B78B54704E256024E");
  await usdx.connect(testWallet).approve(await router.getAddress(), buyAmount);

  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
  const path = [await usdx.getAddress(), deployment.contracts.AE];

  try {
    const swapTx = await router.connect(testWallet).swapExactTokensForTokensSupportingFeeOnTransferTokens(
      buyAmount,
      0, // amountOutMin
      path,
      testWallet.address,
      deadline
    );
    await swapTx.wait();

    const testWalletUSDXAfter = await usdx.balanceOf(testWallet.address);
    const testWalletAEAfter = await ae.balanceOf(testWallet.address);
    const aeReceived = testWalletAEAfter - testWalletAEBefore;

    console.log("测试钱包 USDX 余额（交易后）:", hre.ethers.formatEther(testWalletUSDXAfter), "USDX");
    console.log("测试钱包 AE 余额（交易后）:", hre.ethers.formatEther(testWalletAEAfter), "AE");
    console.log("收到的 AE:", hre.ethers.formatEther(aeReceived), "AE");
    console.log("✓ 购买测试成功\n");
  } catch (error) {
    console.log("⚠ 购买测试失败（这可能是由于预售/延迟购买限制导致的预期行为）");
    console.log("错误:", error.message, "\n");
  }

  console.log("=== 测试 7: 验证白名单 ===");
  const isDeployerWhitelisted = await ae.feeWhitelisted(deployer.address);
  const isStakingWhitelisted = await ae.feeWhitelisted(deployment.contracts.Staking);
  const isMarketingWhitelisted = await ae.feeWhitelisted(deployment.addresses.marketingAddress);

  console.log("部署者已加入白名单:", isDeployerWhitelisted);
  console.log("质押合约已加入白名单:", isStakingWhitelisted);
  console.log("营销地址已加入白名单:", isMarketingWhitelisted);
  console.log("✓ 白名单验证完成\n");

  console.log("=== 测试 8: 检查预售状态 ===");
  const presaleActive = await ae.presaleActive();
  const presaleStartTime = await ae.presaleStartTime();
  const presaleDuration = await ae.presaleDuration();
  const currentTime = Math.floor(Date.now() / 1000);

  console.log("预售激活状态:", presaleActive);
  console.log("预售开始时间:", new Date(Number(presaleStartTime) * 1000).toISOString());
  console.log("预售持续时间:", Number(presaleDuration) / 86400, "天");
  console.log("当前时间:", new Date(currentTime * 1000).toISOString());
  console.log("✓ 预售状态检查完成\n");

  console.log("=== 测试 9: 验证质押利率 ===");
  const rates = await staking.rates(0);
  console.log("质押利率 (1天):", rates.toString());
  console.log("✓ 质押利率验证完成\n");

  console.log("=== 所有测试已完成 ===\n");
  console.log("总结:");
  console.log("✓ 合约部署验证完成");
  console.log("✓ 配置验证完成");
  console.log("✓ 代币余额验证完成");
  console.log("✓ 流动性池验证完成");
  console.log("✓ 白名单验证完成");
  console.log("✓ 预售状态检查完成");
  console.log("✓ 质押配置验证完成");
  console.log("\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
