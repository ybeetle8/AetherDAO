const hre = require("hardhat");

// ============ 配置区域（修改这里） ============
const TARGET_ADDRESS = "0x2988FCb0157037BD88e4EC51ac92d48a79441730"; // 修改为你的钱包地址
const BNB_AMOUNT = "100";    // 发送 BNB 数量
const USDC_AMOUNT = "10000"; // 发送 USDC 数量
// =============================================

// BSC 主网 USDC 合约地址（不要改这个，这是代币合约地址，不是钱包地址）
const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

async function main() {
  // 安全检查：仅允许本地网络
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    throw new Error(`禁止在 ${hre.network.name} 网络上运行此脚本！仅限 localhost 或 hardhat 网络。`);
  }

  const ethers = hre.ethers;

  console.log("\n========================================");
  console.log("  发送 BNB 和 USDC 到指定钱包");
  console.log("========================================\n");
  console.log("目标地址:", TARGET_ADDRESS);
  console.log("网络:    ", hre.network.name);

  // --- 发送 BNB ---
  console.log("\n--- 发送 BNB ---");

  const bnbWei = ethers.parseEther(BNB_AMOUNT);
  await hre.network.provider.send("hardhat_setBalance", [
    TARGET_ADDRESS,
    ethers.toBeHex(bnbWei),
  ]);

  const bnbBalance = await ethers.provider.getBalance(TARGET_ADDRESS);
  console.log(`✓ 已发送 ${BNB_AMOUNT} BNB`);
  console.log(`  当前 BNB 余额: ${ethers.formatEther(bnbBalance)} BNB`);

  // --- 发送 USDC ---
  console.log("\n--- 发送 USDC ---");
  console.log(`  代币合约: ${USDC_ADDRESS}`);

  // 检查 USDC 合约地址是否存在
  const code = await ethers.provider.getCode(USDC_ADDRESS);
  if (code === "0x") {
    throw new Error(
      `地址 ${USDC_ADDRESS} 上没有合约代码！请检查 USDC_ADDRESS 是否正确。`
    );
  }

  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    USDC_ADDRESS
  );

  const usdcAmount = ethers.parseEther(USDC_AMOUNT);
  const usdcAmountHex = ethers.zeroPadValue(ethers.toBeHex(usdcAmount), 32);

  // 尝试多个存储槽位（不同 ERC20 合约 balanceOf 映射的槽位不同）
  const slotsToTry = [9, 0, 1, 2, 51];
  let success = false;

  for (const slot of slotsToTry) {
    const balanceSlot = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [TARGET_ADDRESS, slot]
      )
    );

    await hre.network.provider.send("hardhat_setStorageAt", [
      USDC_ADDRESS,
      balanceSlot,
      usdcAmountHex,
    ]);

    const balance = await usdc.balanceOf(TARGET_ADDRESS);
    if (balance >= usdcAmount) {
      console.log(`✓ 找到正确的存储槽位: ${slot}`);
      console.log(`✓ 已发送 ${USDC_AMOUNT} USDC`);
      console.log(`  当前 USDC 余额: ${ethers.formatEther(balance)} USDC`);
      success = true;
      break;
    }
  }

  if (!success) {
    throw new Error(`设置 USDC 余额失败！尝试了槽位 ${slotsToTry.join(", ")} 均未成功。`);
  }

  // --- 查询目标地址余额 ---
  console.log("\n--- 查询目标地址余额 ---");
  console.log(`  地址: ${TARGET_ADDRESS}`);

  const finalBnb = await ethers.provider.getBalance(TARGET_ADDRESS);
  const finalUsdc = await usdc.balanceOf(TARGET_ADDRESS);

  console.log(`  BNB  余额: ${ethers.formatEther(finalBnb)} BNB`);
  console.log(`  USDC 余额: ${ethers.formatEther(finalUsdc)} USDC`);

  console.log("\n========================================");
  console.log("  完成！");
  console.log("========================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
