/**
 * 查询主网流动性状态（只读，无需私钥）
 * 用法: npx hardhat run scripts/queryLiquidityStatus.js --network bsc
 */
const hre = require("hardhat");

const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const PAIR_ADDRESS = "0x526bb930F25C8976290c01CEF775249373343132";
const AE_ADDRESS = "0x01edd7445DF0e9c2064c77Df150BE9FC793C828b";
const STAKING_ADDRESS = "0xf812E0A65d01FFE2b3916F483B1BDe69d38829B3";
const LS_ADDRESS = "0xAc846586b990dADD1d15Fe62E17256DDc3d1F955";
const USDX_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const DEPLOYER = "0xB138e42B76ad0E6F21E715578F34F2Cf2285eE76";

async function main() {
  const provider = hre.ethers.provider;
  const fmt = (v, d=18) => Number(hre.ethers.formatUnits(v, d));

  const erc20ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];
  const pairABI = [
    ...erc20ABI,
    "function getReserves() view returns (uint112, uint112, uint32)",
    "function token0() view returns (address)",
    "function token1() view returns (address)",
  ];
  const stakingABI = [
    "function totalSupply() view returns (uint256)",
    "function totalStakers() view returns (uint256)",
    "function totalDividendsDistributed() view returns (uint256)",
    "function getGlobalStats() view returns (uint256,uint256,uint256,uint256)",
  ];

  const pair = new hre.ethers.Contract(PAIR_ADDRESS, pairABI, provider);
  const ae = new hre.ethers.Contract(AE_ADDRESS, erc20ABI, provider);
  const usdx = new hre.ethers.Contract(USDX_ADDRESS, erc20ABI, provider);
  const staking = new hre.ethers.Contract(STAKING_ADDRESS, stakingABI, provider);

  // === 池子储备 ===
  const token0 = await pair.token0();
  const [r0, r1] = await pair.getReserves();
  const isAEToken0 = token0.toLowerCase() === AE_ADDRESS.toLowerCase();
  const aeReserve = isAEToken0 ? r0 : r1;
  const usdxReserve = isAEToken0 ? r1 : r0;

  console.log("\n========== 池子储备 ==========");
  console.log(`  AE 储备:    ${fmt(aeReserve).toLocaleString()} AE`);
  console.log(`  USDC 储备:  ${fmt(usdxReserve).toLocaleString()} USDC`);
  const aePrice = fmt(usdxReserve) / fmt(aeReserve);
  console.log(`  AE 价格:    ${aePrice.toFixed(8)} USDC`);
  console.log(`  池子总价值: ${(fmt(usdxReserve) * 2).toLocaleString()} USDC`);

  // === LP 分布 ===
  console.log("\n========== LP 分布 ==========");
  const lpTotal = await pair.totalSupply();
  console.log(`  LP 总量:          ${fmt(lpTotal).toLocaleString()}`);

  const lpZero = await pair.balanceOf(ZERO_ADDRESS);
  const lpDead = await pair.balanceOf(DEAD_ADDRESS);
  console.log(`  零地址:           ${fmt(lpZero).toLocaleString()}`);
  console.log(`  死亡地址:         ${fmt(lpDead).toLocaleString()}`);

  const lpDeployer = await pair.balanceOf(DEPLOYER);
  const lpLS = await pair.balanceOf(LS_ADDRESS);
  const lpStaking = await pair.balanceOf(STAKING_ADDRESS);
  console.log(`  部署者:           ${fmt(lpDeployer).toLocaleString()}`);
  console.log(`  LiquidityStaking: ${fmt(lpLS).toLocaleString()}`);
  console.log(`  Staking合约:      ${fmt(lpStaking).toLocaleString()}`);

  const burnedLP = lpZero + lpDead;
  const pct = (v) => (Number(v) * 100 / Number(lpTotal)).toFixed(2) + "%";
  console.log(`  已销毁LP总计:     ${fmt(burnedLP).toLocaleString()} (${pct(burnedLP)})`);

  // === 已销毁LP对应的锁定资产 ===
  const lockedAE = (aeReserve * burnedLP) / lpTotal;
  const lockedUSDX = (usdxReserve * burnedLP) / lpTotal;
  console.log("\n========== 永久锁定资产（不可撤回）==========");
  console.log(`  锁定 AE:    ${fmt(lockedAE).toLocaleString()} AE`);
  console.log(`  锁定 USDC:  ${fmt(lockedUSDX).toLocaleString()} USDC`);
  console.log(`  锁定价值:   ${(fmt(lockedUSDX) * 2).toLocaleString()} USDC`);

  // === Staking 合约持有的 AE 和 USDX ===
  const stakingAE = await ae.balanceOf(STAKING_ADDRESS);
  console.log("\n========== Staking 合约余额 ==========");
  console.log(`  AE 余额:    ${fmt(stakingAE).toLocaleString()} AE`);
  console.log(`  AE 价值:    ${(fmt(stakingAE) * aePrice).toLocaleString()} USDC`);

  const stakingUSDX = await usdx.balanceOf(STAKING_ADDRESS);
  console.log(`  USDC 余额:  ${fmt(stakingUSDX).toLocaleString()} USDC`);

  // === Staking 全局状态 ===
  try {
    const [tvl, dividends, eduFund, stakerCount] = await staking.getGlobalStats();
    console.log("\n========== Staking 全局状态 ==========");
    console.log(`  TVL (活跃本金):   ${fmt(tvl).toLocaleString()} USDC`);
    console.log(`  累计分红:         ${fmt(dividends).toLocaleString()} USDC`);
    console.log(`  累计教育基金:     ${fmt(eduFund).toLocaleString()} USDC`);
    console.log(`  当前质押人数:     ${stakerCount.toString()}`);
  } catch(e) {
    console.log("\n  (获取 Staking 全局状态失败:", e.message, ")");
  }

  // === AE 供应信息 ===
  const aeTotalSupply = await ae.totalSupply();
  console.log("\n========== AE 代币供应 ==========");
  console.log(`  总供应:     ${fmt(aeTotalSupply).toLocaleString()} AE`);

  const aeBurned = await ae.balanceOf(DEAD_ADDRESS);
  console.log(`  已销毁:     ${fmt(aeBurned).toLocaleString()} AE`);

  const aeInPair = await ae.balanceOf(PAIR_ADDRESS);
  console.log(`  在池子中:   ${fmt(aeInPair).toLocaleString()} AE`);
  console.log(`  实际流通:   ${fmt(aeTotalSupply - aeBurned).toLocaleString()} AE`);

  // === recycle 可提取量估算 ===
  const maxRecyclable = aeInPair / 3n;
  const recyclableValue = fmt(maxRecyclable) * aePrice;
  console.log("\n========== recycle 提取估算 ==========");
  console.log(`  池中 AE:             ${fmt(aeInPair).toLocaleString()} AE`);
  console.log(`  单次 recycle 上限:   ${fmt(maxRecyclable).toLocaleString()} AE (池中1/3)`);
  console.log(`  单次可提取价值约:    ${recyclableValue.toLocaleString()} USDC`);

  console.log("\n==========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e.message); process.exit(1); });
