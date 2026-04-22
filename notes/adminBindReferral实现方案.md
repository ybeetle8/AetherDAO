# adminBindReferral 实现方案

## 目标

在 StakingBase 中新增 `adminBindReferral` 方法，允许管理员为用户绑定推荐人，用于从老合约 AetherReferral 迁移推荐关系数据。

## 需要改动的文件

### 1. IStaking.sol — 新增事件和函数声明

新增事件：
```solidity
event AdminReferralBound(
    address indexed user,
    address indexed referrer,
    address indexed admin,
    uint256 timestamp
);
```

新增函数声明：
```solidity
function adminBindReferral(address user, address _referrer) external;
function batchAdminBindReferral(address[] calldata users, address[] calldata referrers) external;
```

### 2. StakingBase.sol — 实现函数

#### 单个绑定

参考老合约 `AetherReferral.adminBindReferral` 的校验逻辑，但适配新合约的数据结构：

```solidity
function adminBindReferral(address user, address _referrer) external onlyOwner {
    if (_referrals[user] != address(0)) revert AlreadyBound();

    if (_referrer == address(0)) {
        _referrer = rootAddress;
    }

    if (_referrer == user) revert CannotReferSelf();
    if (!_hasLocked[_referrer]) revert InvalidReferrer();

    _referrals[user] = _referrer;
    _children[_referrer].push(user);
    _hasLocked[user] = true;

    // 同步已有质押到推荐链
    uint256 userExistingInvestment = principalBalance(user);
    if (userExistingInvestment > 0) {
        _syncExistingInvestmentToReferralChain(user, userExistingInvestment);
    }

    emit AdminReferralBound(user, _referrer, msg.sender, block.timestamp);
}
```

#### 批量绑定

迁移场景下需要批量操作，减少交易次数：

```solidity
function batchAdminBindReferral(
    address[] calldata users,
    address[] calldata referrers
) external onlyOwner {
    require(users.length == referrers.length, "Length mismatch");

    for (uint256 i = 0; i < users.length; i++) {
        address user = users[i];
        address referrer = referrers[i];

        if (_referrals[user] != address(0)) continue; // 已绑定跳过
        if (referrer == address(0)) referrer = rootAddress;
        if (referrer == user) continue; // 不能自推荐，跳过
        if (!_hasLocked[referrer]) continue; // 推荐人未绑定，跳过

        _referrals[user] = referrer;
        _children[referrer].push(user);
        _hasLocked[user] = true;

        uint256 userExistingInvestment = principalBalance(user);
        if (userExistingInvestment > 0) {
            _syncExistingInvestmentToReferralChain(user, userExistingInvestment);
        }

        emit AdminReferralBound(user, referrer, msg.sender, block.timestamp);
    }
}
```

注意：批量函数中对异常数据用 `continue` 跳过而不是 `revert`，避免一条坏数据导致整批失败。

## 关于权限控制

老合约用的是 `onlyOperator`（owner 或 operator 都可以调用），新合约目前没有 operator 角色，直接用 `onlyOwner` 即可。如果后续需要 operator 机制再加。

## 迁移时的调用顺序

因为 `lockReferral` 和 `adminBindReferral` 都加了 `!_hasLocked[_referrer]` 校验，批量导入时必须按层级从上到下的顺序：

1. rootAddress（构造函数已标记 `_hasLocked = true`）
2. 第 1 层：直接推荐人是 rootAddress 的用户
3. 第 2 层：推荐人是第 1 层用户的用户
4. 依此类推...

迁移脚本需要对推荐关系做拓扑排序后再分批调用 `batchAdminBindReferral`。
