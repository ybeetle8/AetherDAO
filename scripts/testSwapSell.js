const hre = require("hardhat");
const { ethers } = require("hardhat");

// 加载部署配置
const deploymentConfig = require("../ae-deployment-config.json");
const deployment = require("../ae-deployment.json");

// ============ 配置区域（修改这里） ============
const SELLER_ADDRESS = "0x11C710888b00B90901ede49C08DA5B3B66C9dc76"; // 卖出者钱包地址
const SELL_AE_AMOUNT = ""; // 卖出 AE 数量，留空则卖出全部
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
    console.log("  AE 代币卖出测试");
    console.log("=".repeat(60));

    // 安全检查
    if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
        throw new Error(`禁止在 ${hre.network.name} 网络上运行！仅限 localhost 或 hardhat。`);
    }

    console.log(`\n配置:`);
    console.log(`  卖出者地址: ${SELLER_ADDRESS}`);
    console.log(`  AE 代币: ${AE_ADDRESS}`);
    console.log(`  交易对: ${PAIR_ADDRESS}`);
    console.log(`  Router: ${ROUTER_ADDRESS}`);

    // 使用 hardhat 的 impersonateAccount 来模拟该地址操作
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [SELLER_ADDRESS],
    });
    const seller = await ethers.getSigner(SELLER_ADDRESS);

    // 确保卖出者有足够的 BNB 作为 gas
    const bnbBalance = await ethers.provider.getBalance(SELLER_ADDRESS);
    if (bnbBalance < ethers.parseEther("1")) {
        console.log(`\n为卖出者补充 BNB...`);
        await hre.network.provider.send("hardhat_setBalance", [
            SELLER_ADDRESS,
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
            "function feeWhitelisted(address) view returns (bool)",
            "function amountMarketingFee() view returns (uint256)",
            "function amountLPFee() view returns (uint256)"
        ],
        AE_ADDRESS
    );
    const router = await ethers.getContractAt("IUniswapV2Router02", ROUTER_ADDRESS);
    const pair = await ethers.getContractAt("IUniswapV2Pair", PAIR_ADDRESS);

    // 检查 AE 余额
    const aeBalance = await ae.balanceOf(SELLER_ADDRESS);
    if (aeBalance === 0n) {
        throw new Error(`卖出者地址 ${SELLER_ADDRESS} 没有 AE 代币！请先运行 testSwapBuy.js 买入。`);
    }

    // 确定卖出数量
    let sellAmount;
    if (SELL_AE_AMOUNT && SELL_AE_AMOUNT.trim() !== "") {
        sellAmount = ethers.parseEther(SELL_AE_AMOUNT);
        if (sellAmount > aeBalance) {
            throw new Error(`AE 余额不足！当前: ${formatToken(aeBalance, 18, "AE")}，需要: ${SELL_AE_AMOUNT} AE`);
        }
    } else {
        sellAmount = aeBalance; // 卖出全部
        console.log(`\n未指定卖出数量，将卖出全部 AE`);
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

    // 卖出前余额
    const usdxBefore = await usdx.balanceOf(SELLER_ADDRESS);
    const aeBefore = await ae.balanceOf(SELLER_ADDRESS);
    const investmentBefore = await ae.userInvestment(SELLER_ADDRESS);
    const isWhitelisted = await ae.feeWhitelisted(SELLER_ADDRESS);
    const marketingFeeBefore = await ae.amountMarketingFee();
    const lpFeeBefore = await ae.amountLPFee();

    console.log(`\n卖出前状态:`);
    console.log(`  AE 余额: ${formatToken(aeBefore, 18, "AE")}`);
    console.log(`  USDX 余额: ${formatToken(usdxBefore, 18, "USDX")}`);
    console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDX")}`);
    console.log(`  白名单: ${isWhitelisted ? "是" : "否"}`);
    console.log(`  卖出数量: ${formatToken(sellAmount, 18, "AE")}`);

    // 获取预期输出
    const sellPath = [AE_ADDRESS, USDX_ADDRESS];
    const amountsOut = await router.getAmountsOut(sellAmount, sellPath);
    const expectedUSDX = amountsOut[1];
    console.log(`\n预期获得 (不含费用): ${formatToken(expectedUSDX, 18, "USDX")}`);

    // 授权 Router
    console.log(`\n授权 Router 使用 AE...`);
    const aeSeller = ae.connect(seller);
    await aeSeller.approve(ROUTER_ADDRESS, sellAmount);

    // 执行卖出
    console.log(`执行卖出交易...`);
    const routerSeller = router.connect(seller);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = await routerSeller.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        sellAmount,
        0, // 不设最小输出（测试用）
        sellPath,
        SELLER_ADDRESS,
        deadline
    );
    const receipt = await tx.wait();

    // 卖出后余额
    const usdxAfter = await usdx.balanceOf(SELLER_ADDRESS);
    const aeAfter = await ae.balanceOf(SELLER_ADDRESS);
    const investmentAfter = await ae.userInvestment(SELLER_ADDRESS);
    const marketingFeeAfter = await ae.amountMarketingFee();
    const lpFeeAfter = await ae.amountLPFee();

    const aeSold = aeBefore - aeAfter;
    const usdxReceived = usdxAfter - usdxBefore;
    const marketingFeeIncrease = marketingFeeAfter - marketingFeeBefore;
    const lpFeeIncrease = lpFeeAfter - lpFeeBefore;

    console.log(`\n交易成功! (Gas: ${receipt.gasUsed.toString()})`);

    console.log(`\n卖出后状态:`);
    console.log(`  AE 余额: ${formatToken(aeAfter, 18, "AE")}`);
    console.log(`  USDX 余额: ${formatToken(usdxAfter, 18, "USDX")}`);
    console.log(`  历史投资: ${formatToken(investmentAfter, 18, "USDX")}`);

    console.log(`\n交易摘要:`);
    console.log(`  卖出: ${formatToken(aeSold, 18, "AE")}`);
    console.log(`  收到: ${formatToken(usdxReceived, 18, "USDX")}`);
    console.log(`  实际价格: 1 AE = ${formatToken(usdxReceived * ethers.parseEther("1") / aeSold, 18, "USDX")}`);

    if (!isWhitelisted) {
        console.log(`\n费用详情:`);
        console.log(`  营销费用增加: ${formatToken(marketingFeeIncrease, 18, "AE")}`);
        console.log(`  LP 费用增加: ${formatToken(lpFeeIncrease, 18, "AE")}`);
        const totalFee = marketingFeeIncrease + lpFeeIncrease;
        console.log(`  总卖出费用: ${formatToken(totalFee, 18, "AE")}`);
        if (sellAmount > 0n) {
            const feeRate = totalFee * 10000n / sellAmount;
            console.log(`  费率: ${Number(feeRate) / 100}%`);
        }
    }

    // 查看交易后流动性池
    const reservesAfter = await pair.getReserves();
    const aeReserveAfter = aeIsToken0 ? reservesAfter[0] : reservesAfter[1];
    const usdxReserveAfter = aeIsToken0 ? reservesAfter[1] : reservesAfter[0];
    const priceAfter = usdxReserveAfter * ethers.parseEther("1") / aeReserveAfter;

    console.log(`\n交易后流动性池:`);
    console.log(`  AE 储备: ${formatToken(aeReserveAfter, 18, "AE")}`);
    console.log(`  USDX 储备: ${formatToken(usdxReserveAfter, 18, "USDX")}`);
    console.log(`  当前价格: 1 AE = ${formatToken(priceAfter, 18, "USDX")}`);
    console.log(`  价格变动: ${formatToken(price, 18)} -> ${formatToken(priceAfter, 18)} USDX`);

    // 停止模拟
    await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [SELLER_ADDRESS],
    });

    console.log(`\n` + "=".repeat(60));
    console.log(`  卖出测试完成!`);
    console.log("=".repeat(60) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
