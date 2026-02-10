/**
 * 验证质押方案的复利系数
 *
 * 复利公式: A = P * (1 + r)^n
 * 其中:
 * - P: 本金
 * - r: 日化收益率
 * - n: 天数
 * - A: 最终金额
 *
 * 复利系数 = (1 + r)^(1/n) 的 1e18 表示
 * 这样每天乘以这个系数,n天后就能得到正确的复利结果
 */

const plans = [
  {
    id: 0,
    lockDays: 7,
    dailyRate: 0.006,      // 0.6%
    expectedTotalReturn: 0.0428,  // 4.28%
    expectedAPY: 2.19,     // ~219%
    coefficient: BigInt("1006005015832844700")
  },
  {
    id: 1,
    lockDays: 30,
    dailyRate: 0.009,      // 0.9%
    expectedTotalReturn: 0.3066,  // 30.66%
    expectedAPY: 14.17,    // ~1,417%
    coefficient: BigInt("1009002709208554000")
  },
  {
    id: 2,
    lockDays: 90,
    dailyRate: 0.011,      // 1.1%
    expectedTotalReturn: 1.6958,  // 169.58%
    expectedAPY: 6.17,     // ~617%
    coefficient: BigInt("1011001210066550000")
  },
  {
    id: 3,
    lockDays: 180,
    dailyRate: 0.015,      // 1.5%
    expectedTotalReturn: 14.3268, // 1,432.68%
    expectedAPY: 29.08,    // ~2,908%
    coefficient: BigInt("1015000428130702600")
  },
  {
    id: 4,
    lockDays: 365,
    dailyRate: 0.02,       // 2%
    expectedTotalReturn: 1327.78,  // 132,778%
    expectedAPY: 1327.78,  // ~132,778%
    coefficient: BigInt("1020000000000000000")
  }
];

const ONE_E18 = BigInt("1000000000000000000");

console.log("=" .repeat(100));
console.log("质押方案复利系数验证");
console.log("=" .repeat(100));
console.log();

plans.forEach(plan => {
  console.log(`\n方案 ${plan.id}: 锁定 ${plan.lockDays} 天, 日化 ${(plan.dailyRate * 100).toFixed(2)}%`);
  console.log("-".repeat(100));

  // 1. 计算理论复利系数
  // 复利系数 = (1 + dailyRate)^(1/lockDays)
  // 但为了精度,我们用: coefficient = (1 + dailyRate)
  // 实际上合约中应该是每天乘以 (1 + dailyRate),而不是开根号

  // 方法1: 直接用日化收益率计算复利系数
  const theoreticalCoefficient1 = 1 + plan.dailyRate;
  const theoreticalCoefficientBigInt1 = BigInt(Math.floor(theoreticalCoefficient1 * 1e18));

  console.log(`\n方法1 - 直接日化收益率:`);
  console.log(`  理论系数: ${theoreticalCoefficient1.toFixed(18)}`);
  console.log(`  理论系数 (1e18): ${theoreticalCoefficientBigInt1.toString()}`);
  console.log(`  合约系数 (1e18): ${plan.coefficient.toString()}`);
  console.log(`  差异: ${(plan.coefficient - theoreticalCoefficientBigInt1).toString()}`);

  // 2. 验证复利计算结果
  console.log(`\n验证复利计算 (本金 1000 USDC):`);

  const principal = BigInt("1000000000000000000000"); // 1000 * 1e18

  // 使用合约系数计算
  let amountWithContract = principal;
  for (let day = 0; day < plan.lockDays; day++) {
    amountWithContract = amountWithContract * plan.coefficient / ONE_E18;
  }
  const profitWithContract = amountWithContract - principal;
  const returnRateContract = Number(profitWithContract * BigInt(10000) / principal) / 100;

  console.log(`  使用合约系数:`);
  console.log(`    最终金额: ${(Number(amountWithContract) / 1e18).toFixed(6)} USDC`);
  console.log(`    收益: ${(Number(profitWithContract) / 1e18).toFixed(6)} USDC`);
  console.log(`    收益率: ${returnRateContract.toFixed(2)}%`);
  console.log(`    预期收益率: ${(plan.expectedTotalReturn * 100).toFixed(2)}%`);
  console.log(`    差异: ${(returnRateContract - plan.expectedTotalReturn * 100).toFixed(4)}%`);

  // 使用理论系数计算
  let amountWithTheory = principal;
  for (let day = 0; day < plan.lockDays; day++) {
    amountWithTheory = amountWithTheory * theoreticalCoefficientBigInt1 / ONE_E18;
  }
  const profitWithTheory = amountWithTheory - principal;
  const returnRateTheory = Number(profitWithTheory * BigInt(10000) / principal) / 100;

  console.log(`\n  使用理论系数 (方法1):`);
  console.log(`    最终金额: ${(Number(amountWithTheory) / 1e18).toFixed(6)} USDC`);
  console.log(`    收益: ${(Number(profitWithTheory) / 1e18).toFixed(6)} USDC`);
  console.log(`    收益率: ${returnRateTheory.toFixed(2)}%`);

  // 3. 计算 APY
  const apy = Math.pow(1 + plan.dailyRate, 365) - 1;
  console.log(`\n  APY 计算:`);
  console.log(`    理论 APY: ${(apy * 100).toFixed(2)}%`);
  console.log(`    预期 APY: ${(plan.expectedAPY * 100).toFixed(2)}%`);

  // 4. 判断系数是否正确
  const coefficientDiff = Number(plan.coefficient - theoreticalCoefficientBigInt1);
  const returnDiff = Math.abs(returnRateContract - plan.expectedTotalReturn * 100);

  console.log(`\n  ✓ 验证结果:`);
  if (Math.abs(coefficientDiff) < 1e15 && returnDiff < 0.1) {
    console.log(`    ✅ 系数正确! 收益率误差: ${returnDiff.toFixed(4)}%`);
  } else {
    console.log(`    ❌ 系数可能有误! 收益率误差: ${returnDiff.toFixed(4)}%`);
  }
});

console.log("\n" + "=".repeat(100));
console.log("验证完成");
console.log("=".repeat(100));
