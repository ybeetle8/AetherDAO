/**
 * 查询 AE/USDC 流动池状态
 * 分析池子数据及撤池可行性
 *
 * 用法: npx hardhat run scripts/queryPoolStatus.js --network bsc
 */

const hre = require("hardhat");
const path = require("path");

const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function main() {
  if (hre.network.name !== "bsc") {
    console.error("此脚本仅用于 BSC 主网！当前网络:", hre.network.name);
    process.exit(1);
  }

  const deployment = require(path.join(__dirname, "..", "ae-mainnet-deployment_主网发布.json"));
  const { AE: AE_ADDRESS, Pair: PAIR_ADDRESS, LiquidityStaking: LS_ADDRESS } = deployment.contracts;
  const DEPLOYER = deployment.deployer;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              AE/USDC 流动池状态查询                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 连接合约
  const ae = await hre.ethers.getContractAt("contracts/AE/src/mainnet/AE.sol:AE", AE_ADDRESS);
  const pairABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function totalSupply() external view returns (uint256)",
    "function balanceOf(address) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
  ];
  const pair = new hre.ethers.Contract(PAIR_ADDRESS, pairABI, hre.ethers.provider);

  const erc20ABI = [
    "function balanceOf(address) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
  ];

  // ========== 1. 池子基本信息 ==========
  console.log("=== 1. 池子基本信息 ===\n");
  console.log("  AE 合约:           ", AE_ADDRESS);
  console.log("  Pair 合约:         ", PAIR_ADDRESS);
  console.log("  LiquidityStaking:  ", LS_ADDRESS);
  console.log("  部署者:            ", DEPLOYER);

  const token0 = await pair.token0();
  const token1 = await pair.token1();
  console.log("\n  Token0:", token0);
  console.log("  Token1:", token1);

  const isAEToken0 = token0.toLowerCase() === AE_ADDRESS.toLowerCase();
  const usdxAddress = isAEToken0 ? token1 : token0;
  const usdx = new hre.ethers.Contract(usdxAddress, erc20ABI, hre.ethers.provider);
  const usdxSymbol = await usdx.symbol();
  const usdxDecimals = await usdx.decimals();

  console.log("  USDX 地址:        ", usdxAddress);
  console.log("  USDX 符号:        ", usdxSymbol);
  console.log("  USDX 精度:        ", usdxDecimals.toString());

  // ========== 2. 池子储备量 ==========
  console.log("\n=== 2. 池子储备量 ===\n");
  const [reserve0, reserve1, blockTimestampLast] = await pair.getReserves();
  const aeReserve = isAEToken0 ? reserve0 : reserve1;
  const usdxReserve = isAEToken0 ? reserve1 : reserve0;

  const aeReserveFormatted = hre.ethers.formatEther(aeReserve);
  const usdxReserveFormatted = hre.ethers.formatUnits(usdxReserve, usdxDecimals);

  console.log("  AE 储备:          ", Number(aeReserveFormatted).toLocaleString(), "AE");
  console.log("  USDX 储备:        ", Number(usdxReserveFormatted).toLocaleString(), usdxSymbol);

  if (usdxReserve > 0n && aeReserve > 0n) {
    // AE 价格 = usdxReserve / aeReserve（注意精度差异）
    const aePrice = (Number(usdxReserveFormatted) / Number(aeReserveFormatted));
    console.log("  AE 当前价格:      ", aePrice.toFixed(8), `${usdxSymbol}/AE`);
    console.log("  池子总价值:       ", (Number(usdxReserveFormatted) * 2).toLocaleString(), usdxSymbol);
  }

  const lastUpdateDate = new Date(Number(blockTimestampLast) * 1000);
  console.log("  最后更新时间:      ", lastUpdateDate.toISOString().replace("T", " ").replace(".000Z", " UTC"));

  // ========== 3. LP 代币分布 ==========
  console.log("\n=== 3. LP 代币分布 ===\n");
  const totalSupply = await pair.totalSupply();
  const lpDecimals = await pair.decimals();
  console.log("  LP 总供应量:      ", hre.ethers.formatUnits(totalSupply, lpDecimals));

  // 最小流动性锁定（PancakeSwap V2 的 MINIMUM_LIQUIDITY = 1000）
  const minimumLiquidity = 1000n;

  const balZero = await pair.balanceOf(ZERO_ADDRESS);
  const balDead = await pair.balanceOf(DEAD_ADDRESS);
  const balDeployer = await pair.balanceOf(DEPLOYER);
  const balLS = await pair.balanceOf(LS_ADDRESS);
  const balAEContract = await pair.balanceOf(AE_ADDRESS);

  const fmt = (val) => hre.ethers.formatUnits(val, lpDecimals);
  const pct = (val) => totalSupply > 0n ? (Number(val) * 100 / Number(totalSupply)).toFixed(2) + "%" : "0%";

  console.log("  零地址 (0x000...000):  ", fmt(balZero), `(${pct(balZero)})`);
  console.log("  死亡地址 (0x...dEaD):  ", fmt(balDead), `(${pct(balDead)})`);
  console.log("  部署者钱包:            ", fmt(balDeployer), `(${pct(balDeployer)})`);
  console.log("  LiquidityStaking:      ", fmt(balLS), `(${pct(balLS)})`);
  console.log("  AE 合约本身:           ", fmt(balAEContract), `(${pct(balAEContract)})`);

  const burnedLP = balZero + balDead;
  const circulatingLP = totalSupply - burnedLP - minimumLiquidity;
  console.log("\n  已销毁 LP 总量:        ", fmt(burnedLP), `(${pct(burnedLP)})`);
  console.log("  流通中 LP:             ", fmt(circulatingLP), `(${pct(circulatingLP)})`);
  console.log("  最小锁定 (MINIMUM_LIQUIDITY):", minimumLiquidity.toString());

  // ========== 4. 已销毁 LP 对应的锁定资产 ==========
  console.log("\n=== 4. 已销毁 LP 对应的锁定资产（不可撤回）===\n");
  if (totalSupply > 0n) {
    const lockedAE = (aeReserve * burnedLP) / totalSupply;
    const lockedUSDX = (usdxReserve * burnedLP) / totalSupply;
    console.log("  锁定 AE:          ", Number(hre.ethers.formatEther(lockedAE)).toLocaleString(), "AE");
    console.log("  锁定 USDX:        ", Number(hre.ethers.formatUnits(lockedUSDX, usdxDecimals)).toLocaleString(), usdxSymbol);

    const freeAE = aeReserve - lockedAE;
    const freeUSDX = usdxReserve - lockedUSDX;
    console.log("\n  可被撤出的 AE:    ", Number(hre.ethers.formatEther(freeAE)).toLocaleString(), "AE");
    console.log("  可被撤出的 USDX:  ", Number(hre.ethers.formatUnits(freeUSDX, usdxDecimals)).toLocaleString(), usdxSymbol);
  }

  // ========== 5. 预售/交易控制状态 ==========
  console.log("\n=== 5. 交易控制状态 ===\n");
  const presaleActive = await ae.presaleActive();
  const presaleStartTime = await ae.presaleStartTime();
  const presaleDuration = await ae.presaleDuration();
  const delayedBuyEnabled = await ae.delayedBuyEnabled();

  console.log("  presaleActive:     ", presaleActive ? "开启（禁止买入）" : "关闭（交易开放）");
  if (presaleActive) {
    const startDate = new Date(Number(presaleStartTime) * 1000);
    const endTimestamp = Number(presaleStartTime) + Number(presaleDuration);
    const endDate = new Date(endTimestamp * 1000);
    const now = Math.floor(Date.now() / 1000);
    const remaining = endTimestamp - now;

    console.log("  presaleStartTime:  ", startDate.toISOString().replace("T", " ").replace(".000Z", " UTC"));
    console.log("  presaleDuration:   ", (Number(presaleDuration) / 86400).toFixed(1), "天");
    console.log("  预售结束时间:      ", endDate.toISOString().replace("T", " ").replace(".000Z", " UTC"));
    if (remaining > 0) {
      console.log("  剩余:             ", (remaining / 86400).toFixed(1), "天");
    } else {
      console.log("  状态:              已过期（买入限制已自动失效，虽然 presaleActive 仍为 true）");
    }
  }
  console.log("  delayedBuyEnabled: ", delayedBuyEnabled ? "开启" : "关闭");

  // ========== 6. AE 代币供应信息 ==========
  console.log("\n=== 6. AE 代币供应信息 ===\n");
  const aeTotalSupply = await ae.totalSupply();
  const aeBurned = await ae.balanceOf(DEAD_ADDRESS);
  const aeInPair = await ae.balanceOf(PAIR_ADDRESS);

  console.log("  AE 总供应:        ", Number(hre.ethers.formatEther(aeTotalSupply)).toLocaleString(), "AE");
  console.log("  AE 已销毁:        ", Number(hre.ethers.formatEther(aeBurned)).toLocaleString(), "AE");
  console.log("  AE 在池子中:      ", Number(hre.ethers.formatEther(aeInPair)).toLocaleString(), "AE");
  console.log("  实际流通:         ", Number(hre.ethers.formatEther(aeTotalSupply - aeBurned)).toLocaleString(), "AE");

  // ========== 7. 撤池可行性分析 ==========
  console.log("\n=== 7. 撤池可行性分析 ===\n");

  const deployerCanWithdraw = balDeployer > 0n;
  const lsHasLP = balLS > 0n;
  const burnedPct = totalSupply > 0n ? Number(burnedLP) * 100 / Number(totalSupply) : 0;

  if (burnedPct > 99) {
    console.log("  结论: LP 几乎全部销毁（" + burnedPct.toFixed(2) + "%），池子流动性已永久锁定");
    console.log("  项目方无法撤回流动性");
  } else if (burnedPct > 50) {
    console.log("  结论: 大部分 LP 已销毁（" + burnedPct.toFixed(2) + "%），大部分流动性已永久锁定");
  } else {
    console.log("  结论: LP 销毁比例较低（" + burnedPct.toFixed(2) + "%），存在可撤回的流动性");
  }

  console.log("\n  LP 持有者分析:");
  if (deployerCanWithdraw) {
    const deployerAE = (aeReserve * balDeployer) / totalSupply;
    const deployerUSDX = (usdxReserve * balDeployer) / totalSupply;
    console.log("  - 部署者持有 LP，可撤回:");
    console.log("    AE:  ", Number(hre.ethers.formatEther(deployerAE)).toLocaleString());
    console.log("    USDX:", Number(hre.ethers.formatUnits(deployerUSDX, usdxDecimals)).toLocaleString());
  } else {
    console.log("  - 部署者: 无 LP，无法撤池");
  }

  if (lsHasLP) {
    const lsAE = (aeReserve * balLS) / totalSupply;
    const lsUSDX = (usdxReserve * balLS) / totalSupply;
    console.log("  - LiquidityStaking 合约持有 LP（用户质押的）:");
    console.log("    AE:  ", Number(hre.ethers.formatEther(lsAE)).toLocaleString());
    console.log("    USDX:", Number(hre.ethers.formatUnits(lsUSDX, usdxDecimals)).toLocaleString());
    console.log("    (这些 LP 属于质押用户，用户解押后可自行撤回)");
  } else {
    console.log("  - LiquidityStaking: 无 LP 质押");
  }

  // 查找其他持有者（流通中非已知地址的 LP）
  const knownLP = balZero + balDead + balDeployer + balLS + balAEContract + minimumLiquidity;
  const unknownLP = totalSupply > knownLP ? totalSupply - knownLP : 0n;
  if (unknownLP > 0n) {
    const unknownAE = (aeReserve * unknownLP) / totalSupply;
    const unknownUSDX = (usdxReserve * unknownLP) / totalSupply;
    console.log("  - 其他地址持有的 LP:");
    console.log("    LP 数量:", fmt(unknownLP), `(${pct(unknownLP)})`);
    console.log("    对应 AE:", Number(hre.ethers.formatEther(unknownAE)).toLocaleString());
    console.log("    对应 USDX:", Number(hre.ethers.formatUnits(unknownUSDX, usdxDecimals)).toLocaleString());
    console.log("    (可能是用户自行添加的流动性)");
  }

  console.log("\n══════════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("查询失败:", error.message);
    process.exit(1);
  });
