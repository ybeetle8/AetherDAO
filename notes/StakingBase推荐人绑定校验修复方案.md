# StakingBase 推荐人绑定校验修复方案

## 问题描述

当前 `StakingBase.lockReferral()` 缺少两个关键校验：

1. **不校验推荐人是否已绑定** — 任何地址都能作为推荐人，即使该地址从未在系统中注册过
2. **rootAddress 未标记为已绑定** — 构造函数没有设置 `_hasLocked[rootAddress] = true`

对比老合约 `AetherReferral.sol` 的逻辑：
```solidity
// 老合约的校验
if (_referrer != rootAddress && !_hasLockedReferral[_referrer]) {
    revert InvalidAddress();
}

// 构造函数中
_hasLockedReferral[_rootAddress] = true;
```

## 当前代码（StakingBase.sol:403-428）

```solidity
function lockReferral(address _referrer) external {
    address user = msg.sender;

    if (_referrals[user] != address(0)) revert AlreadyBound();
    if (user == rootAddress) revert CannotReferSelf();

    if (_referrer == address(0)) {
        _referrer = rootAddress;
    }

    if (_referrer == user) revert CannotReferSelf();

    // ❌ 缺少：推荐人是否已绑定的校验
    // ❌ 缺少：循环引用检查

    _referrals[user] = _referrer;
    _children[_referrer].push(user);
    _hasLocked[user] = true;
    // ...
}
```

## 修改方案

### 改动 1：构造函数 — 标记 rootAddress 为已绑定

位置：`StakingBase.sol` 构造函数（约第 217 行之后）

新增一行：
```solidity
rootAddress = _rootAddress;
_hasLocked[_rootAddress] = true;  // ← 新增
```

同时 `setRootAddress` 也需要同步更新：
```solidity
function setRootAddress(address _rootAddress) external onlyOwner {
    _hasLocked[rootAddress] = false;   // 取消旧 root 的标记（可选）
    rootAddress = _rootAddress;
    _hasLocked[_rootAddress] = true;   // 标记新 root
}
```

### 改动 2：lockReferral — 增加推荐人已绑定校验

位置：`StakingBase.sol:413`（`if (_referrer == user)` 之后）

新增校验：
```solidity
if (_referrer == user) revert CannotReferSelf();

// ← 新增：推荐人必须已绑定（rootAddress 除外，但 rootAddress 已在构造函数中标记）
if (!_hasLocked[_referrer]) revert InvalidReferrer();
```

`InvalidReferrer` 错误已在 `IStaking.sol` 中定义，无需新增。

### 改动 3（可选）：增加循环引用检查

老合约有 `_wouldCreateCircularReference` 检查。新合约因为加了"推荐人必须已绑定"的校验，理论上不会出现循环引用（A 绑定 B 的前提是 B 已绑定，而 B 绑定时 A 还没绑定，所以 B 的链上不可能有 A）。

结论：加了改动 2 之后，循环引用在逻辑上不可能发生，不需要额外检查。

## 修改汇总

| 文件 | 位置 | 改动 |
|------|------|------|
| StakingBase.sol | 构造函数 ~L217 | 加 `_hasLocked[_rootAddress] = true` |
| StakingBase.sol | setRootAddress ~L430 | 更新 `_hasLocked` 标记 |
| StakingBase.sol | lockReferral ~L413 | 加 `if (!_hasLocked[_referrer]) revert InvalidReferrer()` |

总共改动 3 处，不需要新增错误类型或接口变更。

## 对迁移方案的影响

加了这个校验后，批量导入推荐关系时需要按层级顺序导入（先导入上级，再导入下级），确保每个推荐人在被引用时已经存在于系统中。迁移脚本需要做拓扑排序。
