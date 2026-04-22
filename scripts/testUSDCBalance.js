const hre = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
    const USDX_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
    const testAddress = "0x0934b424878B620905089031017A545C584F577A";
    
    const usdx = await ethers.getContractAt("IERC20", USDX_ADDRESS);
    
    console.log("检查 USDX 余额...");
    try {
        const balance = await usdx.balanceOf(testAddress);
        console.log(`余额: ${ethers.formatEther(balance)} USDX`);
    } catch (error) {
        console.log(`错误: ${error.message}`);
    }
    
    // 检查合约代码
    const code = await ethers.provider.getCode(USDX_ADDRESS);
    console.log(`USDX 合约代码长度: ${code.length}`);
}

main().catch(console.error);
