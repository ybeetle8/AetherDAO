/**
 * 查询预售开关状态脚本
 * 读取 AE 合约的 presaleActive 状态
 *
 * 用法: npx hardhat run scripts/queryPresaleStatus.js --network bsc
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

  // 连接 AE 合约
  const ae = await hre.ethers.getContractAt(
    "contracts/AE/src/mainnet/AE.sol:AE",
    AE_ADDRESS
  );

  // 查询预售状态
  const presaleActive = await ae.presaleActive();
  console.log(`\n预售状态: ${presaleActive ? "开启（交易受限，用户无法从 DEX 买入）" : "已关闭（交易已开放）"}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
