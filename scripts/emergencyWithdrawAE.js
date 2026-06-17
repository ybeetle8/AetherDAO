/**
 * 主网脚本：emergencyWithdrawAE — 从 Staking 合约提取全部 AE Token
 *
 * ⚠️  警告：此操作不可逆！
 *     提取后现有 117 个用户的 unstake 将因 AE 不足而失败。
 *
 * 前置条件：
 *   1. .env 文件中配置 BSC_PRIVATE_KEY（Owner 钱包私钥，不带 0x 前缀）
 *   2. Owner 钱包有足够 BNB 支付 gas（约 0.001 BNB）
 *   3. 先执行测试脚本确认无误：
 *      npx hardhat run scripts/emergencyWithdrawAE-test.js --network localhost
 *
 * 执行命令：
 *   npx hardhat run scripts/emergencyWithdrawAE.js --network bsc
 */

const hre = require("hardhat");

// ===================== 主网合约地址 =====================
const STAKING_ADDRESS = "0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3";
const AE_ADDRESS = "0x01edd7445DF0e9c2064c77Df150BE9FC793C828b";
const USDX_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

// AE 接收地址
const RECEIVER = "0xB138e42B76ad0E6F21E715578F34F2Cf2285eE76";

async function main() {
  // 安全检查：必须在 BSC 主网执行
  if (hre.network.name !== "bsc") {
    console.error("❌ 此脚本仅用于 BSC 主网！当前网络:", hre.network.name);
    console.error("   如需测试，请使用 emergencyWithdrawAE-test.js --network localhost");
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const fmt = (v, d = 18) => Number(hre.ethers.formatUnits(v, d));

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   ⚠️  主网操作: emergencyWithdrawAE                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Step 1: 连接合约
  const stakingABI = [
    "function emergencyWithdrawAE(address to, uint256 _amount) external",
    "function emergencyWithdrawUSDX(address to, uint256 _amount) external",
    "function owner() view returns (address)",
    "function getGlobalStats() view returns (uint256,uint256,uint256,uint256)",
  ];
  const erc20ABI = [
    "function balanceOf(address) view returns (uint256)",
  ];

  const staking = new hre.ethers.Contract(STAKING_ADDRESS, stakingABI, signer);
  const ae = new hre.ethers.Contract(AE_ADDRESS, erc20ABI, hre.ethers.provider);
  const usdx = new hre.ethers.Contract(USDX_ADDRESS, erc20ABI, hre.ethers.provider);

  // Step 2: 验证 Owner 身份
  console.log("=== Step 1: 身份验证 ===\n");
  const contractOwner = await staking.owner();
  console.log("  合约 Owner:    ", contractOwner);
  console.log("  当前钱包:      ", signerAddress);

  if (contractOwner.toLowerCase() !== signerAddress.toLowerCase()) {
    console.error("\n❌ 当前钱包不是合约 Owner，无法执行！");
    console.error("   请检查 .env 中的 BSC_PRIVATE_KEY 是否正确");
    process.exit(1);
  }
  console.log("  身份验证:       ✅ 通过\n");

  // Step 3: 查询当前状态
  console.log("=== Step 2: 当前状态 ===\n");
  const stakingAEBalance = await ae.balanceOf(STAKING_ADDRESS);
  const stakingUSDXBalance = await usdx.balanceOf(STAKING_ADDRESS);
  const receiverAEBefore = await ae.balanceOf(RECEIVER);
  const [tvl, , , stakerCount] = await staking.getGlobalStats();

  console.log("  Staking AE 余额:     ", fmt(stakingAEBalance).toLocaleString(), "AE");
  console.log("  Staking USDC 余额:   ", fmt(stakingUSDXBalance).toLocaleString(), "USDC");
  console.log("  接收地址 AE 余额:    ", fmt(receiverAEBefore).toLocaleString(), "AE");
  console.log("  用户质押本金 (TVL):  ", fmt(tvl).toLocaleString(), "USDC");
  console.log("  当前质押人数:        ", stakerCount.toString(), "人");

  if (stakingAEBalance === 0n) {
    console.log("\n  Staking 合约无 AE 余额，无需操作。");
    process.exit(0);
  }

  // Step 4: 确认信息
  console.log("\n=== Step 3: 操作确认 ===\n");
  console.log("  即将执行:");
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log(`  │ 提取:  ${fmt(stakingAEBalance).toLocaleString().padEnd(41)}│`);
  console.log(`  │ 从:    ${STAKING_ADDRESS}  │`);
  console.log(`  │ 到:    ${RECEIVER}  │`);
  console.log("  └─────────────────────────────────────────────────┘");
  console.log(`\n  ⚠️  提取后 ${stakerCount} 个用户的 unstake 将受影响！\n`);

  // 5 秒等待，给操作者最后的取消机会
  console.log("  5 秒后执行... (Ctrl+C 取消)");
  await new Promise(r => setTimeout(r, 5000));

  // Step 5: 执行 emergencyWithdrawAE
  console.log("\n=== Step 4: 执行提取 ===\n");
  console.log("  [1/2] 提取 AE Token...");

  try {
    const tx = await staking.emergencyWithdrawAE(RECEIVER, stakingAEBalance);
    console.log("  交易已发送:  ", tx.hash);
    console.log("  等待确认...");
    const receipt = await tx.wait();
    console.log("  ✅ AE 提取成功!");
    console.log("  区块号:      ", receipt.blockNumber);
    console.log("  Gas 使用:    ", receipt.gasUsed.toString());
  } catch (err) {
    console.error("  ❌ AE 提取失败:", err.reason || err.message);
    process.exit(1);
  }

  // Step 6: 提取 USDC（如果有）
  if (stakingUSDXBalance > 0n) {
    console.log("\n  [2/2] 提取 USDC...");
    try {
      const tx2 = await staking.emergencyWithdrawUSDX(RECEIVER, stakingUSDXBalance);
      console.log("  交易已发送:  ", tx2.hash);
      const receipt2 = await tx2.wait();
      console.log("  ✅ USDC 提取成功!");
      console.log("  Gas 使用:    ", receipt2.gasUsed.toString());
    } catch (err) {
      console.error("  ❌ USDC 提取失败:", err.reason || err.message);
    }
  } else {
    console.log("\n  [2/2] 无 USDC 余额，跳过");
  }

  // Step 7: 验证结果
  console.log("\n=== Step 5: 验证结果 ===\n");
  const stakingAEAfter = await ae.balanceOf(STAKING_ADDRESS);
  const stakingUSDXAfter = await usdx.balanceOf(STAKING_ADDRESS);
  const receiverAEAfter = await ae.balanceOf(RECEIVER);

  console.log("  Staking AE 余额:    ", fmt(stakingAEAfter).toLocaleString(), "AE");
  console.log("  Staking USDC 余额:  ", fmt(stakingUSDXAfter).toLocaleString(), "USDC");
  console.log("  接收地址 AE 余额:   ", fmt(receiverAEAfter).toLocaleString(), "AE");
  console.log("  本次转出 AE:        ", fmt(receiverAEAfter - receiverAEBefore).toLocaleString(), "AE");

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    操作完成                              ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  AE 已转至: ${RECEIVER}  ║`);
  console.log("║                                                        ║");
  console.log("║  后续步骤:                                              ║");
  console.log("║  1. 在 PancakeSwap 分批卖出 AE 换回 USDC               ║");
  console.log("║  2. 每次卖出不超过池子 USDC 储备的 5%                   ║");
  console.log("║  3. 间隔 1-2 天让套利者恢复池子平衡                     ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("执行失败:", error.message);
    process.exit(1);
  });
