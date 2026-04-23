const hre = require("hardhat");

async function main() {
  const usdx = await hre.ethers.getContractAt("IERC20", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
  const [deployer, ...accounts] = await hre.ethers.getSigners();
  const user = accounts[0];
  const amount = hre.ethers.parseEther("10000");
  const amountHex = hre.ethers.toBeHex(amount, 32);

  console.log("user:", user.address);
  console.log("deployer balance:", hre.ethers.formatEther(await usdx.balanceOf(deployer.address)));

  const slotsToTry = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 51];

  for (const slot of slotsToTry) {
    // 方式1: solidityPackedKeccak256
    const s1 = hre.ethers.solidityPackedKeccak256(
      ["uint256", "uint256"],
      [user.address, slot]
    );
    await hre.network.provider.send("hardhat_setStorageAt", [
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", s1, amountHex,
    ]);
    let b = await usdx.balanceOf(user.address);
    if (b >= amount) {
      console.log(`✅ packed(uint256,uint256) slot ${slot} works! balance: ${hre.ethers.formatEther(b)}`);
      return;
    }

    // 方式2: AbiCoder.encode
    const s2 = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256"],
        [user.address, slot]
      )
    );
    await hre.network.provider.send("hardhat_setStorageAt", [
      "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", s2, amountHex,
    ]);
    b = await usdx.balanceOf(user.address);
    if (b >= amount) {
      console.log(`✅ abi.encode(address,uint256) slot ${slot} works! balance: ${hre.ethers.formatEther(b)}`);
      return;
    }
  }
  console.log("❌ no slot worked");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
