/**
 * 测试脚本：模拟 emergencyWithdrawAE 操作
 * 在本地 fork BSC 主网最新区块环境中测试，不会影响主网
 *
 * 执行命令（无需启动额外节点）：
 *   npx hardhat run scripts/emergencyWithdrawAE-test.js
 *
 * 注意：hardhat.config.js 中 fork 的 blockNumber 太旧（64340000），
 *       合约在那之后才部署，所以本脚本自行 fork 最新区块。
 */

const hre = require("hardhat");

// ===================== 主网合约地址 =====================
const STAKING_ADDRESS = "0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3";
const AE_ADDRESS = "0x01edd7445DF0e9c2064c77Df150BE9FC793C828b";
const USDX_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

// 主网 Staking 合约的 Owner（部署者）
const OWNER_ADDRESS = "0xB138e42B76ad0E6F21E715578F34F2Cf2285eE76";

// AE 接收地址
const RECEIVER = "0xB138e42B76ad0E6F21E715578F34F2Cf2285eE76";

const BSC_RPC = "https://bsc.rpc.pinax.network/v1/311e9e281c8e2995ddf582f2bb074d0f132a8e6fd87eb785/";

async function main() {
  const provider = hre.ethers.provider;
  const fmt = (v, d = 18) => Number(hre.ethers.formatUnits(v, d));

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   测试: emergencyWithdrawAE（本地 fork，不影响主网）    ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Step 1: 重置 fork 到最新区块（绕过 hardhat.config.js 中的旧 blockNumber）
  console.log("=== Step 1: Fork BSC 最新区块 ===\n");
  await provider.send("hardhat_reset", [{
    forking: {
      jsonRpcUrl: BSC_RPC,
    }
  }]);
  const blockNum = await provider.getBlockNumber();
  console.log("  已 fork 到最新区块:", blockNum);

  // Step 2: 模拟 Owner 身份
  console.log("\n=== Step 2: 模拟 Owner 身份 ===\n");
  await provider.send("hardhat_impersonateAccount", [OWNER_ADDRESS]);

  // 给 Owner 一些 BNB 用于 gas
  const [funder] = await hre.ethers.getSigners();
  await funder.sendTransaction({
    to: OWNER_ADDRESS,
    value: hre.ethers.parseEther("1"),
  });
  console.log("  已给 Owner 转入 1 BNB 作为 gas");

  const ownerSigner = await hre.ethers.getSigner(OWNER_ADDRESS);

  // Step 3: 连接合约
  console.log("\n=== Step 3: 连接合约 ===\n");

  const stakingABI = [
    "function emergencyWithdrawAE(address to, uint256 _amount) external",
    "function emergencyWithdrawUSDX(address to, uint256 _amount) external",
    "function owner() view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function getGlobalStats() view returns (uint256,uint256,uint256,uint256)",
  ];
  const erc20ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)",
  ];

  const staking = new hre.ethers.Contract(STAKING_ADDRESS, stakingABI, ownerSigner);
  const ae = new hre.ethers.Contract(AE_ADDRESS, erc20ABI, provider);
  const usdx = new hre.ethers.Contract(USDX_ADDRESS, erc20ABI, provider);

  // 验证 Owner
  const contractOwner = await staking.owner();
  console.log("  合约 Owner:  ", contractOwner);
  console.log("  当前操作者:  ", OWNER_ADDRESS);
  console.log("  身份匹配:    ", contractOwner.toLowerCase() === OWNER_ADDRESS.toLowerCase() ? "✅ 是" : "❌ 否");

  if (contractOwner.toLowerCase() !== OWNER_ADDRESS.toLowerCase()) {
    console.error("\n❌ Owner 地址不匹配，无法执行 emergencyWithdraw！");
    console.error("   合约实际 Owner:", contractOwner);
    process.exit(1);
  }

  // Step 4: 查询提取前余额
  console.log("\n=== Step 4: 提取前状态 ===\n");

  const stakingAEBefore = await ae.balanceOf(STAKING_ADDRESS);
  const stakingUSDXBefore = await usdx.balanceOf(STAKING_ADDRESS);
  const receiverAEBefore = await ae.balanceOf(RECEIVER);
  const [tvl, , , stakerCount] = await staking.getGlobalStats();

  console.log("  Staking 合约 AE 余额:    ", fmt(stakingAEBefore).toLocaleString(), "AE");
  console.log("  Staking 合约 USDC 余额:  ", fmt(stakingUSDXBefore).toLocaleString(), "USDC");
  console.log("  接收地址 AE 余额:        ", fmt(receiverAEBefore).toLocaleString(), "AE");
  console.log("  当前 TVL（用户质押本金）: ", fmt(tvl).toLocaleString(), "USDC");
  console.log("  当前质押人数:             ", stakerCount.toString(), "人");

  // Step 5: 执行 emergencyWithdrawAE — 提取全部 AE
  console.log("\n=== Step 5: 执行 emergencyWithdrawAE ===\n");

  const withdrawAmount = stakingAEBefore;
  console.log("  提取数量:  ", fmt(withdrawAmount).toLocaleString(), "AE");
  console.log("  接收地址:  ", RECEIVER);

  try {
    const tx = await staking.emergencyWithdrawAE(RECEIVER, withdrawAmount);
    console.log("  交易哈希:  ", tx.hash);
    const receipt = await tx.wait();
    console.log("  交易状态:   ✅ 成功");
    console.log("  Gas 使用:  ", receipt.gasUsed.toString());
  } catch (err) {
    console.error("  ❌ 交易失败:", err.reason || err.message);
    process.exit(1);
  }

  // Step 6: 查询提取后余额
  console.log("\n=== Step 6: 提取后状态 ===\n");

  const stakingAEAfter = await ae.balanceOf(STAKING_ADDRESS);
  const receiverAEAfter = await ae.balanceOf(RECEIVER);

  console.log("  Staking 合约 AE 余额:  ", fmt(stakingAEAfter).toLocaleString(), "AE");
  console.log("  接收地址 AE 余额:      ", fmt(receiverAEAfter).toLocaleString(), "AE");
  console.log("  实际转出:              ", fmt(receiverAEAfter - receiverAEBefore).toLocaleString(), "AE");

  // Step 7: 也测试 emergencyWithdrawUSDX
  console.log("\n=== Step 7: 测试 emergencyWithdrawUSDX ===\n");

  if (stakingUSDXBefore > 0n) {
    const receiverUSDXBefore = await usdx.balanceOf(RECEIVER);

    try {
      const tx2 = await staking.emergencyWithdrawUSDX(RECEIVER, stakingUSDXBefore);
      await tx2.wait();
      const receiverUSDXAfter = await usdx.balanceOf(RECEIVER);
      console.log("  USDC 提取:  ✅ 成功");
      console.log("  实际转出:  ", fmt(receiverUSDXAfter - receiverUSDXBefore).toLocaleString(), "USDC");
    } catch (err) {
      console.error("  ❌ USDC 提取失败:", err.reason || err.message);
    }
  } else {
    console.log("  Staking 合约无 USDC 余额，跳过");
  }

  // Step 8: 总结
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    测试结果总结                         ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  AE 提取:  ${fmt(withdrawAmount).toLocaleString().padEnd(40)}║`);
  console.log(`║  接收地址: ${RECEIVER}  ║`);
  console.log("║                                                        ║");
  console.log("║  ⚠️  以上为本地 fork 测试，主网未受影响                 ║");
  console.log("║  确认无误后可执行主网脚本:                              ║");
  console.log("║  npx hardhat run scripts/emergencyWithdrawAE.js --network bsc ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // 停止模拟
  await provider.send("hardhat_stopImpersonatingAccount", [OWNER_ADDRESS]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("测试失败:", error.message);
    process.exit(1);
  });
