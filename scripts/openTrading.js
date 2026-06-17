/**
 * 开放交易脚本
 * 调用 AE.setPresaleActive(false) 关闭预售模式，允许用户从 DEX 买入
 *
 * 用法: npx hardhat run scripts/openTrading.js --network bsc
 */

const hre = require("hardhat");
const path = require("path");

async function main() {
  // 网络安全检查
  if (hre.network.name !== "bsc") {
    console.error("此脚本仅用于 BSC 主网！");
    console.error(`当前网络: ${hre.network.name}`);
    process.exit(1);
  }

  // 加载部署状态
  const deployment = require(path.join(
    __dirname,
    "..",
    "ae-mainnet-deployment.json"
  ));
  const AE_ADDRESS = deployment.contracts.AE;
  console.log(`AE 合约地址: ${AE_ADDRESS}`);

  // 获取签名者
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`操作地址: ${deployer.address}`);
  console.log(`BNB 余额: ${hre.ethers.formatEther(balance)} BNB`);

  if (balance < hre.ethers.parseEther("0.01")) {
    console.error("BNB 余额不足，至少需要 0.01 BNB");
    process.exit(1);
  }

  // 连接 AE 合约
  const ae = await hre.ethers.getContractAt(
    "contracts/AE/src/mainnet/AE.sol:AE",
    AE_ADDRESS
  );

  // 检查当前预售状态
  const currentStatus = await ae.presaleActive();
  console.log(`当前预售状态: ${currentStatus ? "开启（交易受限）" : "已关闭（交易已开放）"}`);

  if (!currentStatus) {
    console.log("预售已经关闭，交易已开放，无需操作。");
    return;
  }

  // 执行关闭预售
  console.log("\n正在调用 setPresaleActive(false) ...");
  try {
    const tx = await ae.setPresaleActive(false);
    console.log(`交易已发送: ${tx.hash}`);
    console.log("等待确认...");

    const receipt = await tx.wait();
    console.log(`交易已确认，区块: ${receipt.blockNumber}`);
    console.log(`Gas 消耗: ${receipt.gasUsed.toString()}`);
  } catch (error) {
    console.error("交易失败:", error.message);
    process.exit(1);
  }

  // 验证结果
  const newStatus = await ae.presaleActive();
  console.log(`\n验证 - 预售状态: ${newStatus ? "开启" : "已关闭"}`);

  if (!newStatus) {
    console.log("✓ 交易已开放，用户现在可以从 DEX 买入 AE");
  } else {
    console.error("✗ 操作可能未生效，请检查");
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
