const { ethers } = require("hardhat");

const deployment = require("../ae-deployment.json");

const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const AE_ADDRESS = deployment.contracts.AE;

// token: "USDC" | "AE" | "BOTH"
const config = require("../ae-deployment-config.json");

const ADDRESS_LIST = [
  { name: "部署者", engName: "deployer", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", token: "BOTH" },
  { name: "营销地址", engName: "marketingAddress", address: config.addresses.marketingAddress, token: "USDC" },
  { name: "根地址", engName: "rootAddress", address: config.addresses.rootAddress, token: "USDC" },
  { name: "手续费接收地址", engName: "feeRecipient", address: config.addresses.feeRecipient, token: "USDC" },
  { name: "买入税节点奖励地址", engName: "buyTaxNodeRewardAddress", address: config.addresses.buyTaxNodeRewardAddress, token: "AE" },
  { name: "买入税社区奖励地址", engName: "buyTaxCommunityRewardAddress", address: config.addresses.buyTaxCommunityRewardAddress, token: "AE" },
  { name: "营销基金地址", engName: "marketingFundAddress", address: config.addresses.marketingFundAddress, token: "AE" },
  { name: "周Top15奖励地址", engName: "weeklyTop15RewardAddress", address: config.addresses.weeklyTop15RewardAddress, token: "USDC" },
  { name: "跨链储备地址", engName: "crossChainReserveAddress", address: config.addresses.crossChainReserveAddress, token: "AE" },
  { name: "教育基金地址", engName: "educationFundAddress", address: config.addresses.educationFundAddress, token: "USDC" },
  { name: "节点奖励地址", engName: "nodeRewardAllocationAddress", address: config.addresses.nodeRewardAllocationAddress, token: "AE" },
];

async function main() {
  const usdc = await ethers.getContractAt("IERC20", USDC_ADDRESS);
  const ae = await ethers.getContractAt("IERC20", AE_ADDRESS);

  console.log("=".repeat(90));
  console.log("  各地址余额查询");
  console.log("=".repeat(90));

  let totalUsdc = 0n;
  let totalAe = 0n;

  for (const item of ADDRESS_LIST) {
    const showUsdc = item.token === "USDC" || item.token === "BOTH";
    const showAe = item.token === "AE" || item.token === "BOTH";

    const parts = [];

    if (showUsdc) {
      const usdcBalance = await usdc.balanceOf(item.address);
      totalUsdc += usdcBalance;
      parts.push(`${ethers.formatEther(usdcBalance)} USDC`);
    }

    if (showAe) {
      const aeBalance = await ae.balanceOf(item.address);
      totalAe += aeBalance;
      parts.push(`${ethers.formatEther(aeBalance)} AE`);
    }

    console.log(`${item.name.padEnd(16)} | ${item.engName.padEnd(30)} | ${item.address} | ${parts.join(" | ")}`);
  }

  console.log("-".repeat(90));
  console.log(`${"合计".padEnd(16)} | ${" ".repeat(30)} | ${" ".repeat(42)} | ${ethers.formatEther(totalUsdc)} USDC | ${ethers.formatEther(totalAe)} AE`);
  console.log("=".repeat(90));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
