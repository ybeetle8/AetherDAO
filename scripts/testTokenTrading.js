const hre = require("hardhat");
const { ethers } = require("hardhat");

// 加载部署配置
const deploymentConfig = require("../ae-deployment-config.json");
const deployment = require("../ae-deployment.json");

// USDT 合约地址和 ABI
const USDT_ADDRESS = deploymentConfig.addresses.usdt;
const USDT_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

// PancakeSwap Router ABI
const ROUTER_ABI = [
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)"
];

// AE Token ABI
const AE_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function userInvestment(address) view returns (uint256)",
    "function feeWhitelisted(address) view returns (bool)",
    "function setFeeWhitelisted(address account, bool whitelisted) external",
    "function amountMarketingFee() view returns (uint256)",
    "function amountLPFee() view returns (uint256)",
    "event TransactionExecuted(address indexed user, uint256 indexed timestamp, string indexed txType, uint256 tokenAmount, uint256 usdtAmount, uint256 netUserReceived, uint256 previousInvestment, uint256 newInvestment, uint256 burnFee, uint256 lpFee, uint256 marketingFee, uint256 profitAmount, uint256 profitTax, address referrer)",
    "event SellTransaction(address indexed seller, uint256 indexed timestamp, uint256 originalXFAmount, uint256 tradingFeeXF, uint256 marketingFeeXF, uint256 lpFeeXF, uint256 netXFAfterTradingFees, uint256 estimatedUSDTFromSale, uint256 userHistoricalInvestment, uint256 totalProfitAmount, uint256 profitTaxUSDT, uint256 noProfitFeeUSDT, uint256 profitTaxToMarketing, uint256 profitTaxToReferrer, uint256 userNetProfitUSDT, uint256 finalUSDTReceived, address referrer)"
];

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

// 获取 USDT 持有者地址（从 BSC 主网）
async function getUSDTHolder() {
    // 这是 BSC 上的一个大户地址
    return "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3"; // Binance Hot Wallet
}

// 为测试账户分配 USDT
async function fundAccountWithUSDT(account, amount) {
    const usdtHolder = await getUSDTHolder();

    // 模拟 USDT 持有者
    await hre.network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [usdtHolder],
    });

    // 给持有者账户一些 BNB 用于 gas
    const [deployer] = await ethers.getSigners();
    await deployer.sendTransaction({
        to: usdtHolder,
        value: ethers.parseEther("1.0")
    });

    const holderSigner = await ethers.provider.getSigner(usdtHolder);
    const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, holderSigner);

    // 转账 USDT
    await usdt.transfer(account, amount);

    await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [usdtHolder],
    });
}

// 测试买入代币
async function testBuyTokens(trader, traderAddress, usdt, ae, router, buyAmount) {
    printSeparator("测试买入 AE 代币");

    console.log(`\n买入金额: ${formatToken(buyAmount, 18, "USDT")}`);
    console.log(`交易者地址: ${traderAddress}`);

    // 记录买入前的余额
    const usdtBalanceBefore = await usdt.balanceOf(traderAddress);
    const aeBalanceBefore = await ae.balanceOf(traderAddress);
    const investmentBefore = await ae.userInvestment(traderAddress);

    console.log(`\n买入前余额:`);
    console.log(`  USDT: ${formatToken(usdtBalanceBefore, 18)}`);
    console.log(`  AE: ${formatToken(aeBalanceBefore, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDT")}`);

    // 记录各个费用接收地址的余额
    const nodeRewardBefore = await ae.balanceOf(deployment.addresses.buyTaxNodeRewardAddress);
    const communityRewardBefore = await ae.balanceOf(deployment.addresses.buyTaxCommunityRewardAddress);

    console.log(`\n费用接收地址买入前余额:`);
    console.log(`  节点奖励地址: ${formatToken(nodeRewardBefore, 18, "AE")}`);
    console.log(`  社区奖励地址: ${formatToken(communityRewardBefore, 18, "AE")}`);

    // 授权 Router
    console.log(`\n授权 Router 使用 USDT...`);
    await usdt.approve(deploymentConfig.addresses.pancakeRouter, buyAmount);

    // 获取预期输出
    const path = [USDT_ADDRESS, deployment.contracts.AE];
    const amountsOut = await router.getAmountsOut(buyAmount, path);
    const expectedAEOut = amountsOut[1];

    console.log(`\n预期输出 (不含费用): ${formatToken(expectedAEOut, 18, "AE")}`);

    // 计算预期费用
    const nodeRewardFee = expectedAEOut * 200n / 10000n; // 2%
    const communityRewardFee = expectedAEOut * 100n / 10000n; // 1%
    const totalBuyFee = nodeRewardFee + communityRewardFee;
    const expectedNetAE = expectedAEOut - totalBuyFee;

    console.log(`\n预期费用计算:`);
    console.log(`  节点奖励费用 (2%): ${formatToken(nodeRewardFee, 18, "AE")}`);
    console.log(`  社区奖励费用 (1%): ${formatToken(communityRewardFee, 18, "AE")}`);
    console.log(`  总买入费用 (3%): ${formatToken(totalBuyFee, 18, "AE")}`);
    console.log(`  预期净收到: ${formatToken(expectedNetAE, 18, "AE")}`);

    // 执行买入
    console.log(`\n执行买入交易...`);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        buyAmount,
        0, // 最小输出设为 0，实际应该设置合理的滑点
        path,
        traderAddress,
        deadline
    );

    const receipt = await tx.wait();
    console.log(`交易哈希: ${receipt.hash}`);
    console.log(`Gas 使用: ${receipt.gasUsed.toString()}`);

    // 记录买入后的余额
    const usdtBalanceAfter = await usdt.balanceOf(traderAddress);
    const aeBalanceAfter = await ae.balanceOf(traderAddress);
    const investmentAfter = await ae.userInvestment(traderAddress);

    const nodeRewardAfter = await ae.balanceOf(deployment.addresses.buyTaxNodeRewardAddress);
    const communityRewardAfter = await ae.balanceOf(deployment.addresses.buyTaxCommunityRewardAddress);

    // 计算实际变化
    const usdtSpent = usdtBalanceBefore - usdtBalanceAfter;
    const aeReceived = aeBalanceAfter - aeBalanceBefore;
    const investmentIncrease = investmentAfter - investmentBefore;

    const nodeRewardReceived = nodeRewardAfter - nodeRewardBefore;
    const communityRewardReceived = communityRewardAfter - communityRewardBefore;
    const totalFeeCollected = nodeRewardReceived + communityRewardReceived;

    console.log(`\n买入后余额:`);
    console.log(`  USDT: ${formatToken(usdtBalanceAfter, 18)}`);
    console.log(`  AE: ${formatToken(aeBalanceAfter, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentAfter, 18, "USDT")}`);

    console.log(`\n实际变化:`);
    console.log(`  USDT 花费: ${formatToken(usdtSpent, 18, "USDT")}`);
    console.log(`  AE 收到: ${formatToken(aeReceived, 18, "AE")}`);
    console.log(`  投资增加: ${formatToken(investmentIncrease, 18, "USDT")}`);

    console.log(`\n费用接收地址实际收到:`);
    console.log(`  节点奖励地址: ${formatToken(nodeRewardReceived, 18, "AE")}`);
    console.log(`  社区奖励地址: ${formatToken(communityRewardReceived, 18, "AE")}`);
    console.log(`  总费用收取: ${formatToken(totalFeeCollected, 18, "AE")}`);

    // 验证费用
    console.log(`\n费用验证:`);
    const feeRate = totalFeeCollected * 10000n / expectedAEOut;
    console.log(`  实际费率: ${feeRate.toString()} / 10000 = ${Number(feeRate) / 100}%`);
    console.log(`  预期费率: 3%`);

    const nodeRewardRate = nodeRewardReceived * 10000n / expectedAEOut;
    const communityRewardRate = communityRewardReceived * 10000n / expectedAEOut;
    console.log(`  节点奖励费率: ${Number(nodeRewardRate) / 100}% (预期 2%)`);
    console.log(`  社区奖励费率: ${Number(communityRewardRate) / 100}% (预期 1%)`);

    // 验证投资记录
    console.log(`\n投资记录验证:`);
    console.log(`  投资增加是否等于 USDT 花费: ${investmentIncrease === usdtSpent ? "✓ 正确" : "✗ 错误"}`);

    return {
        aeReceived,
        usdtSpent,
        totalFeeCollected,
        nodeRewardReceived,
        communityRewardReceived
    };
}

// 测试卖出代币
async function testSellTokens(trader, traderAddress, usdt, ae, router, sellAmount) {
    printSeparator("测试卖出 AE 代币");

    console.log(`\n卖出数量: ${formatToken(sellAmount, 18, "AE")}`);
    console.log(`交易者地址: ${traderAddress}`);

    // 记录卖出前的余额
    const usdtBalanceBefore = await usdt.balanceOf(traderAddress);
    const aeBalanceBefore = await ae.balanceOf(traderAddress);
    const investmentBefore = await ae.userInvestment(traderAddress);

    console.log(`\n卖出前余额:`);
    console.log(`  USDT: ${formatToken(usdtBalanceBefore, 18)}`);
    console.log(`  AE: ${formatToken(aeBalanceBefore, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDT")}`);

    // 记录费用累积
    const marketingFeeBefore = await ae.amountMarketingFee();
    const lpFeeBefore = await ae.amountLPFee();

    console.log(`\n合约费用累积 (卖出前):`);
    console.log(`  营销费用累积: ${formatToken(marketingFeeBefore, 18, "AE")}`);
    console.log(`  LP 费用累积: ${formatToken(lpFeeBefore, 18, "AE")}`);

    // 授权 Router
    console.log(`\n授权 Router 使用 AE...`);
    await ae.approve(deploymentConfig.addresses.pancakeRouter, sellAmount);

    // 获取预期输出（不考虑费用）
    const path = [deployment.contracts.AE, USDT_ADDRESS];
    const amountsOut = await router.getAmountsOut(sellAmount, path);
    const expectedUSDTOut = amountsOut[1];

    console.log(`\n预期输出 (如果没有费用): ${formatToken(expectedUSDTOut, 18, "USDT")}`);

    // 计算预期费用
    const marketingFee = sellAmount * 150n / 10000n; // 1.5%
    const lpFee = sellAmount * 150n / 10000n; // 1.5%
    const totalSellFee = marketingFee + lpFee;
    const netAEAfterFees = sellAmount - totalSellFee;

    // 重新计算扣除费用后的预期 USDT
    const amountsOutAfterFees = await router.getAmountsOut(netAEAfterFees, path);
    const expectedUSDTAfterFees = amountsOutAfterFees[1];

    console.log(`\n预期费用计算:`);
    console.log(`  营销费用 (1.5%): ${formatToken(marketingFee, 18, "AE")}`);
    console.log(`  LP 费用 (1.5%): ${formatToken(lpFee, 18, "AE")}`);
    console.log(`  总卖出费用 (3%): ${formatToken(totalSellFee, 18, "AE")}`);
    console.log(`  扣费后 AE: ${formatToken(netAEAfterFees, 18, "AE")}`);
    console.log(`  预期收到 USDT (扣费后): ${formatToken(expectedUSDTAfterFees, 18, "USDT")}`);

    // 计算利润税或无利润费用
    const saleValue = expectedUSDTAfterFees;
    let profitTax = 0n;
    let noProfitFee = 0n;
    let expectedNetUSDT = saleValue;

    if (saleValue > investmentBefore) {
        // 有利润，收取 25% 利润税
        const profit = saleValue - investmentBefore;
        profitTax = profit * 2500n / 10000n;
        expectedNetUSDT = saleValue - profitTax;
        console.log(`\n利润计算:`);
        console.log(`  卖出价值: ${formatToken(saleValue, 18, "USDT")}`);
        console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDT")}`);
        console.log(`  利润: ${formatToken(profit, 18, "USDT")}`);
        console.log(`  利润税 (25%): ${formatToken(profitTax, 18, "USDT")}`);
        console.log(`  预期净收到: ${formatToken(expectedNetUSDT, 18, "USDT")}`);
    } else {
        // 无利润，收取 25% 无利润费用
        noProfitFee = saleValue * 2500n / 10000n;
        expectedNetUSDT = saleValue - noProfitFee;
        console.log(`\n无利润费用计算:`);
        console.log(`  卖出价值: ${formatToken(saleValue, 18, "USDT")}`);
        console.log(`  历史投资: ${formatToken(investmentBefore, 18, "USDT")}`);
        console.log(`  无利润费用 (25%): ${formatToken(noProfitFee, 18, "USDT")}`);
        console.log(`  预期净收到: ${formatToken(expectedNetUSDT, 18, "USDT")}`);
    }

    // 执行卖出
    console.log(`\n执行卖出交易...`);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    const tx = await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
        sellAmount,
        0,
        path,
        traderAddress,
        deadline
    );

    const receipt = await tx.wait();
    console.log(`交易哈希: ${receipt.hash}`);
    console.log(`Gas 使用: ${receipt.gasUsed.toString()}`);

    // 记录卖出后的余额
    const usdtBalanceAfter = await usdt.balanceOf(traderAddress);
    const aeBalanceAfter = await ae.balanceOf(traderAddress);
    const investmentAfter = await ae.userInvestment(traderAddress);

    const marketingFeeAfter = await ae.amountMarketingFee();
    const lpFeeAfter = await ae.amountLPFee();

    // 计算实际变化
    const usdtReceived = usdtBalanceAfter - usdtBalanceBefore;
    const aeSold = aeBalanceBefore - aeBalanceAfter;
    const investmentDecrease = investmentBefore - investmentAfter;

    const marketingFeeIncrease = marketingFeeAfter - marketingFeeBefore;
    const lpFeeIncrease = lpFeeAfter - lpFeeBefore;

    console.log(`\n卖出后余额:`);
    console.log(`  USDT: ${formatToken(usdtBalanceAfter, 18)}`);
    console.log(`  AE: ${formatToken(aeBalanceAfter, 18)}`);
    console.log(`  历史投资: ${formatToken(investmentAfter, 18, "USDT")}`);

    console.log(`\n实际变化:`);
    console.log(`  AE 卖出: ${formatToken(aeSold, 18, "AE")}`);
    console.log(`  USDT 收到: ${formatToken(usdtReceived, 18, "USDT")}`);
    console.log(`  投资减少: ${formatToken(investmentDecrease, 18, "USDT")}`);

    console.log(`\n合约费用累积增加:`);
    console.log(`  营销费用增加: ${formatToken(marketingFeeIncrease, 18, "AE")}`);
    console.log(`  LP 费用增加: ${formatToken(lpFeeIncrease, 18, "AE")}`);
    console.log(`  总费用累积: ${formatToken(marketingFeeIncrease + lpFeeIncrease, 18, "AE")}`);

    // 验证费用
    console.log(`\n费用验证:`);
    const totalFeeCollected = marketingFeeIncrease + lpFeeIncrease;
    const feeRate = totalFeeCollected * 10000n / sellAmount;
    console.log(`  实际费率: ${feeRate.toString()} / 10000 = ${Number(feeRate) / 100}%`);
    console.log(`  预期费率: 3%`);

    const marketingFeeRate = marketingFeeIncrease * 10000n / sellAmount;
    const lpFeeRate = lpFeeIncrease * 10000n / sellAmount;
    console.log(`  营销费率: ${Number(marketingFeeRate) / 100}% (预期 1.5%)`);
    console.log(`  LP 费率: ${Number(lpFeeRate) / 100}% (预期 1.5%)`);

    return {
        usdtReceived,
        aeSold,
        totalFeeCollected: marketingFeeIncrease + lpFeeIncrease,
        marketingFeeIncrease,
        lpFeeIncrease
    };
}

async function main() {
    printSeparator("AE 代币交易测试");

    console.log(`\n测试配置:`);
    console.log(`  网络: ${deploymentConfig.network}`);
    console.log(`  AE 代币: ${deployment.contracts.AE}`);
    console.log(`  USDT: ${USDT_ADDRESS}`);
    console.log(`  PancakeSwap Router: ${deploymentConfig.addresses.pancakeRouter}`);

    // 生成随机测试账户
    const wallet = ethers.Wallet.createRandom();
    const testAccount = wallet.connect(ethers.provider);
    const testAddress = await testAccount.getAddress();

    console.log(`\n生成测试账户: ${testAddress}`);

    // 为测试账户分配 BNB (用于 gas)
    const [deployer] = await ethers.getSigners();
    const bnbAmount = ethers.parseEther("1.0");
    await deployer.sendTransaction({
        to: testAddress,
        value: bnbAmount
    });
    console.log(`已分配 ${formatToken(bnbAmount, 18, "BNB")} 用于 gas`);

    // 为测试账户分配 USDT
    const usdtAmount = ethers.parseEther("10000"); // 10000 USDT
    await fundAccountWithUSDT(testAddress, usdtAmount);
    console.log(`已分配 ${formatToken(usdtAmount, 18, "USDT")}`);

    // 连接合约
    const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, testAccount);
    const ae = new ethers.Contract(deployment.contracts.AE, AE_ABI, testAccount);
    const router = new ethers.Contract(deploymentConfig.addresses.pancakeRouter, ROUTER_ABI, testAccount);

    // 验证余额
    const usdtBalance = await usdt.balanceOf(testAddress);
    const aeBalance = await ae.balanceOf(testAddress);
    console.log(`\n初始余额验证:`);
    console.log(`  USDT: ${formatToken(usdtBalance, 18)}`);
    console.log(`  AE: ${formatToken(aeBalance, 18)}`);

    // 测试 1: 买入代币
    const buyAmount = ethers.parseEther("1000"); // 买入 1000 USDT 的 AE
    const buyResult = await testBuyTokens(testAccount, testAddress, usdt, ae, router, buyAmount);

    // 等待一段时间
    console.log(`\n等待 5 秒...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 测试 2: 卖出部分代币
    const sellAmount = buyResult.aeReceived / 2n; // 卖出一半
    const sellResult = await testSellTokens(testAccount, testAddress, usdt, ae, router, sellAmount);

    // 最终总结
    printSeparator("测试总结");

    console.log(`\n买入测试:`);
    console.log(`  花费 USDT: ${formatToken(buyResult.usdtSpent, 18)}`);
    console.log(`  收到 AE: ${formatToken(buyResult.aeReceived, 18)}`);
    console.log(`  总费用: ${formatToken(buyResult.totalFeeCollected, 18, "AE")}`);
    console.log(`  节点奖励: ${formatToken(buyResult.nodeRewardReceived, 18, "AE")}`);
    console.log(`  社区奖励: ${formatToken(buyResult.communityRewardReceived, 18, "AE")}`);

    console.log(`\n卖出测试:`);
    console.log(`  卖出 AE: ${formatToken(sellResult.aeSold, 18)}`);
    console.log(`  收到 USDT: ${formatToken(sellResult.usdtReceived, 18)}`);
    console.log(`  总费用: ${formatToken(sellResult.totalFeeCollected, 18, "AE")}`);
    console.log(`  营销费用: ${formatToken(sellResult.marketingFeeIncrease, 18, "AE")}`);
    console.log(`  LP 费用: ${formatToken(sellResult.lpFeeIncrease, 18, "AE")}`);

    // 最终余额
    const finalUsdtBalance = await usdt.balanceOf(testAddress);
    const finalAeBalance = await ae.balanceOf(testAddress);
    const finalInvestment = await ae.userInvestment(testAddress);

    console.log(`\n最终余额:`);
    console.log(`  USDT: ${formatToken(finalUsdtBalance, 18)}`);
    console.log(`  AE: ${formatToken(finalAeBalance, 18)}`);
    console.log(`  历史投资: ${formatToken(finalInvestment, 18, "USDT")}`);

    console.log(`\n✓ 测试完成！`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
