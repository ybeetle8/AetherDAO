const { ethers } = require("hardhat");

const deployment = require("../ae-deployment.json");

const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const AE_ADDRESS = deployment.contracts.AE;

// token: "USDC" | "AE" | "BOTH"
const ADDRESS_LIST = [
  { name: "部署者", address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", token: "BOTH" },
  { name: "营销地址", address: "0x1234567890123456789012345678901234567890", token: "USDC" },
  { name: "根地址", address: "0x2345678901234567890123456789012345678901", token: "USDC" },
  { name: "手续费接收地址", address: "0x0000000000000000000000000000000000000001", token: "USDC" },
  { name: "买入税节点奖励地址", address: "0x06Ba6DA5d1942DA184ad3E521bC51dfF32D721d9", token: "AE" },
  { name: "买入税社区奖励地址", address: "0xeE1285c96E77f2E8CB9C38b66A0BB51b2fCE5537", token: "AE" },
  { name: "营销基金地址", address: "0x498B497fDAEf221dFC6e4Ea6183aEFA9e9b63D17", token: "AE" },
  { name: "周Top15奖励地址", address: "0x82B3B6a20d88d2d8B607B64876885259544DF591", token: "USDC" },
  { name: "跨链储备地址", address: "0x6bdD1F916C1bf45D62B7f8282fB7A69302C785bB", token: "AE" },
  { name: "教育基金地址", address: "0x2DC1e6D6Ae7b8Be231c54f0de2Ede2973550fBBa", token: "USDC" },
  { name: "节点奖励地址", address: "0x8234567890123456789012345678901234567890", token: "AE" },
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

    console.log(`${item.name.padEnd(16)} | ${item.address} | ${parts.join(" | ")}`);
  }

  console.log("-".repeat(90));
  console.log(`${"合计".padEnd(16)} | ${" ".repeat(42)} | ${ethers.formatEther(totalUsdc)} USDC | ${ethers.formatEther(totalAe)} AE`);
  console.log("=".repeat(90));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
