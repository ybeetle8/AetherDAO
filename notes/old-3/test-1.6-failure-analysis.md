# 测试 1.6 失败分析

## 错误信息

```
❌ 1.6 5 种期限质押及利率验证
   错误: Error: VM Exception while processing transaction: reverted with reason string '7-day stake can only be used once'
```

## 根因分析

### 合约逻辑

`StakingBase.sol` 的 `stake()` 函数（第 230-243 行）中有 7 天期限质押的一次性限制：

```solidity
if (_stakeIndex == 0) {
    require(!hasUsed7DayStake[msg.sender], "7-day stake can only be used once");
    hasUsed7DayStake[msg.sender] = true;
}
```

`_stakeIndex == 0` 对应 7 天期限，每个用户只能使用一次。一旦 `hasUsed7DayStake[user]` 被设为 `true`，就永远无法再用 `_stakeIndex == 0` 质押（除非 owner 调用 `reset7DayStakeUsage` 重置）。

### 测试代码

`stake-basic.test.js` 第 120-129 行，测试 1.6 的循环：

```js
for (let i = 0; i < 5; i++) {
    const maxS = await staking.maxStakeAmount();
    const amt = maxS < parseEther("100") ? maxS : parseEther("100");
    assert(amt >= parseEther("100"), `期限${i}: maxStakeAmount(${formatEther(maxS)})不足100`);
    await staking.connect(userC).stake(amt, i);  // i=0 时为 7 天期限
}
```

循环第一次迭代 `i=0` 就会调用 `stake(100, 0)`，即 7 天期限质押。

### 失败原因

测试通过 `npx hardhat run --network localhost` 运行，连接到一个持久化的 Hardhat 本地节点。**节点状态在多次脚本运行之间不会重置。**

当第一次运行此测试时，`i=0` 的 `stake(100, 0)` 成功执行，`hasUsed7DayStake[userC]` 被设为 `true`。

当第二次（或之后）运行此测试时，`hasUsed7DayStake[userC]` 已经是 `true`，循环第一次迭代 `i=0` 就会触发 `require` 失败，revert "7-day stake can only be used once"。

### 为什么其他测试没有同样的问题？

- 测试 1.1~1.4 使用 userA（accounts[14]），质押的是 `_stakeIndex = 1` 和 `_stakeIndex = 2`，不涉及 7 天限制
- 测试 1.7 本身就是验证 7 天限制的 revert，所以重复运行反而能通过
- 测试 1.5 使用 userB（accounts[15]），用 `(idx % 4) + 1` 跳过了 `_stakeIndex = 0`

## 解决方案建议

### 方案 A：使用 EVM 快照（推荐）

在测试开始前 `evm_snapshot`，结束后 `evm_revert`，确保每次运行都从干净状态开始：

```js
const snapshotId = await takeSnapshot();
// ... 运行所有测试 ...
await revertSnapshot(snapshotId);
```

`test/helpers/time.js` 中已经有 `takeSnapshot` 和 `revertSnapshot` 工具函数，但测试脚本没有使用。

### 方案 B：在测试 1.6 中先重置 7 天标记

利用 owner 权限调用 `reset7DayStakeUsage`：

```js
await staking.connect(deployer).reset7DayStakeUsage(userC.address);
```

在循环开始前调用，确保 userC 的 7 天标记被清除。

### 方案 C：调整循环顺序，跳过已使用的 7 天质押

先检查 `has7DayStakeBeenUsed`，如果已使用则跳过 `i=0`：

```js
const already7Day = await staking.has7DayStakeBeenUsed(userC.address);
for (let i = 0; i < 5; i++) {
    if (i === 0 && already7Day) continue;
    // ...
}
```

但这会导致只验证 4 种期限，不符合测试意图。

### 推荐

方案 A 最干净，从根本上解决了测试幂等性问题，所有测试都能受益。方案 B 是最小改动，只需在测试 1.6 开头加一行。
