const hre = require("hardhat");
const { ethers } = require("hardhat");

// 加载部署配置
const deploymentConfig = require("../ae-deployment-config.json");
const deployment = require("../ae-deployment.json");

// USDX 稳定币地址
const USDX_ADDRESS = deploymentConfig.addresses.usdx;

// 格式化数字显示
function formatToken(amount, decimals = 18, symbol = "") {
    const value = ethers.formatUnits(amount, decimals);
    return symbol ? `${value} ${symbol}` : value;
}

// 打印分隔线
function printSeparator(title = "") {
    console.log("\n" + "=".repeat(80));
    if (title) {
        console.log(`  ${title}`);
        console.log("=".repeat(80));
    }
}

async function main() {
    printSeparator("AE 代币交易测试");

    console.log(`\n测试配置:`);
    console.log(`  网络: ${deploymentConfig.network}`);
    console.log(`  AE 代币: ${deployment.contracts.AE}`);
    console.log(`  USDX: ${USDX_ADDRESS}`);
    console.log(`  交易对: ${deployment.contracts.Pair}`);
    console.log(`  PancakeSwap Router: ${deploymentConfig.addresses.pancakeRouter}`);

    // 获取签名者
    const [deployer] = await ethers.getSigners();
    console.log(`\n部署者账户: ${deployer.address}`);

    // 创建一个新的测试账户（非白名单）
    const testWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    const testAddress = testWallet.address;
    console.log(`测试账户: ${testAddress}`);

    // 为测试账户分配 BNB
    await deployer.sendTransaction({
        to: testAddress,
        value: ethers.parseEther("1.0")
    });
    console.log(`✓ 已为测试账户分配 1.0 BNB 用于 gas`);

    // 连接合约
    const usdx = await ethers.getContractAt("IERC20", USDX_ADDRESS);
    const ae = await ethers.getContractAt(
        [
            "function balanceOf(address) view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function transfer(address to, uint256 amount) returns (bool)",
            "function userInvestment(address) view returns (uint256)",
            "function amountMarketingFee() view returns (uint256)",
            "function amountLPFee() view returns (uint256)",
            "function feeWhitelisted(address) view returns (bool)"
        ],
        deployment.contracts.AE
    );
    const router = await ethers.getContractAt("IUniswapV2Router02", deploymentConfig.addresses.pancakeRouter);
    const pair = await ethers.getContractAt("IUniswapV2Pair", deployment.contracts.Pair);

    // 检查流动性池状态
    const reserves = await pair.getReserves();
    const token0 = await pair.token0();
    const token1 = await pair.token1();

    console.log(`\n流动性池状态:`);
    console.log(`  Token0: ${token0}`);
    console.log(`  Token1: ${token1}`);
    console.log(`  Reserve0: ${formatToken(reserves[0], 18)}`);
    console.log(`  Reserve1: ${formatToken(reserves[1], 18)}`);

    // 确定 AE 和 USDX 在池中的位置
    const aeIsToken0 = token0.toLowerCase() === deployment.contracts.AE.toLowerCase();
    const aeReserve = aeIsToken0 ? reserves[0] : reserves[1];
    const usdcReserve = aeIsToken0 ? reserves[1] : reserves[0];

    console.log(`\n流动性详情:`);
    console.log(`  AE 储备: ${formatToken(aeReserve, 18, "AE")}`);
    console.log(`  USDX 储备: ${formatToken(usdcReserve, 18, "USDX")}`);
    console.log(`  当前价格: 1 AE = ${formatToken(usdcReserve * ethers.parseEther("1") / aeReserve, 18, "USDX")}`);

    // 检查测试账户是否在白名单中
    const isWhitelisted = await ae.feeWhitelisted(testAddress);
    console.log(`\n测试账户白名单状态: ${isWhitelisted ? "是（将不收取费用）" : "否（将收取费用）"}`);

    // 为部署者分配 USDX，然后转给测试账户
    console.log(`\n为测试账户分配 USDX...`);

    // 先为部署者分配 USDX
    const slot = 1; // USDX balances 映射的槽位
    const deployerPadded = ethers.zeroPadValue(deployer.address, 32);
    const slotPadded = ethers.zeroPadValue(ethers.toBeHex(slot), 32);
    const deployerStorageSlot = ethers.keccak256(deployerPadded + slotPadded.slice(2));

    const usdcToAdd = ethers.parseEther("20000"); // 分配 20000 USDX
    await hre.network.provider.send("hardhat_setStorageAt", [
        USDX_ADDRESS,
        deployerStorageSlot,
        ethers.zeroPadValue(ethers.toBeHex(usdcToAdd), 32)
    ]);
    await hre.network.provider.send("evm_mine", []);

    // 部署者转账给测试账户
    const usdcDeployer = usdx.connect(deployer);
    await usdcDeployer.transfer(testAddress, ethers.parseEther("10000"));

    const testUsdcBalance = await usdx.balanceOf(testAddress);
    console.log(`✓ 测试账户 USDX 余额: ${formatToken(testUsdcBalance, 18)}`);

    // 使用测试账户连接合约
    const usdcTest = usdx.connect(testWallet);
    const aeTest = ae.connect(testWallet);
    const routerTest = router.connect(testWallet);

    // ========================================================================
    // 测试 1: 买入 AE 代币
    // ========================================================================
    printSeparator("测试 1: 买入 AE 代币");

    const buyAmount = ethers.parseEther("1000"); // 买入 1000 USDX 的 AE
    console.log(`\n买入金额: ${formatToken(buyAmount, 18, "USDX")}`);

    // 记录买入前的余额和费用地址余额
    const usdcBefore = await usdx.balanceOf(testAddress);
    const aeBefore = await ae.balanceOf(testAddress);
    const investmentBefore = await ae.userInvestment(testAddress);
    const nodeRewardBefore = await ae.balanceOf(deployment.addresses.buyTaxNodeRewardAddress);
    const communityRewardBefore = await ae.balanceOf(deployment.addresses.buyTaxCommunityRewardAddress);

    console.log(`\n买入前状态:`);
    console.log(`  USDX 余额: ${formatToken(usdcBefore, 18)}`);
    console.log(`  AE 余额: ${formatToken(aeBefore, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDX")}`);
    console.log(`  节点奖励地址 AE: ${formatToken(nodeRewardBefore, 18)}`);
    console.log(`  社区奖励地址 AE: ${formatToken(communityRewardBefore, 18)}`);

    // 获取预期输出
    const path = [USDX_ADDRESS, deployment.contracts.AE];
    const amountsOut = await router.getAmountsOut(buyAmount, path);
    const expectedAEOut = amountsOut[1];

    console.log(`\n预期输出 (不含费用): ${formatToken(expectedAEOut, 18, "AE")}`);

    // 计算预期费用 (买入费用: 2% 节点奖励 + 1% 社区奖励 = 3%)
    const nodeRewardFee = expectedAEOut * 200n / 10000n; // 2%
    const communityRewardFee = expectedAEOut * 100n / 10000n; // 1%
    const totalBuyFee = nodeRewardFee + communityRewardFee;
    const expectedNetAE = expectedAEOut - totalBuyFee;

    console.log(`\n预期费用计算:`);
    console.log(`  节点奖励费用 (2%): ${formatToken(nodeRewardFee, 18, "AE")}`);
    console.log(`  社区奖励费用 (1%): ${formatToken(communityRewardFee, 18, "AE")}`);
    console.log(`  总买入费用 (3%): ${formatToken(totalBuyFee, 18, "AE")}`);
    console.log(`  预期净收到: ${formatToken(expectedNetAE, 18, "AE")}`);

    // 授权并执行买入
    console.log(`\n授权 Router...`);
    await usdcTest.approve(deploymentConfig.addresses.pancakeRouter, buyAmount);

    console.log(`执行买入交易...`);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const buyTx = await routerTest.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        buyAmount,
        0,
        path,
        testAddress,
        deadline
    );
    const buyReceipt = await buyTx.wait();
    console.log(`✓ 交易成功 (Gas: ${buyReceipt.gasUsed.toString()})`);

    // 记录买入后的余额
    const usdcAfter = await usdx.balanceOf(testAddress);
    const aeAfter = await ae.balanceOf(testAddress);
    const investmentAfter = await ae.userInvestment(testAddress);
    const nodeRewardAfter = await ae.balanceOf(deployment.addresses.buyTaxNodeRewardAddress);
    const communityRewardAfter = await ae.balanceOf(deployment.addresses.buyTaxCommunityRewardAddress);

    // 计算实际变化
    const usdcSpent = usdcBefore - usdcAfter;
    const aeReceived = aeAfter - aeBefore;
    const investmentIncrease = investmentAfter - investmentBefore;
    const nodeRewardReceived = nodeRewardAfter - nodeRewardBefore;
    const communityRewardReceived = communityRewardAfter - communityRewardBefore;
    const totalFeeCollected = nodeRewardReceived + communityRewardReceived;

    console.log(`\n买入后状态:`);
    console.log(`  USDX 余额: ${formatToken(usdcAfter, 18)}`);
    console.log(`  AE 余额: ${formatToken(aeAfter, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentAfter, 18, "USDX")}`);

    console.log(`\n实际变化:`);
    console.log(`  USDX 花费: ${formatToken(usdcSpent, 18, "USDX")}`);
    console.log(`  AE 收到: ${formatToken(aeReceived, 18, "AE")}`);
    console.log(`  投资增加: ${formatToken(investmentIncrease, 18, "USDX")}`);

    console.log(`\n费用收取详情:`);
    console.log(`  节点奖励收到: ${formatToken(nodeRewardReceived, 18, "AE")}`);
    console.log(`  社区奖励收到: ${formatToken(communityRewardReceived, 18, "AE")}`);
    console.log(`  总费用: ${formatToken(totalFeeCollected, 18, "AE")}`);

    console.log(`\n费用验证:`);
    const actualFeeRate = totalFeeCollected * 10000n / expectedAEOut;
    console.log(`  实际费率: ${Number(actualFeeRate) / 100}% (预期 3%)`);
    console.log(`  节点奖励费率: ${Number(nodeRewardReceived * 10000n / expectedAEOut) / 100}% (预期 2%)`);
    console.log(`  社区奖励费率: ${Number(communityRewardReceived * 10000n / expectedAEOut) / 100}% (预期 1%)`);
    console.log(`  投资记录正确: ${investmentIncrease === usdcSpent ? "✓" : "✗"}`);

    // ========================================================================
    // 测试 2: 卖出 AE 代币
    // ========================================================================
    printSeparator("测试 2: 卖出 AE 代币");

    const sellAmount = aeReceived / 2n; // 卖出一半
    console.log(`\n卖出数量: ${formatToken(sellAmount, 18, "AE")}`);

    // 记录卖出前的余额
    const usdcBeforeSell = await usdx.balanceOf(testAddress);
    const aeBeforeSell = await ae.balanceOf(testAddress);
    const investmentBeforeSell = await ae.userInvestment(testAddress);
    const marketingFeeBefore = await ae.amountMarketingFee();
    const lpFeeBefore = await ae.amountLPFee();

    console.log(`\n卖出前状态:`);
    console.log(`  USDX 余额: ${formatToken(usdcBeforeSell, 18)}`);
    console.log(`  AE 余额: ${formatToken(aeBeforeSell, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentBeforeSell, 18, "USDX")}`);
    console.log(`  营销费用累积: ${formatToken(marketingFeeBefore, 18, "AE")}`);
    console.log(`  LP 费用累积: ${formatToken(lpFeeBefore, 18, "AE")}`);

    // 获取预期输出
    const sellPath = [deployment.contracts.AE, USDX_ADDRESS];
    const sellAmountsOut = await router.getAmountsOut(sellAmount, sellPath);
    const expectedUSDXOut = sellAmountsOut[1];

    console.log(`\n预期输出 (如果没有费用): ${formatToken(expectedUSDXOut, 18, "USDX")}`);

    // 计算预期费用 (卖出费用: 1.5% 营销 + 1.5% LP = 3%)
    const marketingFee = sellAmount * 150n / 10000n; // 1.5%
    const lpFee = sellAmount * 150n / 10000n; // 1.5%
    const totalSellFee = marketingFee + lpFee;
    const netAEAfterFees = sellAmount - totalSellFee;

    // 重新计算扣除费用后的预期 USDX
    const sellAmountsOutAfterFees = await router.getAmountsOut(netAEAfterFees, sellPath);
    const expectedUSDXAfterFees = sellAmountsOutAfterFees[1];

    console.log(`\n预期费用计算:`);
    console.log(`  营销费用 (1.5%): ${formatToken(marketingFee, 18, "AE")}`);
    console.log(`  LP 费用 (1.5%): ${formatToken(lpFee, 18, "AE")}`);
    console.log(`  总卖出费用 (3%): ${formatToken(totalSellFee, 18, "AE")}`);
    console.log(`  扣费后 AE: ${formatToken(netAEAfterFees, 18, "AE")}`);
    console.log(`  预期收到 USDX: ${formatToken(expectedUSDXAfterFees, 18, "USDX")}`);

    // 计算利润税或无利润费用
    const saleValue = expectedUSDXAfterFees;
    let profitTax = 0n;
    let noProfitFee = 0n;
    let expectedNetUSDX = saleValue;

    if (saleValue > investmentBeforeSell) {
        // 有利润，收取 25% 利润税
        const profit = saleValue - investmentBeforeSell;
        profitTax = profit * 2500n / 10000n;
        expectedNetUSDX = saleValue - profitTax;
        console.log(`\n利润计算:`);
        console.log(`  卖出价值: ${formatToken(saleValue, 18, "USDX")}`);
        console.log(`  历史投资: ${formatToken(investmentBeforeSell, 18, "USDX")}`);
        console.log(`  利润: ${formatToken(profit, 18, "USDX")}`);
        console.log(`  利润税 (25%): ${formatToken(profitTax, 18, "USDX")}`);
        console.log(`  预期净收到: ${formatToken(expectedNetUSDX, 18, "USDX")}`);
    } else {
        // 无利润，收取 25% 无利润费用
        noProfitFee = saleValue * 2500n / 10000n;
        expectedNetUSDX = saleValue - noProfitFee;
        console.log(`\n无利润费用计算:`);
        console.log(`  卖出价值: ${formatToken(saleValue, 18, "USDX")}`);
        console.log(`  历史投资: ${formatToken(investmentBeforeSell, 18, "USDX")}`);
        console.log(`  无利润费用 (25%): ${formatToken(noProfitFee, 18, "USDX")}`);
        console.log(`  预期净收到: ${formatToken(expectedNetUSDX, 18, "USDX")}`);
    }

    // 授权并执行卖出
    console.log(`\n授权 Router...`);
    await aeTest.approve(deploymentConfig.addresses.pancakeRouter, sellAmount);

    console.log(`执行卖出交易...`);
    const sellTx = await routerTest.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        sellAmount,
        0,
        sellPath,
        testAddress,
        deadline
    );
    const sellReceipt = await sellTx.wait();
    console.log(`✓ 交易成功 (Gas: ${sellReceipt.gasUsed.toString()})`);

    // 记录卖出后的余额
    const usdcAfterSell = await usdx.balanceOf(testAddress);
    const aeAfterSell = await ae.balanceOf(testAddress);
    const investmentAfterSell = await ae.userInvestment(testAddress);
    const marketingFeeAfter = await ae.amountMarketingFee();
    const lpFeeAfter = await ae.amountLPFee();

    // 计算实际变化
    const usdcReceived = usdcAfterSell - usdcBeforeSell;
    const aeSold = aeBeforeSell - aeAfterSell;
    const investmentDecrease = investmentBeforeSell - investmentAfterSell;
    const marketingFeeIncrease = marketingFeeAfter - marketingFeeBefore;
    const lpFeeIncrease = lpFeeAfter - lpFeeBefore;

    console.log(`\n卖出后状态:`);
    console.log(`  USDX 余额: ${formatToken(usdcAfterSell, 18)}`);
    console.log(`  AE 余额: ${formatToken(aeAfterSell, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentAfterSell, 18, "USDX")}`);

    console.log(`\n实际变化:`);
    console.log(`  AE 卖出: ${formatToken(aeSold, 18, "AE")}`);
    console.log(`  USDX 收到: ${formatToken(usdcReceived, 18, "USDX")}`);
    console.log(`  投资减少: ${formatToken(investmentDecrease, 18, "USDX")}`);

    console.log(`\n费用累积增加:`);
    console.log(`  营销费用: ${formatToken(marketingFeeIncrease, 18, "AE")}`);
    console.log(`  LP 费用: ${formatToken(lpFeeIncrease, 18, "AE")}`);
    console.log(`  总费用: ${formatToken(marketingFeeIncrease + lpFeeIncrease, 18, "AE")}`);

    console.log(`\n费用验证:`);
    const totalSellFeeCollected = marketingFeeIncrease + lpFeeIncrease;
    const sellFeeRate = totalSellFeeCollected * 10000n / sellAmount;
    console.log(`  实际费率: ${Number(sellFeeRate) / 100}% (预期 3%)`);
    console.log(`  营销费率: ${Number(marketingFeeIncrease * 10000n / sellAmount) / 100}% (预期 1.5%)`);
    console.log(`  LP 费率: ${Number(lpFeeIncrease * 10000n / sellAmount) / 100}% (预期 1.5%)`);

    // ========================================================================
    // 最终总结
    // ========================================================================
    printSeparator("测试总结");

    console.log(`\n买入测试结果:`);
    console.log(`  ✓ 花费 USDX: ${formatToken(usdcSpent, 18)}`);
    console.log(`  ✓ 收到 AE: ${formatToken(aeReceived, 18)}`);
    console.log(`  ✓ 总费用: ${formatToken(totalFeeCollected, 18, "AE")} (${Number(actualFeeRate) / 100}%)`);
    console.log(`  ✓ 节点奖励: ${formatToken(nodeRewardReceived, 18, "AE")}`);
    console.log(`  ✓ 社区奖励: ${formatToken(communityRewardReceived, 18, "AE")}`);

    console.log(`\n卖出测试结果:`);
    console.log(`  ✓ 卖出 AE: ${formatToken(aeSold, 18)}`);
    console.log(`  ✓ 收到 USDX: ${formatToken(usdcReceived, 18)}`);
    console.log(`  ✓ 总费用: ${formatToken(totalSellFeeCollected, 18, "AE")} (${Number(sellFeeRate) / 100}%)`);
    console.log(`  ✓ 营销费用: ${formatToken(marketingFeeIncrease, 18, "AE")}`);
    console.log(`  ✓ LP 费用: ${formatToken(lpFeeIncrease, 18, "AE")}`);

    console.log(`\n✓ 所有测试完成！`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
