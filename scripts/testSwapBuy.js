const hre = require("hardhat");
const { ethers } = require("hardhat");

// 加载部署配置
const deploymentConfig = require("../ae-deployment-config.json");
const deployment = require("../ae-deployment.json");

// ============ 配置区域（修改这里） ============
const BUYER_ADDRESS = "0x11C710888b00B90901ede49C08DA5B3B66C9dc76"; // 买入者钱包地址
const BUY_USDX_AMOUNT = "1000"; // 用多少 USDX 买入 AE
// =============================================

const USDX_ADDRESS = deploymentConfig.addresses.usdx;
const ROUTER_ADDRESS = deploymentConfig.addresses.pancakeRouter;
const AE_ADDRESS = deployment.contracts.AE;
const PAIR_ADDRESS = deployment.contracts.Pair;

function formatToken(amount, decimals = 18, symbol = "") {
    const value = ethers.formatUnits(amount, decimals);
    return symbol ? `${value} ${symbol}` : value;
}

async function main() {
    console.log("\n" + "=".repeat(60));
    console.log("  AE 代币买入测试");
    console.log("=".repeat(60));

    // 安全检查
    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
        throw new Error(`禁止在 ${hre.network.name} 网络上运行！仅限 localhost 或 hardhat。`);
    }

    console.log(`\n配置:`);
    console.log(`  买入者地址: ${BUYER_ADDRESS}`);
    console.log(`  买入金额: ${BUY_USDX_AMOUNT} USDX`);
    console.log(`  AE 代币: ${AE_ADDRESS}`);
    console.log(`  交易对: ${PAIR_ADDRESS}`);
    console.log(`  Router: ${ROUTER_ADDRESS}`);

    // 使用 hardhat 的 impersonateAccount 来模拟该地址操作
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [BUYER_ADDRESS],
    });
    const buyer = await ethers.getSigner(BUYER_ADDRESS);

    // 确保买入者有足够的 BNB 作为 gas
    const bnbBalance = await ethers.provider.getBalance(BUYER_ADDRESS);
    if (bnbBalance < ethers.parseEther("1")) {
        console.log(`\n为买入者补充 BNB...`);
        await hre.network.provider.send("hardhat_setBalance", [
            BUYER_ADDRESS,
            ethers.toBeHex(ethers.parseEther("100")),
        ]);
        console.log(`  已设置 100 BNB`);
    }

    // 连接合约
    const usdx = await ethers.getContractAt("IERC20", USDX_ADDRESS);
    const ae = await ethers.getContractAt(
        [
            "function balanceOf(address) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function userInvestment(address) view returns (uint256)",
            "function feeWhitelisted(address) view returns (bool)"
        ],
        AE_ADDRESS
    );
    const router = await ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);
    const pair = await ethers.getContractAt("IUniswapV2Pair", PAIR_ADDRESS);

    // 确保买入者有足够的 USDX
    const buyAmount = ethers.parseEther(BUY_USDX_AMOUNT);
    const currentUsdx = await usdx.balanceOf(BUYER_ADDRESS);
    if (currentUsdx < buyAmount) {
        console.log(`\n买入者 USDX 不足，正在补充...`);
        const needed = buyAmount - currentUsdx + ethers.parseEther("100"); // 多补充一点
        const slotsToTry = [9, 0, 1, 2, 51];
        const newBalance = currentUsdx + needed;
        const balanceHex = ethers.zeroPadValue(ethers.toBeHex(newBalance), 32);
        let success = false;

        for (const slot of slotsToTry) {
            const balanceSlot = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["address", "uint256"],
                    [BUYER_ADDRESS, slot]
                )
            );
            await hre.network.provider.send("hardhat_setStorageAt", [
                USDX_ADDRESS,
                balanceSlot,
                balanceHex,
            ]);
            const balance = await usdx.balanceOf(BUYER_ADDRESS);
            if (balance >= buyAmount) {
                console.log(`  已通过存储槽位 ${slot} 补充 USDX`);
                success = true;
                break;
            }
        }
        if (!success) {
            throw new Error("设置 USDX 余额失败！");
        }
    }

    // 查看流动性池状态
    const reserves = await pair.getReserves();
    const token0 = await pair.token0();
    const aeIsToken0 = token0.toLowerCase() === AE_ADDRESS.toLowerCase();
    const aeReserve = aeIsToken0 ? reserves[0] : reserves[1];
    const usdxReserve = aeIsToken0 ? reserves[1] : reserves[0];
    const price = usdxReserve * ethers.parseEther("1") / aeReserve;

    console.log(`\n流动性池状态:`);
    console.log(`  AE 储备: ${formatToken(aeReserve, 18, "AE")}`);
    console.log(`  USDX 储备: ${formatToken(usdxReserve, 18, "USDX")}`);
    console.log(`  当前价格: 1 AE = ${formatToken(price, 18, "USDX")}`);

    // 买入前余额
    const usdxBefore = await usdx.balanceOf(BUYER_ADDRESS);
    const aeBefore = await ae.balanceOf(BUYER_ADDRESS);
    const investmentBefore = await ae.userInvestment(BUYER_ADDRESS);
    const isWhitelisted = await ae.feeWhitelisted(BUYER_ADDRESS);

    console.log(`\n买入前状态:`);
    console.log(`  USDX 余额: ${formatToken(usdxBefore, 18, "USDX")}`);
    console.log(`  AE 余额: ${formatToken(aeBefore, 18, "AE")}`);
    console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDX")}`);
    console.log(`  白名单: ${isWhitelisted ? "是" : "否"}`);

    // 获取预期输出
    const path = [USDX_ADDRESS, AE_ADDRESS];
    const amountsOut = await router.getAmountsOut(buyAmount, path);
    const expectedAE = amountsOut[1];
    console.log(`\n预期获得 (不含费用): ${formatToken(expectedAE, 18, "AE")}`);

    // 授权 Router
    console.log(`\n授权 Router 使用 USDX...`);
    const usdxBuyer = usdx.connect(buyer);
    await usdxBuyer.approve(ROUTER_ADDRESS, buyAmount);

    // 执行买入
    console.log(`执行买入交易...`);
    const routerBuyer = router.connect(buyer);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = await routerBuyer.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        buyAmount,
        0, // 不设最小输出（测试用）
        path,
        BUYER_ADDRESS,
        deadline
    );
    const receipt = await tx.wait();

    // 买入后余额
    const usdxAfter = await usdx.balanceOf(BUYER_ADDRESS);
    const aeAfter = await ae.balanceOf(BUYER_ADDRESS);
    const investmentAfter = await ae.userInvestment(BUYER_ADDRESS);

    const usdxSpent = usdxBefore - usdxAfter;
    const aeReceived = aeAfter - aeBefore;

    console.log(`\n交易成功! (Gas: ${receipt.gasUsed.toString()})`);

    console.log(`\n买入后状态:`);
    console.log(`  USDX 余额: ${formatToken(usdxAfter, 18, "USDX")}`);
    console.log(`  AE 余额: ${formatToken(aeAfter, 18, "AE")}`);
    console.log(`  历史投资: ${formatToken(investmentAfter, 18, "USDX")}`);

    console.log(`\n交易摘要:`);
    console.log(`  花费: ${formatToken(usdxSpent, 18, "USDX")}`);
    console.log(`  收到: ${formatToken(aeReceived, 18, "AE")}`);
    console.log(`  实际价格: 1 AE = ${formatToken(usdxSpent * ethers.parseEther("1") / aeReceived, 18, "USDX")}`);

    if (!isWhitelisted) {
        const feeAmount = expectedAE - aeReceived;
        const feeRate = feeAmount * 10000n / expectedAE;
        console.log(`  扣费: ${formatToken(feeAmount, 18, "AE")} (${Number(feeRate) / 100}%)`);
    }

    // 停止模拟
    await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [BUYER_ADDRESS],
    });

    console.log(`\n` + "=".repeat(60));
    console.log(`  买入测试完成!`);
    console.log("=".repeat(60) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
