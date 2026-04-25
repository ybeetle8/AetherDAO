const TARGET = "0x11C710888b00B90901ede49C08DA5B3B66C9dc76";
const RPC_URL = "http://47.109.157.92:8545";
const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

async function main() {
  console.log(`\nRPC: ${RPC_URL}`);
  console.log(`地址: ${TARGET}\n`);

  // 查 BNB 余额
  const bnbHex = await rpcCall("eth_getBalance", [TARGET, "latest"]);
  const bnbWei = BigInt(bnbHex);
  console.log(`BNB  余额: ${Number(bnbWei) / 1e18} BNB`);

  // 查 USDC 余额 (调用 balanceOf(address))
  // balanceOf selector = 0x70a08231, 参数为地址左填充到32字节
  const data = "0x70a08231" + TARGET.slice(2).toLowerCase().padStart(64, "0");
  const usdcHex = await rpcCall("eth_call", [
    { to: USDC_ADDRESS, data },
    "latest",
  ]);
  const usdcWei = BigInt(usdcHex);
  console.log(`USDC 余额: ${Number(usdcWei) / 1e18} USDC`);

  // 查 chainId
  const chainId = await rpcCall("eth_chainId", []);
  console.log(`\nChain ID: ${parseInt(chainId, 16)}`);
}

main().catch(console.error);
